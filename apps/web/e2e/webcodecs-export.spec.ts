/**
 * Sprint Contract E2E テストスケルトン — Phase A
 * WebCodecs 書き出しパイプライン移行 (ffmpeg.wasm → WebCodecs) の実機/ブラウザ検証
 *
 * 検証対象の Sprint Contract 項目:
 *   V-05/V-06: 実ブラウザでの WebCodecs 対応検出 (desktop Chrome/Edge は対応、Firefox は非対応)
 *   V-21: 1080p 書き出し速度が ffmpeg 単一スレッド版より大幅に速い
 *   V-04/V-22: プレビューと書き出し結果の overlay 一致 (shared/overlay-renderer 統一の目視確認)
 *   V-18: 実行時例外からの ffmpeg フォールバック (強制失敗させて確認)
 *   V-23: iPhone 回転メタデータ付き動画の overlay 向き・位置 (実機 iPhone 撮影 fixture 必須)
 *   V-24: 画質パリティ (CRF相当 vs bitrate) — ファイルサイズ比較 + 目視
 *
 * NOTE: Phase A はスケルトンのみ。test.todo で構造のみ定義する。
 * 既存の e2e/timer-finish-summary.spec.ts と同じ規約 (test/expect は未インポート = 実行不可の
 * ドキュメント的スケルトン) に合わせている。
 *
 * QA 所見 (Phase A 時点でのブロッカー):
 *   このリポジトリには @playwright/test が devDependencies に存在せず、
 *   playwright.config.* もどこにも存在しない。既存の e2e/*.spec.ts 2ファイルも同様に
 *   test/expect をインポートしておらず、どの CI コマンドからも実行されていない
 *   ("test" スクリプトは vitest run --config vitest.config.mts で src/**のみ対象、
 *   tsconfig.json は "exclude": ["node_modules", "e2e"] で e2e を型チェック対象外にしている)。
 *   → Phase B 開始前に @playwright/test 導入 + playwright.config.ts 作成が必要
 *     (このタスクはテストファイルではないため QA の担当範囲外。Developer に依頼する)。
 *
 * 前提 (Phase B で整備):
 *   - pnpm dev でローカルサーバーが起動していること (http://localhost:3000)
 *   - テスト用の短い mp4 fixture (横撮り・縦撮り・回転メタデータ付きiPhone撮影) が e2e/fixtures/ に必要
 *   - ffmpeg 単一スレッド版のベースライン書き出し時間を事前計測し記録しておくこと (V-21 の比較対象)
 */

// Phase B: Playwright インストール後にコメントアウトを外す
// import { test } from "@playwright/test";

// Phase B で以下を有効化:
// import { expect } from "@playwright/test";
// const BASE_URL = "http://localhost:3000";
// const FIXTURE_LANDSCAPE = "e2e/fixtures/landscape-16x9.mp4";
// const FIXTURE_PORTRAIT_ROTATED = "e2e/fixtures/iphone-portrait-rotated.mov"; // 実機iPhone撮影必須
// const FIXTURE_LANDSCAPE_ROTATED = "e2e/fixtures/iphone-landscape-rotated.mov"; // 実機iPhone撮影必須

test.describe("capability detection — 実ブラウザ (desktop Chromium)", () => {
  test.todo("[V-05] desktop Chromium で WebCodecs 経路が選択される (WebCodecs 対応ブラウザ)");

  test.todo(
    "[V-06] isConfigSupported が例外を投げるよう Chromium の内部実装を差し替えられないため、" +
      "ここでは capability check 失敗時と同じ UI 経路 (ffmpeg版と同じ進捗表示/完了) になることのみ確認する",
  );
});

test.describe("書き出し速度 — WebCodecs vs ffmpeg 単一スレッド (V-21)", () => {
  test.todo(
    "[V-21] 同一 1080p 動画・同一設定で書き出しを実行し、開始から outputBlob 生成までの経過時間を計測、" +
      "事前計測した ffmpeg 単一スレッド版のベースラインと比較してレポートする (具体的な高速化倍率の閾値は " +
      "Phase 0 PoC-B で確定し、この test.todo の説明文を更新する)",
  );
});

test.describe("プレビューと書き出し結果の overlay 一致 (V-04/V-22)", () => {
  test.todo(
    "[V-22] 書き出された動画からストップウォッチ表示中のフレームを1枚抽出し、" +
      "同じ再生位置のプレビューキャンバスのスクリーンショットと並べて目視比較する " +
      "(フォント・色・位置・背景の角丸が一致すること。自動ピクセル差分は輝度/圧縮ノイズで " +
      "誤検知しやすいため、目視レビューをこの項目のPASS/FAIL根拠とする)",
  );

  test.todo(
    "[V-22] finishTime+2秒以降のフレームでサマリーテーブルが書き出し動画に焼き込まれている " +
      "(プレビューの isFinished 状態のキャンバスと同じレイアウトになっていることを目視確認)",
  );

  test.todo("[V-22] 透かし (showWatermark=false) を OFF にした書き出しでは透かしが一切焼き込まれていない (回帰確認)");
});

test.describe("回転メタデータ — iPhone 実機撮影 fixture (PM必須リスク1 / V-23)", () => {
  test.todo(
    "[V-23] 縦向き(portrait)で撮影した iPhone 動画 (回転メタデータ付き) を読み込むと、" +
      "プレビューが正しく縦向き(portrait)で表示される (横倒しにならない)",
  );

  test.todo(
    "[V-23] 上記の縦撮り動画を書き出すと、出力動画も縦向きのまま再生され、" +
      "ストップウォッチ overlay が正しい向き・正しい相対位置に焼き込まれている " +
      "(VideoDecoder が読む生フレームは回転前の状態である可能性があるため、" +
      "回転行列 (rotation matrix) をフレーム合成前に適用しているかを重点確認する)",
  );

  test.todo(
    "[V-23] 横向き(landscape, 回転なし)の iPhone 動画では従来通り横向きで正しく書き出される (回帰確認)",
  );

  test.todo(
    "[V-23] 横向きで撮影したが本体を90°回転させて保持した (回転メタデータのみ90°) iPhone 動画でも、" +
      "プレビュー・書き出しの両方で overlay が正しい向きになる (最も踏みやすい地雷ケース)",
  );
});

test.describe("実行時フォールバック — 強制失敗 (PM必須リスク3 / V-18)", () => {
  test.todo(
    "[V-18] page.addInitScript 等で VideoEncoder.prototype.configure が例外を throw するよう差し替えてから" +
      "書き出しを実行し、UI 上でエラー表示にならずに書き出しが完了する (ffmpeg 単一スレッドへの自動フォールバック)",
  );

  test.todo(
    "[V-18] 上記フォールバック発生時、進捗バーが 0% に戻ってから再度進む (二重表示にならないか目視で確認する)",
  );
});

test.describe("画質パリティ — CRF相当 vs bitrate (PM必須リスク2 / V-24)", () => {
  test.todo(
    "[V-24] 同一入力動画を WebCodecs 経路・ffmpeg 経路の両方で書き出し、ファイルサイズを比較する " +
      "(目安: 双方の比が概ね 0.5〜2.0 倍の範囲。範囲外なら bitrate テーブルの見直しが必要)",
  );

  test.todo(
    "[V-24] 両方の出力から同じ再生位置のフレームを抽出し、静止シーンと高速動作シーン (入水・ターン等) の" +
      "両方で目視比較する (ブロックノイズ・モスキートノイズが ffmpeg 版より明らかに悪化していないこと)",
  );
});
