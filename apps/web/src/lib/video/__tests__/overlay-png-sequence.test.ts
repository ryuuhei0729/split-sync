/**
 * Sprint Contract テスト — Phase B 実装済み (QA)
 * 対象: apps/web/src/lib/video/overlay-png-sequence.ts
 *   overlayPngFileName / generateOverlayPngSequence
 *
 * `createOverlayFrameCompositorContext` は実 OffscreenCanvas を要求し jsdom には
 * 存在しないため、`../overlay-frame-renderer` を丸ごとモックして
 * generateOverlayPngSequence 自身のフレーム数・タイムスタンプ・onFrame 呼び出し
 * 契約のみを検証する (描画ロジック自体は overlay-frame-renderer.test.ts の担当)。
 *
 * 検証対象の Sprint Contract 項目:
 *   V-09: 生成される overlay_%05d.png の枚数が Math.ceil(durationSeconds * fps) と
 *         一致する (境界値: 極端に短い尺でも最低1枚)
 *   V-10: onFrame が index 順に一度ずつ、正しいファイル名パターンで呼ばれる
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../overlay-frame-renderer", () => ({
  createOverlayFrameCompositorContext: vi.fn(),
  compositeOverlayFrame: vi.fn(),
}));

import { createOverlayFrameCompositorContext, compositeOverlayFrame } from "../overlay-frame-renderer";
import { generateOverlayPngSequence, overlayPngFileName, computeOverlayFrameCount } from "../overlay-png-sequence";
import { DEFAULT_STOPWATCH_CONFIG } from "@swimhub-timer/shared";

// jsdom's `Blob` polyfill has no `arrayBuffer()` method, so a real `Blob` can't stand in
// for the browser one here; use a minimal duck-typed fake instead (matches the subset
// `generateOverlayPngSequence` actually calls: `await blob.arrayBuffer()`).
function makeFakeCanvas(): OffscreenCanvas {
  return {
    convertToBlob: vi.fn(async () => ({
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    })),
  } as unknown as OffscreenCanvas;
}

function baseOptions(overrides: Partial<Parameters<typeof generateOverlayPngSequence>[0]> = {}) {
  return {
    width: 1920,
    height: 1080,
    fps: 30,
    durationSeconds: 2,
    startSignalTime: 0,
    stopwatchConfig: DEFAULT_STOPWATCH_CONFIG,
    splitTimes: [],
    isFinished: false,
    finishTime: null,
    showWatermark: false,
    watermarkIcon: null,
    onFrame: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createOverlayFrameCompositorContext).mockImplementation((width: number, height: number) => ({
    canvas: makeFakeCanvas(),
    ctx: {} as OffscreenCanvasRenderingContext2D,
    width,
    height,
  }));
});

describe("overlayPngFileName — ファイル名パターン", () => {
  it("0-padded 5桁 (overlay_%05d.png 相当) を生成する", () => {
    expect(overlayPngFileName(0)).toBe("overlay_00000.png");
    expect(overlayPngFileName(1)).toBe("overlay_00001.png");
    expect(overlayPngFileName(12345)).toBe("overlay_12345.png");
  });
});

describe("computeOverlayFrameCount — フレーム数計算の単一ソース (V-09)", () => {
  // export-pipeline.ts の onFrame コールバックは `generateOverlayPngSequence` の戻り値
  // (完了後にしか確定しない) を待たずに、この関数を独立に呼んで進捗計算の分母を得る設計に
  // なっている (TDZ 回帰テスト参照)。generateOverlayPngSequence 自身の内部フレーム数計算も
  // 同じ関数を使っているため、両者が計算式的に乖離しないことをここで固定する。
  it("[V-09] durationSeconds=2, fps=30 → 60 (Math.ceil(2*30))", () => {
    expect(computeOverlayFrameCount(2, 30)).toBe(60);
  });

  it("[V-09] 整数でない場合は切り上げる (1.01秒*30fps=30.3→31)", () => {
    expect(computeOverlayFrameCount(1.01, 30)).toBe(31);
  });

  it("[境界値] durationSeconds=0 でも最低1を返す", () => {
    expect(computeOverlayFrameCount(0, 30)).toBe(1);
  });

  it("[V-09] generateOverlayPngSequence が実際に生成するフレーム数と一致する (単一ソース確認)", async () => {
    const result = await generateOverlayPngSequence(baseOptions({ durationSeconds: 1.7, fps: 24 }));
    expect(result.frameCount).toBe(computeOverlayFrameCount(1.7, 24));
  });
});

describe("generateOverlayPngSequence — フレーム数 (V-09)", () => {
  it("[V-09] durationSeconds=2, fps=30 → frameCount=60 (Math.ceil(2*30))", async () => {
    const result = await generateOverlayPngSequence(baseOptions({ durationSeconds: 2, fps: 30 }));
    expect(result.frameCount).toBe(60);
  });

  it("[V-09] durationSeconds*fps が整数でない場合は切り上げる (例: 1.01秒*30fps=30.3→31枚)", async () => {
    const result = await generateOverlayPngSequence(baseOptions({ durationSeconds: 1.01, fps: 30 }));
    expect(result.frameCount).toBe(31);
  });

  it("[境界値] durationSeconds が 0 に近い極端に短い尺でも最低1枚は生成される", async () => {
    const result = await generateOverlayPngSequence(baseOptions({ durationSeconds: 0.001, fps: 30 }));
    expect(result.frameCount).toBe(1);
  });

  it("[境界値] durationSeconds=0 でも最低1枚は生成される (0除算・空シーケンスにならない)", async () => {
    const result = await generateOverlayPngSequence(baseOptions({ durationSeconds: 0, fps: 30 }));
    expect(result.frameCount).toBe(1);
  });

  it("[異常系] width/height が不正 (0以下) なら例外を投げる", async () => {
    await expect(generateOverlayPngSequence(baseOptions({ width: 0 }))).rejects.toThrow();
    await expect(generateOverlayPngSequence(baseOptions({ height: -10 }))).rejects.toThrow();
  });

  it("[異常系] fps が不正 (0以下/NaN) なら例外を投げる", async () => {
    await expect(generateOverlayPngSequence(baseOptions({ fps: 0 }))).rejects.toThrow();
    await expect(generateOverlayPngSequence(baseOptions({ fps: NaN }))).rejects.toThrow();
  });
});

describe("generateOverlayPngSequence — onFrame 契約とタイムスタンプ (V-10)", () => {
  it("[V-10] onFrame が 0 始まりの index 順に、フレーム数と同じ回数だけ呼ばれる", async () => {
    const onFrame = vi.fn();
    await generateOverlayPngSequence(baseOptions({ durationSeconds: 0.1, fps: 30, onFrame }));
    // Math.ceil(0.1*30) = 3
    expect(onFrame).toHaveBeenCalledTimes(3);
    expect(onFrame.mock.calls.map((c) => c[0])).toEqual([0, 1, 2]);
  });

  it("[V-10] onFrame に渡されるバイト列は PNG Blob から取り出した Uint8Array である", async () => {
    const onFrame = vi.fn();
    await generateOverlayPngSequence(baseOptions({ durationSeconds: 0.04, fps: 30, onFrame }));
    // toHaveBeenCalledTimes-style intent: onFrame must have been called for this to be meaningful;
    // an unmet call would throw on the next line instead of silently passing.
    const png = onFrame.mock.calls[0]![1];
    expect(png).toBeInstanceOf(Uint8Array);
    expect(Array.from(png as Uint8Array)).toEqual([1, 2, 3]);
  });

  it("[V-10] 各フレームの timestamp (compositeOverlayFrame への引数) が index/fps と一致する", async () => {
    await generateOverlayPngSequence(baseOptions({ durationSeconds: 0.1, fps: 30 }));
    const timestamps = vi.mocked(compositeOverlayFrame).mock.calls.map((c) => (c[1] as { timestamp: number }).timestamp);
    expect(timestamps).toEqual([0, 1 / 30, 2 / 30]);
  });

  it("[V-06/V-07/V-08 受け渡し] splitTimes/isFinished/finishTime/showWatermark/watermarkIconがそのままcompositeOverlayFrameに渡る", async () => {
    const splitTimes = [{ distance: 50, time: 1, lapTime: 1, memo: "" }];
    const watermarkIcon = { icon: true } as unknown;
    await generateOverlayPngSequence(
      baseOptions({
        durationSeconds: 0.04,
        fps: 30,
        splitTimes,
        isFinished: true,
        finishTime: 10,
        showWatermark: true,
        watermarkIcon,
      }),
    );
    const input = vi.mocked(compositeOverlayFrame).mock.calls[0]![1] as unknown as Record<string, unknown>;
    expect(input.splitTimes).toBe(splitTimes);
    expect(input.isFinished).toBe(true);
    expect(input.finishTime).toBe(10);
    expect(input.showWatermark).toBe(true);
    expect(input.watermarkIcon).toBe(watermarkIcon);
  });

  it("[異常系] compositeOverlayFrame が例外を投げると generateOverlayPngSequence も reject する (握りつぶさない)", async () => {
    vi.mocked(compositeOverlayFrame).mockImplementationOnce(() => {
      throw new Error("draw failed");
    });
    await expect(generateOverlayPngSequence(baseOptions())).rejects.toThrow("draw failed");
  });

  it("[異常系] onFrame が reject すると generateOverlayPngSequence も reject する (ffmpeg書き込み失敗を握りつぶさない)", async () => {
    const onFrame = vi.fn(async () => {
      throw new Error("ffmpeg writeFile failed");
    });
    await expect(generateOverlayPngSequence(baseOptions({ onFrame }))).rejects.toThrow("ffmpeg writeFile failed");
  });
});
