/**
 * Sprint Contract テストスケルトン
 * ゴール後サマリーオーバーレイ — export-pipeline フィルタチェーン生成ロジック
 *
 * NOTE: このファイルはスケルトンのみ。
 * - exportVideoWithStopwatch のシグネチャ変更 (summaryImageUri 追加) は未実装。
 * - Phase B で Developer が実装完了後、コメントアウトを外して実装する。
 * - FFmpegKit は jest.mock でモックする。
 * - Node.js / Jest 環境で動作可能 (React Native 依存なし)。
 *
 * 対象ファイル (実装後):
 *   apps/mobile/lib/video/export-pipeline.ts
 *
 * Sprint Contract 参照:
 *   V-06: summaryImageUri あり → filter_complex に overlay フィルタが含まれる
 *   V-07: summaryImageUri なし → filter_complex 不使用 (-vf のみ)
 *   V-08: buildSplitFilters が呼ばれない (通過時ポップアップロジック削除)
 *   V-09: icon + summary の 3 入力 filter_complex が競合しない
 *   V-10: summaryImageUri が null の場合はフォールバック (ストップウォッチのみ書き出し)
 */

// ---- FFmpegKit モック ----
// jest.mock("ffmpeg-kit-react-native", () => ({
//   FFmpegKit: {
//     execute: jest.fn().mockResolvedValue({
//       getReturnCode: jest.fn().mockResolvedValue({ isSuccess: () => true }),
//       getLogsAsString: jest.fn().mockResolvedValue(""),
//     }),
//   },
//   FFmpegKitConfig: {
//     enableStatisticsCallback: jest.fn(),
//   },
//   ReturnCode: {
//     isSuccess: jest.fn().mockReturnValue(true),
//   },
// }));

// ---- expo-file-system モック ----
// jest.mock("expo-file-system", () => ({
//   Paths: { cache: "/tmp/cache/" },
//   File: jest.fn().mockImplementation((_dir: string, name?: string) => ({
//     uri: `/tmp/cache/${name ?? "output.mp4"}`,
//     delete: jest.fn(),
//   })),
// }));

// ---- expo-asset モック (watermark icon) ----
// jest.mock("expo-asset", () => ({
//   Asset: {
//     fromModule: jest.fn().mockReturnValue({
//       downloadAsync: jest.fn().mockResolvedValue(undefined),
//       localUri: null, // icon なし → iconUri = null のパス
//     }),
//   },
// }));

import {
  exportVideoWithStopwatch,
} from "../lib/video/export-pipeline";
import type { StopwatchConfig, SplitTime, ExportSettings } from "@swimhub-timer/shared";
// import { FFmpegKit } from "ffmpeg-kit-react-native";

// ---- テスト用フィクスチャ ----

// const defaultConfig: StopwatchConfig = {
//   fontSize: 48,
//   padding: 12,
//   borderRadius: 8,
//   textColor: "#FFFFFF",
//   backgroundColor: "rgba(0,0,0,0.75)",
//   fontFamily: "monospace",
//   position: { x: 0.05, y: 0.05 },
//   anchor: "top-left",
// };

// const exportSettings: ExportSettings = { resolution: "original" };

// const threeSplits: SplitTime[] = [
//   { distance: 50,  time: 30.12, lapTime: 30.12, memo: "" },
//   { distance: 100, time: 62.45, lapTime: 32.33, memo: "" },
// ];

// function captureFFmpegCommand(): string {
//   const calls = (FFmpegKit.execute as jest.Mock).mock.calls;
//   return calls[calls.length - 1][0] as string;
// }

describe("export-pipeline — summaryImageUri によるフィルタ分岐", () => {
  describe("summaryImageUri あり (サマリー PNG 焼き込みモード)", () => {
    it.skip("should use filter_complex with 3 inputs when summaryImageUri is provided", () => {
      // 前提: videoUri, iconUri が解決可能, summaryImageUri = "file:///tmp/summary.png"
      // 操作: exportVideoWithStopwatch(..., summaryImageUri: "file:///tmp/summary.png")
      // 期待: FFmpegKit.execute に渡されるコマンドが "-i ... -i ... -i ..." で3入力になる
      //        且つ filter_complex が "[0:v]...[bg];[1:v]...[icon];[2:v]...[summary];[bg][icon]overlay...[tmp];[tmp][summary]overlay..."
      //        のような形式になる
      // 検証: captureFFmpegCommand() に "-i" が3回含まれる / "filter_complex" が含まれる
    });

    it.skip("should position summary overlay to cover the full video content area", () => {
      // 前提: summaryImageUri あり
      // 期待: filter_complex の overlay フィルタの座標が "0:0" (左上起点) または finishTime ベースの enable 条件付き
      // 検証: captureFFmpegCommand() に "overlay=0:0" または "overlay=W/2-w/2" が含まれる
    });

    it.skip("should apply summary overlay only from finishTime onwards (enable condition)", () => {
      // 前提: isFinished = true, finishTime = 62.5, summaryImageUri あり
      // 期待: summary overlay の filter_complex に "enable='gte(t,..." のような enable 条件が付く
      //        ゴール前の時間帯はサマリーが表示されない
      // 検証: captureFFmpegCommand() に "gte(t, 62.5" が含まれる (startSignalTime + finishTime の絶対時刻)
    });
  });

  describe("summaryImageUri なし (フォールバック: ストップウォッチのみ)", () => {
    it.skip("should NOT use filter_complex when summaryImageUri is null", () => {
      // 前提: summaryImageUri = null, iconUri = null
      // 操作: exportVideoWithStopwatch(..., summaryImageUri: null)
      // 期待: FFmpegKit.execute に渡されるコマンドが "-vf ..." 形式 (filter_complex 不使用)
      // 検証: captureFFmpegCommand() に "filter_complex" が含まれない
      //        かつ "-vf" が含まれる
    });

    it.skip("should still include stopwatch drawtext filters when summaryImageUri is null", () => {
      // 前提: summaryImageUri = null
      // 期待: ストップウォッチの drawtext フィルタが引き続き生成される
      // 検証: captureFFmpegCommand() に "drawtext=" が含まれる
    });
  });

  describe("旧 buildSplitFilters の削除確認 (回帰テスト)", () => {
    it.skip("should NOT include split popup drawtext filters in the command", () => {
      // 前提: splitTimes に複数スプリットあり
      // 操作: exportVideoWithStopwatch(...) を呼ぶ
      // 期待: 旧 SPLIT_DISPLAY_DURATION=3 ベースの "gte(t, X)*lt(t, X+3)" パターンが含まれない
      //        = スプリット通過時ポップアップフィルタが削除されている
      // 検証: captureFFmpegCommand() に /gte\(t, [\d.]+\)\*lt\(t, [\d.]+\)/ がマッチしない
    });
  });

  describe("icon + summary の 3 入力 filter_complex 競合確認", () => {
    it.skip("should correctly compose icon overlay and summary overlay in sequence", () => {
      // 前提: iconUri が有効 (expo-asset の localUri が返る), summaryImageUri あり
      // 期待: filter_complex のストリームラベルが一意で競合しない
      //        例: [0:v]drawtext...[bg]; [1:v]scale..[icon]; [bg][icon]overlay[tmp]; [2:v]...[summary]; [tmp][summary]overlay[v]
      // 検証: captureFFmpegCommand() に "filter_complex" が含まれ、
      //        "[v]" の出力ラベルが存在し、"-map [v]" が含まれる
    });
  });

  describe("解像度スケール + サマリー合成", () => {
    it.skip("should prepend scale filter before drawtext/overlay when resolution is not original", () => {
      // 前提: exportSettings.resolution = "720", summaryImageUri あり
      // 期待: filter_complex 内の最初のフィルタが "scale=-2:720" で始まる
      // 検証: captureFFmpegCommand() に "scale=-2:720" が filter_complex の先頭付近に含まれる
    });
  });
});

// =============================================================================
// Sprint Contract テストスケルトン
// HW エンコーダ + 音声 Copy 最適化スプリント
//
// NOTE: このブロックはスケルトンのみ。
// - getHwEncoder / buildVideoBitrateArgs / buildVideoEncoderArgs / buildAudioArgs /
//   detectAudioCodec は未実装のため、import はコメントアウト。
// - Phase B で Developer が実装完了後、コメントアウトを外して実装する。
// - テストフレームワーク未導入のため、テスト自体は it.todo() で記述する。
//   純粋関数 (buildVideoBitrateArgs / buildVideoEncoderArgs / buildAudioArgs) のみ
//   実環境なしで単体テスト可能。
//
// 対象ファイル (実装後):
//   apps/mobile/lib/video/export-pipeline.ts
//
// Sprint Contract 参照 (HW エンコーダスプリント):
//   HW-V-01: buildVideoBitrateArgs — 各 resolution → 期待ビットレート文字列
//   HW-V-02: buildVideoEncoderArgs — encoder=null → libx264 veryfast
//   HW-V-03: buildVideoEncoderArgs — encoder=h264_videotoolbox → HW 引数
//   HW-V-04: buildVideoEncoderArgs — encoder=h264_mediacodec → HW 引数
//   HW-V-05: buildAudioArgs — "aac" → "-c:a copy"
//   HW-V-06: buildAudioArgs — "AAC" (大文字) → "-c:a copy" (case-insensitive)
//   HW-V-07: buildAudioArgs — "pcm_s16le" → "-c:a aac -b:a 128k"
//   HW-V-08: buildAudioArgs — null → "-c:a aac -b:a 128k"
//   HW-V-09: buildAudioArgs — undefined → "-c:a aac -b:a 128k"
// =============================================================================

// import {
//   buildVideoBitrateArgs,
//   buildVideoEncoderArgs,
//   buildAudioArgs,
// } from "../lib/video/export-pipeline";

describe("export-pipeline — HW エンコーダ最適化 (HW エンコーダスプリント)", () => {

  // ---------- buildVideoBitrateArgs (純粋関数) ----------
  describe("buildVideoBitrateArgs(resolution)", () => {
    it.todo('resolution="original" → 高ビットレート文字列を返す');
    // 期待例: ["-b:v", "8M"] または ["-maxrate", "8M", "-bufsize", "16M"]
    // 検証: buildVideoBitrateArgs("original") の戻り値が期待する文字列配列に一致する

    it.todo('resolution="1080" → 中ビットレート文字列を返す');
    // 期待例: ["-b:v", "5M"] 相当
    // 検証: buildVideoBitrateArgs("1080") の戻り値が期待する文字列配列に一致する

    it.todo('resolution="720" → 中ビットレート文字列を返す');
    // 期待例: ["-b:v", "3M"] 相当
    // 検証: buildVideoBitrateArgs("720") の戻り値が期待する文字列配列に一致する

    // NOTE: resolution="480" は ExportResolution 型 ("720" | "1080" | "original") に存在しない。
    // buildVideoBitrateArgs は default ケースで "720" と同じ低ビットレートを返す。
    // TypeScript レベルで "480" は渡せないため、このケースのテストは不要。削除済み。
  });

  // ---------- buildVideoEncoderArgs (純粋関数) ----------
  describe("buildVideoEncoderArgs(encoder, resolution, crf)", () => {
    it.todo('encoder=null → libx264 + preset veryfast + -crf が出力に含まれる');
    // 前提: encoder = null, resolution = "720", crf = "23"
    // 期待: 戻り値配列に "-c:v", "libx264", "-preset", "veryfast", "-crf", "23" が含まれる
    // 検証: buildVideoEncoderArgs(null, "720", "23") の戻り値を検査

    it.todo('encoder=null のとき preset が "medium" でない (veryfast に変更されている)');
    // 前提: encoder = null
    // 期待: 戻り値に "medium" が含まれない
    // 検証: buildVideoEncoderArgs(null, "original", "18").join(" ") に "medium" が含まれない

    it.todo('encoder="h264_videotoolbox" → HW エンコーダ引数が出力に含まれる');
    // 前提: encoder = "h264_videotoolbox", resolution = "original", crf = "18"
    // 期待: 戻り値配列に "-c:v", "h264_videotoolbox" が含まれる
    //        かつ "-preset" が含まれない (HW エンコーダは preset 非対応)
    // 検証: buildVideoEncoderArgs("h264_videotoolbox", "original", "18") を検査

    it.todo('encoder="h264_mediacodec" → HW エンコーダ引数が出力に含まれる');
    // 前提: encoder = "h264_mediacodec", resolution = "720", crf = "23"
    // 期待: 戻り値配列に "-c:v", "h264_mediacodec" が含まれる
    // 検証: buildVideoEncoderArgs("h264_mediacodec", "720", "23") を検査

    it.todo('encoder="h264_videotoolbox" のとき buildVideoBitrateArgs の結果が含まれる');
    // 前提: HW エンコーダ使用時は CRF 非対応のため -b:v でビットレート指定
    // 期待: 戻り値に "-b:v" が含まれる
    // 検証: buildVideoEncoderArgs("h264_videotoolbox", "720", "23").join(" ") に "-b:v" が含まれる
  });

  // ---------- buildAudioArgs (純粋関数) ----------
  describe("buildAudioArgs(codec)", () => {
    it.todo('codec="aac" → "-c:a copy" を返す');
    // 期待: buildAudioArgs("aac") が ["-c:a", "copy"] に一致する

    it.todo('codec="AAC" (大文字) → "-c:a copy" を返す (case-insensitive)');
    // 期待: buildAudioArgs("AAC") が ["-c:a", "copy"] に一致する
    // 目的: audioCodec の case sensitivity リスク (Planner Risk 項目) を検証

    it.todo('codec="Aac" (混合大文字) → "-c:a copy" を返す');
    // 期待: buildAudioArgs("Aac") が ["-c:a", "copy"] に一致する

    it.todo('codec="pcm_s16le" → "-c:a aac -b:a 128k" を返す');
    // 期待: buildAudioArgs("pcm_s16le") が ["-c:a", "aac", "-b:a", "128k"] に一致する

    it.todo('codec="mp3" → "-c:a aac -b:a 128k" を返す');
    // 期待: buildAudioArgs("mp3") が ["-c:a", "aac", "-b:a", "128k"] に一致する

    it.todo('codec=null → "-c:a aac -b:a 128k" を返す (FFprobe 失敗時の安全側挙動)');
    // 期待: buildAudioArgs(null) が ["-c:a", "aac", "-b:a", "128k"] に一致する
    // 目的: FFprobe 失敗時の安全側挙動確認

    it.todo('codec=undefined → "-c:a aac -b:a 128k" を返す');
    // 期待: buildAudioArgs(undefined) が ["-c:a", "aac", "-b:a", "128k"] に一致する
  });

  // ---------- getHwEncoder (Platform 依存 — モック必要) ----------
  describe("getHwEncoder() [it.todo: モック必要]", () => {
    it.todo('Platform.OS="ios" → "h264_videotoolbox" を返す');
    // モック: Platform.OS = "ios"
    // 期待: getHwEncoder() が "h264_videotoolbox" を返す

    it.todo('Platform.OS="android" → "h264_mediacodec" を返す');
    // モック: Platform.OS = "android"
    // 期待: getHwEncoder() が "h264_mediacodec" を返す

    it.todo('Platform.OS="web" → null を返す');
    // モック: Platform.OS = "web" (or "windows")
    // 期待: getHwEncoder() が null を返す
  });

  // ---------- detectAudioCodec (FFprobeKit 依存 — モック必要) ----------
  describe("detectAudioCodec(videoUri) [it.todo: FFprobeKit モック必要]", () => {
    it.todo('FFprobeKit が "aac" を返す → "aac" を返す');
    // モック: FFprobeKit.execute が JSON ストリーム情報を返す (codec_name="aac")
    // 期待: detectAudioCodec("file:///test.mp4") が "aac" に一致する

    it.todo('FFprobeKit がエラーを返す → null を返す (安全側挙動)');
    // モック: FFprobeKit.execute が失敗ステータスを返す
    // 期待: detectAudioCodec("file:///test.mp4") が null を返す (例外を throw しない)

    it.todo('動画に音声ストリームがない → null を返す');
    // モック: FFprobeKit が空ストリーム JSON を返す
    // 期待: detectAudioCodec("file:///no-audio.mp4") が null を返す
  });

  // ---------- exportVideoWithStopwatch — HW フォールバック統合 (モック必要) ----------
  describe("exportVideoWithStopwatch — HW → SW フォールバック [it.todo: FFmpegKit モック必要]", () => {
    it.todo('iOS Simulator で HW フォールバックが動作する (1回のみ再試行)');
    // 前提: getHwEncoder = "h264_videotoolbox" だが、execute が失敗
    // 期待: FFmpegKit.execute が 2 回呼ばれる (1回目: HW, 2回目: SW libx264 veryfast)
    //        かつ 2 回目は成功し、outputPath が返る

    it.todo('HW フォールバック後の再試行コマンドに "-preset veryfast" が含まれる');
    // 期待: フォールバック後のコマンドに "libx264" と "veryfast" が含まれる
    //        "medium" は含まれない

    it.todo('HW も SW も失敗した場合 → Error が throw される');
    // 前提: 両方の execute が失敗
    // 期待: exportVideoWithStopwatch が Error を throw する

    it.todo('フォールバックは 1 回のみ (SW フォールバック後は再試行しない)');
    // 前提: HW 失敗 → SW 失敗
    // 期待: FFmpegKit.execute が 2 回のみ呼ばれる (3 回目は呼ばれない)

    it.todo('音声 AAC ケースで -c:a copy が FFmpeg コマンドに含まれる');
    // 前提: detectAudioCodec が "aac" を返す
    // 期待: FFmpegKit.execute に渡されるコマンドに "-c:a copy" が含まれる
    //        "-c:a aac -b:a 128k" が含まれない

    it.todo('音声 非AAC ケースで -c:a aac -b:a 128k が FFmpeg コマンドに含まれる');
    // 前提: detectAudioCodec が "pcm_s16le" を返す
    // 期待: FFmpegKit.execute に渡されるコマンドに "-c:a aac -b:a 128k" が含まれる

    it.todo('FCResult あり (summaryImageUri 指定) でも HW エンコーダが使用される');
    // 前提: summaryImageUri あり, getHwEncoder = "h264_videotoolbox"
    // 期待: filter_complex パスのコマンドに "h264_videotoolbox" が含まれる

    it.todo('FCResult なし (-vf パス) でも HW エンコーダが使用される');
    // 前提: summaryImageUri = null, iconUri = null, getHwEncoder = "h264_videotoolbox"
    // 期待: -vf パスのコマンドに "h264_videotoolbox" が含まれる
  });
});
