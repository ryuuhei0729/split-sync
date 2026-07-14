/**
 * Sprint Contract テスト — Phase B 実装済み
 * 対象: apps/web/src/lib/video/webcodecs-frame-compositor.ts
 *   frameTimestampMicros / summaryOverlayStartMicros / compositeFrame
 *
 * 検証対象の Sprint Contract 項目:
 *   V-13: frameIndex/fps → VideoFrame タイムスタンプ (マイクロ秒) 変換
 *   V-14: サマリー合成開始タイムスタンプの計算 (既存 SUMMARY_DELAY_SECONDS 定数を再利用)
 *   V-15 (実装に合わせて更新 — 元は「summaryImageData=null でスキップ」だったが、実装は
 *         isFinished/finishTime/timestamp で同等の分岐を行う設計になったため、その形で検証する):
 *         isFinished=false、または summaryOverlayStartMicros 未到達のときはサマリーを描画せず
 *         通常のストップウォッチ/スプリットを描画する。到達後はサマリーのみを描画する (排他)。
 *   V-22c: showWatermark の ON/OFF が drawWatermark 呼び出しに反映される
 *
 * `compositeFrame` は `@swimhub-timer/shared` の draw* 関数を呼ぶだけなので、実際の描画結果
 * ではなく「どの draw 関数が呼ばれたか」を vi.mock で検証する (overlay-renderer 自体のテストは
 * apps/shared/__tests__/overlay-renderer.test.ts の担当領域であり、ここでは分岐ロジックのみを見る)。
 * `createFrameCompositorContext` は実 OffscreenCanvas を要求し jsdom には存在しないため使わず、
 * FrameCompositorContext を手動でモック構築する。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@swimhub-timer/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@swimhub-timer/shared")>();
  return {
    ...actual,
    drawStopwatch: vi.fn(),
    drawPassedSplit: vi.fn(),
    drawFinishSummary: vi.fn(),
    drawWatermark: vi.fn(),
  };
});

import { drawStopwatch, drawPassedSplit, drawFinishSummary, drawWatermark } from "@swimhub-timer/shared";
import { DEFAULT_STOPWATCH_CONFIG } from "@swimhub-timer/shared";
import type { SplitTime } from "@swimhub-timer/shared";
import {
  frameTimestampMicros,
  summaryOverlayStartMicros,
  compositeFrame,
} from "../webcodecs-frame-compositor";
import type { FrameCompositorContext, FrameCompositorInput } from "../webcodecs-types";

describe("frameTimestampMicros — フレームインデックス→マイクロ秒", () => {
  it("[V-13] frameIndex=0, fps=30 → timestamp=0", () => {
    expect(frameTimestampMicros(0, 30)).toBe(0);
  });

  it("[V-13] frameIndex=30, fps=30 → timestamp=1,000,000 マイクロ秒 (ちょうど1秒)", () => {
    expect(frameTimestampMicros(30, 30)).toBe(1_000_000);
  });

  it("[V-13] frameIndex=30, fps=29.97 (NTSC) → timestamp=1,001,001 マイクロ秒 (四捨五入)", () => {
    expect(frameTimestampMicros(30, 29.97)).toBe(1_001_001);
  });

  it("[V-13] frameIndex=899, fps=30 (長尺動画) → timestamp=29,966,667 マイクロ秒 (丸め誤差蓄積なし)", () => {
    expect(frameTimestampMicros(899, 30)).toBe(29_966_667);
  });

  it("[V-13] frameIndex が負数のとき例外を投げず 0 を返す (境界値ガード)", () => {
    expect(frameTimestampMicros(-1, 30)).toBe(0);
  });

  it("[V-13] fps=0 のとき例外を投げず 0 を返す (ゼロ除算ガード)", () => {
    expect(frameTimestampMicros(10, 0)).toBe(0);
  });

  it("[V-13] frameIndex/fps が NaN のとき例外を投げず 0 を返す", () => {
    expect(frameTimestampMicros(NaN, 30)).toBe(0);
    expect(frameTimestampMicros(10, NaN)).toBe(0);
  });
});

describe("summaryOverlayStartMicros — サマリー表示開始タイムスタンプ", () => {
  it("[V-14] startSignalTime=5.0, finishTime=45.0 → 52,000,000 マイクロ秒 (既存 ffmpeg 版 summaryEnableT と同一の式)", () => {
    expect(summaryOverlayStartMicros(5.0, 45.0)).toBe(52_000_000);
  });

  it("[V-14] finishTime=0 の境界値でも例外を投げず正しい値を返す", () => {
    expect(summaryOverlayStartMicros(3.0, 0)).toBe(5_000_000);
  });
});

describe("compositeFrame — サマリー表示のタイミング分岐 (V-15 実装形に合わせた検証)", () => {
  function makeContext(): FrameCompositorContext {
    const ctx = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      fillText: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      fill: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      closePath: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      fillStyle: "",
      globalAlpha: 1,
      textBaseline: "top" as const,
      font: "",
      measureText: vi.fn(() => ({ width: 10 })),
    };
    return { ctx: ctx as unknown as OffscreenCanvasRenderingContext2D, canvas: {} as OffscreenCanvas, width: 1920, height: 1080 };
  }

  const baseInput: FrameCompositorInput = {
    sourceFrame: {} as CanvasImageSource,
    timestamp: 0,
    startSignalTime: 5,
    stopwatchConfig: DEFAULT_STOPWATCH_CONFIG,
    splitTimes: [],
    isFinished: false,
    finishTime: null,
    raceDistance: null,
    showWatermark: false,
    watermarkIcon: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("[V-15] isFinished=false のときは常に通常のストップウォッチを描画し、サマリーは描画しない", () => {
    compositeFrame(makeContext(), { ...baseInput, timestamp: 999 }); // どれだけ時間が進んでも
    expect(drawStopwatch).toHaveBeenCalledTimes(1);
    expect(drawFinishSummary).not.toHaveBeenCalled();
  });

  it("[V-15] isFinished=true だが summaryOverlayStartMicros 未到達のときはストップウォッチを描画 (finishTime で凍結)", () => {
    // startSignalTime=5, finishTime=45 → 閾値は52秒。timestamp=51 (閾値未到達)
    compositeFrame(makeContext(), { ...baseInput, isFinished: true, finishTime: 45, timestamp: 51 });
    expect(drawStopwatch).toHaveBeenCalledTimes(1);
    expect(drawFinishSummary).not.toHaveBeenCalled();
    // elapsed は finishTime にクランプされている (51-5=46 > 45 → 45)
    expect(drawStopwatch).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), 45);
  });

  it("[V-15] 閾値ちょうど (timestamp=52) でサマリーに切り替わる (ffmpeg版 enable='gte(t,...)' と同じ >= 判定)", () => {
    compositeFrame(makeContext(), { ...baseInput, isFinished: true, finishTime: 45, timestamp: 52 });
    expect(drawFinishSummary).toHaveBeenCalledTimes(1);
    expect(drawStopwatch).not.toHaveBeenCalled();
  });

  it("[V-15] 閾値の直前 (timestamp=51.999999) ではまだストップウォッチのまま", () => {
    compositeFrame(makeContext(), { ...baseInput, isFinished: true, finishTime: 45, timestamp: 51.999999 });
    expect(drawStopwatch).toHaveBeenCalledTimes(1);
    expect(drawFinishSummary).not.toHaveBeenCalled();
  });

  it("[V-15] finishTime=null (未フィニッシュ) のときはタイムスタンプがどれだけ進んでもサマリーは出ない", () => {
    compositeFrame(makeContext(), { ...baseInput, isFinished: true, finishTime: null, timestamp: 10_000 });
    expect(drawFinishSummary).not.toHaveBeenCalled();
    expect(drawStopwatch).toHaveBeenCalledTimes(1);
  });

  it("[V-22c] showWatermark=true のとき drawWatermark が呼ばれ、false のとき呼ばれない", () => {
    compositeFrame(makeContext(), { ...baseInput, showWatermark: true });
    expect(drawWatermark).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    compositeFrame(makeContext(), { ...baseInput, showWatermark: false });
    expect(drawWatermark).not.toHaveBeenCalled();
  });

  it("[V-22b] アクティブなスプリットがある区間のみ drawPassedSplit が呼ばれる (SPLIT_DISPLAY_DURATION_SECONDS窓)", () => {
    const splitTimes: SplitTime[] = [{ distance: 50, time: 25, lapTime: 25, memo: "" }];
    // startSignalTime=5, split.time=25 → 表示区間は elapsed∈[25,25+3)、elapsed=timestamp-startSignalTime
    // timestamp=31 → elapsed=26 (区間内)
    compositeFrame(makeContext(), { ...baseInput, splitTimes, timestamp: 31 });
    expect(drawPassedSplit).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    // timestamp=35 → elapsed=30 (区間外: 25+3=28 を超えている)
    compositeFrame(makeContext(), { ...baseInput, splitTimes, timestamp: 35 });
    expect(drawPassedSplit).not.toHaveBeenCalled();
  });
});
