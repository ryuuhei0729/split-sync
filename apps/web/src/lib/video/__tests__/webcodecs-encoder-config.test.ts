/**
 * Sprint Contract テスト — Phase B 実装済み
 * 対象: apps/web/src/lib/video/webcodecs-encoder-config.ts
 *   buildExportDimensions / computeBitrate / buildEncoderConfig / scaleStopwatchConfigForExport
 *
 * 検証対象の Sprint Contract 項目:
 *   V-08: resolution → width/height 変換 (16:9 横撮り)
 *   V-09: 縦撮り(9:16)動画 / 奇数丸めの境界値
 *   V-10: originalVideoHeight=0 / originalWidth=0 のゼロ除算防御
 *   V-11: bitrate が正の整数、解像度に対して単調、上限クランプ
 *   V-12: フォント/padding/borderRadius の比例スケールが既存 ffmpeg 版と同一の式
 *   V-31 (PM技術指摘の反映確認): codec level が Baseline Level 3.1 固定ではなく、
 *         width/height/fps/bitrate から動的に選ばれる (buildEncoderConfig の levelName/codecString)
 *
 * `pickAvcLevel` / `buildAvcCodecString` はモジュール非公開 (export されていない) ため、
 * `buildEncoderConfig` の戻り値 (codecString/levelName) を通じて間接的に検証する。
 */
import { describe, it, expect } from "vitest";
import { DEFAULT_STOPWATCH_CONFIG } from "@swimhub-timer/shared";
import {
  buildExportDimensions,
  computeBitrate,
  buildEncoderConfig,
  scaleStopwatchConfigForExport,
} from "../webcodecs-encoder-config";

describe("buildExportDimensions — 解像度→寸法変換", () => {
  it("[V-08] 1920x1080 (16:9) + resolution=\"1080\" は無変換 (既に1080p)", () => {
    expect(buildExportDimensions(1920, 1080, "1080")).toEqual({ width: 1920, height: 1080 });
  });

  it("[V-08] 1920x1080 + resolution=\"720\" → 1280x720 (既存 ffmpeg の scale=-2:720 と同一結果)", () => {
    expect(buildExportDimensions(1920, 1080, "720")).toEqual({ width: 1280, height: 720 });
  });

  it("[V-08] resolution=\"original\" は元動画の width/height をそのまま返す (偶数のときは無変換)", () => {
    expect(buildExportDimensions(1920, 1080, "original")).toEqual({ width: 1920, height: 1080 });
  });

  it("[V-09] 縦撮り(9:16) 1080x1920 + resolution=\"1080\" → height=1080, width=608 (607.5 を偶数丸め)", () => {
    expect(buildExportDimensions(1080, 1920, "1080")).toEqual({ width: 608, height: 1080 });
  });

  it("[V-09] 丸め結果が奇数になる入力でも width は偶数に丸められる (1921x1080, resolution=\"720\" → 1281.33→1281(奇)→1282)", () => {
    const result = buildExportDimensions(1921, 1080, "720");
    expect(result.height).toBe(720);
    expect(result.width % 2).toBe(0);
    expect(result.width).toBe(1282);
  });

  it("[V-10] originalWidth=0 のとき (メタデータ未取得) 例外を投げず 16:9 フォールバックで有限の寸法を返す", () => {
    const result = buildExportDimensions(0, 1080, "1080");
    expect(Number.isFinite(result.width)).toBe(true);
    expect(Number.isFinite(result.height)).toBe(true);
    expect(result).toEqual({ width: 1920, height: 1080 }); // 16:9 フォールバック
  });

  it("[V-10] originalHeight=0 のとき例外を投げず有限の寸法を返す (resolution=\"original\")", () => {
    const result = buildExportDimensions(1920, 0, "original");
    expect(Number.isFinite(result.width)).toBe(true);
    expect(Number.isFinite(result.height)).toBe(true);
    expect(result).toEqual({ width: 0, height: 0 }); // 検証不能な入力はゼロを返す (NaN/Infinityではない)
  });
});

describe("computeBitrate — bitrate ヒューリスティック", () => {
  it("[V-11] resolution=\"1080\" は 8,000,000 bps (固定値)", () => {
    expect(computeBitrate("1080", 1920, 1080)).toBe(8_000_000);
  });

  it("[V-11] resolution=\"720\" は 5,000,000 bps (固定値)", () => {
    expect(computeBitrate("720", 1280, 720)).toBe(5_000_000);
  });

  it("[V-11] 720p の bitrate は 1080p の bitrate より小さい (単調性)", () => {
    expect(computeBitrate("720", 1280, 720)).toBeLessThan(computeBitrate("1080", 1920, 1080));
  });

  it("[V-11] resolution=\"original\" は 1080p基準からのピクセル比でスケールする (1920x1080 → 8,000,000 と同一)", () => {
    expect(computeBitrate("original", 1920, 1080)).toBe(8_000_000);
  });

  it("[V-11] resolution=\"original\" + 4K相当 (3840x2160, ピクセル比4倍) は上限 20,000,000 にクランプされる", () => {
    expect(computeBitrate("original", 3840, 2160)).toBe(20_000_000);
  });

  it("[V-11] resolution=\"original\" + 極小解像度 (640x360) は下限 3,000,000 にクランプされる", () => {
    expect(computeBitrate("original", 640, 360)).toBe(3_000_000);
  });

  it("[V-11] bitrate は常に正の整数 (720/1080/original のいずれでも)", () => {
    for (const [res, w, h] of [
      ["720", 1280, 720],
      ["1080", 1920, 1080],
      ["original", 2560, 1440],
    ] as const) {
      const bitrate = computeBitrate(res, w, h);
      expect(bitrate).toBeGreaterThan(0);
      expect(Number.isInteger(bitrate)).toBe(true);
    }
  });
});

describe("buildEncoderConfig — codec level の動的選択 (PM技術指摘の反映確認)", () => {
  it("[V-31] 1280x720@30fps (720pぴったり) は Level 3.1 が正しく選ばれる (ITU-T H.264のMaxMBPS境界と一致)", () => {
    const config = buildEncoderConfig(1280, 720, "720", 30);
    // macroblocks=80*45=3600, mbps=3600*30=108,000 → Level3.1のMaxMBPS(108,000)にちょうど一致
    expect(config.levelName).toBe("3.1");
    expect(config.codecString).toBe("avc1.64001f");
  });

  it("[V-31] 1920x1080@30fps (1080p) は Level 3.1 (固定Baseline案) では足りず Level 4.0 が選ばれる", () => {
    const config = buildEncoderConfig(1920, 1080, "1080", 30);
    // macroblocks=120*68=8160 (Level3.1のMaxFS=3600を超過、Level3.2のMaxFS=5120も超過)
    // → Level4.0 (MaxFS=8192, MaxMBPS=245,760) が最初に適合する
    expect(config.levelName).toBe("4.0");
    expect(config.codecString).toBe("avc1.640028");
  });

  it("[V-31] 1920x1080@60fps は Level 4.0/4.1 の MaxMBPS(245,760) を超えるため Level 4.2 まで上がる", () => {
    const config = buildEncoderConfig(1920, 1080, "1080", 60);
    // macroblocks=8160, mbps=8160*60=489,600 → Level4.0/4.1(245,760)不足、Level4.2(522,240)で適合
    expect(config.levelName).toBe("4.2");
    expect(config.codecString).toBe("avc1.64002a");
  });

  it("[V-31] 同じ入力に対し buildEncoderConfig は決定的に同じ codecString を返す (isConfigSupported と実エンコーダで文字列がズレない設計の前提)", () => {
    // webcodecs-capability.ts / webcodecs-export-pipeline.ts はどちらも buildEncoderConfig() の
    // 戻り値 (codecString) をそのまま isConfigSupported / CanvasSource.fullCodecString に渡す設計
    // (コードレビューで確認済み: 両者は同じ buildEncoderConfig 呼び出し結果を共有する)。
    const a = buildEncoderConfig(1920, 1080, "1080", 30);
    const b = buildEncoderConfig(1920, 1080, "1080", 30);
    expect(a.codecString).toBe(b.codecString);
  });

  it("[V-12] codec はプロファイル High (0x64) を使う (iOSハードウェアデコード互換のため avc1.64* 系)", () => {
    const config = buildEncoderConfig(1920, 1080, "1080", 30);
    expect(config.codecString).toMatch(/^avc1\.64/);
  });

  it("[W2回帰固定] 4K60相当 (3840x2160, fps=60) は Level 5.2以上 (level_idc >= 0x34) が選ばれる (5.1天井に戻す回帰の検知)", () => {
    // W2: 以前は AVC_LEVELS が Level 5.1 で頭打ちだったため、4K60 相当 (最近のiPhoneが
    // 日常的に撮影する解像度/フレームレート) は必ず probe に失敗し ffmpeg フォールバックに
    // 落ちていた (QA Sprint Contract 指摘)。Level 5.1 (MaxMBPS=983,040) では
    // 3840x2160@60fps (macroblocks=240*135=32,400, mbps=32,400*60=1,944,000) を
    // カバーできず、Level 5.2 (MaxMBPS=2,073,600) が必要。
    const config = buildEncoderConfig(3840, 2160, "original", 60);
    expect(config.levelName).toBe("5.2");
    expect(config.codecString).toBe("avc1.640034");

    const levelIdcHex = parseInt(config.codecString.slice(-2), 16);
    expect(levelIdcHex).toBeGreaterThanOrEqual(0x34);
  });
});

describe("scaleStopwatchConfigForExport — フォント/padding比例スケール (既存仕様の移植)", () => {
  const base = { ...DEFAULT_STOPWATCH_CONFIG, fontSize: 48, padding: 12, borderRadius: 4 };

  it("[V-12] originalVideoHeight=1080, outputHeight=720 → fontSize=32, padding=8, borderRadius=3 (Math.round(値*2/3)と同一)", () => {
    const scaled = scaleStopwatchConfigForExport(base, "720", 1080, 720);
    expect(scaled.fontSize).toBe(32);
    expect(scaled.padding).toBe(8);
    expect(scaled.borderRadius).toBe(3);
  });

  it("[V-12] resolution=\"original\" のとき config は一切スケールされずそのまま返る", () => {
    const scaled = scaleStopwatchConfigForExport(base, "original", 1080, 1080);
    expect(scaled).toEqual(base);
  });

  it("[V-10] originalVideoHeight<=0 (メタデータ未取得) のとき config は一切スケールされずそのまま返る (ゼロ除算防御)", () => {
    const scaled = scaleStopwatchConfigForExport(base, "720", 0, 720);
    expect(scaled).toEqual(base);
  });

  it("[V-12] スケール対象外のフィールド (textColor 等) は変更されない", () => {
    const scaled = scaleStopwatchConfigForExport(base, "720", 1080, 720);
    expect(scaled.textColor).toBe(base.textColor);
    expect(scaled.anchor).toBe(base.anchor);
  });
});
