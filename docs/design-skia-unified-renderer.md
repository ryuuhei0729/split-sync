# 設計: Skia 単一レンダラ化（プレビュー / 書き出しのピクセル一致）

ステータス: Draft / 提案
対象: `swimhub-timer/apps/mobile`（および共通化のため `apps/web` / `apps/shared`）
最終更新: 2026-06-09

---

## 1. 背景と課題

タイマー動画のオーバーレイ（タイム・スプリット・サマリー表・透かし）が、**プレビュー画面と書き出し後の動画で見た目が一致しない**。

根本原因は **2 つの独立した描画エンジンを使っていること**：

| 要素 | プレビュー | 書き出し |
|---|---|---|
| タイム | React Native `<Text>`（UIKit / Android View） | FFmpeg `drawtext` |
| スプリット | RN `SplitBadge` コンポーネント | FFmpeg `drawtext`（×2 = 見出し/メモ別箱） |
| サマリー表 | RN `FinishSummaryTable` | **同コンポーネントを view-shot で PNG 化**して overlay |
| 透かし | RN `<Text>` | FFmpeg `drawtext` |

- サマリーだけ一致しているのは、唯一「同一コンポーネントを 1 回だけ描いている」から（図らずも単一レンダラ原則を満たしている）。
- タイム・スプリットは FFmpeg `drawtext` で**描き直している**ため、以下が原理的に揃わない：
  - **箱の高さ**: RN の行ボックス高（line-height）vs FFmpeg `drawtext` の字面高 `th`。`drawtext` は箱高を独立指定できず（`boxborderw` は上下左右一律、`drawbox` は動的な `tw` を参照不可）一致不能。
  - **サマリーの大きさ**: `FinishSummaryTable` の MIN クランプ比率が項目ごとにバラバラ（font `8/13`、cell `0.5`、split `48/90`…）。プレビューは小スケールで全項目がクランプに張り付き「どのスケールでも再現できない形」になるため、書き出し側の単一スケールでは列比が一致しない。

これまでに **書き出し側で打てる手は概ね投入済み**（数値書式の `formatTime` 統一、`(lap:)` 表記、`boxborderw` 位置補正、サマリー表示タイミングのクリップ等）。残差を詰めるには **編集画面側の描画を変える** か **脆弱な PNG 化を全要素へ広げる** しかなく、いずれも筋が悪い。

> 参考: `apps/web` は既にプレビュー / 書き出し双方を同じ Canvas2D 関数（`apps/web/src/lib/stopwatch/renderer.ts`）で描いており、サマリーが一致するのはこのため。**目指す形は Web に近い。**

---

## 2. 方針（原則）

> タイム・スプリット・サマリー・透かしを、**プレビューも書き出しも 1 本の描画関数**で描く。
> FFmpeg は「文字描画器」ではなく「エンコーダ」に徹する（プロの編集アプリは皆この構造で WYSIWYG を構造的に保証している）。

これを実現する 3 点:
1. **解像度非依存の座標系** — 出力解像度 / プロジェクト解像度で一律スケール。「プレビュー用レイアウト」と「書き出し用レイアウト」を別コードで書かない。
2. **単一のテキストラスタライザ** — UIKit と `drawtext` を混ぜない。Skia 1 本で両方描く。
3. **同一フォント** — プレビュー / 書き出しとも `NotoSansMono-Bold.ttf` / `NotoSansJP-Bold.ttf` を読み込む → グリフ幅・字面高が一致。

---

## 3. 依存ライブラリ判定

### 3.1 現状（`apps/mobile/package.json`）

| 項目 | 現状 | 判定 |
|---|---|---|
| `@shopify/react-native-skia` | **未導入**（`react-native-svg` / `react-native-view-shot` のみ） | ⚠️ 追加が必要 |
| New Architecture | RN `0.83.6` → デフォルト ON。`react-native-worklets` `0.8` / `reanimated` `4.3` 導入済み | ✅ Skia v2 系の前提を満たす |
| ネイティブ導線 | `expo-dev-client` 利用・EAS・自作プラグイン `withFmtFix` で既にネイティブビルド運用 | ✅ 追加自体は既存フロー内 |
| オフスクリーン描画 | — | ✅ Skia `Surface.MakeOffscreen → makeImageSnapshot → encodeToBytes(PNG)` でヘッドレス可。`expo-file-system` 経由で FFmpeg に渡せる |
| 同一フォント | 書き出しは `NotoSans*-Bold.ttf` を使用 | ✅ Skia も同 TTF を `Typeface` 読込可 → プレビューも書き出しも同じ計測になる |
| Web 描画ロジック | `renderer.ts` の使用プリミティブ（font / measureText / quadraticCurveTo / lineTo / fillText / fillStyle / textBaseline / globalAlpha / moveTo / fill / beginPath / save / restore / fillRect / drawImage）は**全て Skia にも存在** | ✅ ほぼそのまま移植可 |

### 3.2 🚩 着手前に潰すべき依存リスク（重要）

1. **RN 0.83 × Skia バージョン整合**
   RN 0.83 は最先端。`@shopify/react-native-skia` は RN 0.83 を正式サポートする版（v2 系最新）を選定・ピン留めする必要がある。バージョンずれでビルド不能の恐れ。

2. **iOS `useFrameworks: "static"` との共存**
   `apps/mobile/app.config.js` の `expo-build-properties` で `ios.useFrameworks: "static"` ＋ `buildReactNativeFromSource: true`。さらに `ffmpeg-kit-react-native`（コミュニティフォーク `github:jdarshan5/...#rn-binaries`）の static framework と `plugins/withFmtFix.js`（fmt の consteval パッチ）が既にある **デリケートな Pod 構成**。この上に Skia を載せてリンクが通るか要検証。

3. **ffmpeg-kit フォークのフィルタ有効性**
   オーバーレイ合成に使う `overlay` フィルタと（タイマー連番用の）`image2` demuxer が当該ビルドで有効か。標準的なので恐らく可だが Phase 2 で確認。

> **結論: 「今の依存でいける」見込みは高いが、上記 1・2 を Phase 0 スパイクで先に確定する。**

---

## 4. ターゲット構成

```
@swimhub-timer/shared (新規: overlay-renderer/)
 ├─ OverlayContext        … Canvas2D サブセットの最小 IF
 │                          (font / measureText / fillStyle / globalAlpha /
 │                           fillRect / fillText / textBaseline / beginPath /
 │                           moveTo / lineTo / quadraticCurveTo / closePath /
 │                           fill / drawImage / save / restore)
 ├─ drawStopwatch(ctx, …)      ← 既存 web renderer.ts のロジックを移設
 ├─ drawPassedSplit(ctx, …)
 ├─ drawFinishSummary(ctx, …)
 └─ drawWatermark(ctx, …)
        ▲                              ▲
        │ Canvas2D adapter             │ Skia adapter
   Web (既存 <canvas>)            Mobile (@shopify/react-native-skia)
```

- **共通**: `OverlayContext` を介し、Web(Canvas2D) と Mobile(Skia) が**同一の描画コード**を共有。Web 側アダプタは実質薄皮（Canvas2D ≈ IF）。
- **座標系**: 描画関数は出力解像度（native video size）基準で受け取り、プレビューは Skia Canvas を表示サイズに縮小して描く。
- **フォント**: 両アダプタとも `NotoSansMono/JP-Bold.ttf` を読み込む。

### 4.1 プレビュー（mobile）
- 動画の上に `react-native-skia` の `<Canvas>` を重ね、毎フレーム `drawStopwatch / drawPassedSplit / drawFinishSummary / drawWatermark` を呼ぶ。
- **ドラッグ / リサイズの操作ハンドルは従来どおり RN View のまま上に重ねる**（書き出し画素ではないので Skia 化不要）。
- これで「編集画面に見えている画素」＝「書き出しに使う描画関数の出力」。

### 4.2 書き出し（mobile）
- **静的要素（サマリー・スプリット）**: オフスクリーン Skia Surface に `draw*` → PNG → FFmpeg に `enable=between(...)` で overlay。**view-shot を全廃**（透明化・空ビットマップ等の脆弱性が消える）。
- **タイマー（毎フレーム変化）**: 出力 fps ぶんのオーバーレイ PNG 連番を Skia で生成 → FFmpeg `-framerate <fps> -i ol_%05d.png` を第 2 入力にして `overlay`。`drawtext` を退役、**タイマー高さも完全一致**。

---

## 5. 移行フェーズ（各段階で出荷可能・低リスク順）

| Phase | 内容 | 価値 / リスク |
|---|---|---|
| **0 スパイク** | `@shopify/react-native-skia` を追加 → iOS / Android dev client が通るか ＋ オフスクリーン PNG 1 枚出力を確認 | **依存リスクをここで確定**。GO / NO-GO 判断 |
| **1** | shared に `OverlayContext` ＋ `draw*` を切り出し、**Web を先に移行** | Web は既に Canvas なので低リスク・抽象の妥当性検証になる |
| **2** | mobile **書き出しの静的要素（サマリー / スプリット）を Skia PNG 化** | 即・完全一致 ＋ view-shot 脆弱性除去。タイマーは `drawtext` 据置 |
| **3** | mobile **プレビューを Skia 化** | プレビュー＝書き出しの描画関数が一致 |
| **4** | mobile **書き出しタイマーを毎フレーム Skia 連番化** | タイマー高さ含め完全一致。`drawtext` 退役（perf 計測しつつ） |

各 Phase の完了基準（例）:
- Phase 0: dev client がビルド・起動し、Skia でオフスクリーン PNG を 1 枚保存できる。
- Phase 1: web のプレビュー / 書き出しが共通 `draw*` で従来どおり描画される（視覚差分なし）。
- Phase 2: 書き出しのサマリー / スプリットがプレビューとピクセル一致。view-shot 依存を削除。
- Phase 3: プレビューが Skia 描画になり、書き出し（Skia）と一致。
- Phase 4: タイマーが連番合成になり、高さ含め完全一致。

---

## 6. リスクと対策

| リスク | 対策 |
|---|---|
| **iOS ビルド（最大）**: static frameworks ＋ ffmpeg fork ＋ Skia の Pod 整合 | Phase 0 スパイクで最初に確定。Skia 版ピン留め。NG なら `useFrameworks` 方針含め再検討 |
| **RN 0.83 ↔ Skia 版** | サポート表 / changelog で 0.83 対応版を選定・ピン留め |
| **タイマー連番の生成コスト**（Phase 4）: 例 30fps×60s=1800 枚 | Skia オフスクリーンは高速だが PNG I/O ＋ FFmpeg 入力を計測。重ければ「変化フレームのみ生成」「raw pipe」等で最適化。最悪 `drawtext` 据置の判断も可 |
| **ffmpeg-kit フォークのフィルタ** | Phase 2 で `overlay` / `image2` の有効性を確認 |
| **バンドル / ビルド時間増** | Skia バイナリ分の増加を許容範囲か確認 |

---

## 7. 期待される効果

- タイム / スプリット / サマリー / 透かしが **プレビュー = 書き出しでピクセル一致**。
- Web / モバイルで描画ロジックが **1 本化**（保守コスト減・仕様差異の根絶）。
- 今後オーバーレイ要素を追加しても、両プラットフォーム × プレビュー / 書き出しが**自動で一致**。
- 書き出しの view-shot 依存（脆弱性）を撤廃。

---

## 8. 関連ファイル（現状）

- プレビュー（mobile）: `apps/mobile/components/stopwatch/StopwatchOverlay.tsx`, `apps/mobile/components/splits/FinishSummaryTable.tsx`
- 書き出し（mobile）: `apps/mobile/lib/video/export-pipeline.ts`, `apps/mobile/app/(app)/export.tsx`
- Web 共通描画（移植元）: `apps/web/src/lib/stopwatch/renderer.ts`, `apps/web/src/hooks/useCanvasCompositor.ts`, `apps/web/src/hooks/useVideoExport.ts`
- 共通ロジック: `apps/shared/utils/stopwatch-formats.ts`（`formatTime`）, `apps/shared/utils/lap-time-calculator.ts`
- ネイティブビルド設定: `apps/mobile/app.config.js`, `apps/mobile/plugins/withFmtFix.js`

---

## 9. 次アクション

依存リスクを最初に消すのが定石。**Phase 0 スパイク**（Skia 互換版の選定・追加、最小の動作確認画面、オフスクリーン PNG 出力の smoke test）から着手する。
