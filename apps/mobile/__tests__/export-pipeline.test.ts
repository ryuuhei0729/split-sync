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
