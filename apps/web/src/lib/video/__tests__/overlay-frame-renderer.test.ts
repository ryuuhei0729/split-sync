/**
 * Sprint Contract テスト — Phase B 実装済み (QA)
 * 対象: apps/web/src/lib/video/overlay-frame-renderer.ts
 *   createOverlayFrameCompositorContext / compositeOverlayFrame
 *
 * ffmpeg フォールバック書き出しの overlay (透過PNG連番) 描画エントリポイント。
 * `webcodecs-frame-compositor.ts` の `compositeFrame` と同じ分岐仕様
 * (elapsed クランプ・サマリー表示判定・アクティブスプリット判定) を独立に再実装した
 * ものなので、`webcodecs-frame-compositor.test.ts` と対になる形で同じ仕様を検証する
 * (実際に両者が一致するかどうかは export-engines-parity.test.ts の担当)。
 *
 * 検証対象の Sprint Contract 項目:
 *   V-02: elapsed (経過秒) の計算 — 焼き込まれる時刻文字列そのものは共有 drawStopwatch
 *         (→ formatTime) が担当するため、ここでは compositeOverlayFrame が
 *         drawStopwatch に「正しい elapsed 秒数」を渡すことを検証する
 *         (elapsed の計算を誤れば formatTime が正しくても表示は壊れる)
 *   V-03/V-04: stopwatchConfig (fontFamily/borderRadius/backgroundColor/textColor 含む)
 *         が変換されずそのまま drawStopwatch に渡る (旧 rgbaToFFmpegColor 等の
 *         変換を経由しない)
 *   V-06: スプリットバッジの区間判定 (elapsed>=split.time && elapsed<split.time+
 *         SPLIT_DISPLAY_DURATION_SECONDS) と memo の受け渡し
 *   V-07: showWatermark の ON/OFF が drawWatermark 呼び出しに反映される
 *   V-08: サマリー表示区間 (timestamp >= summaryOverlayStartMicros) ではタイマー/
 *         スプリットの描画を止める (透かしのみ継続) — フィニッシュサマリー画像自体は
 *         ffmpeg 側の単一PNG合成が担当するため、ここでは「動的要素の描画を止めること」
 *         のみを検証する
 *
 * トートロジー回避: drawStopwatch/drawPassedSplit/drawWatermark 自体は
 * apps/shared/__tests__/overlay-renderer.test.ts が formatTime/calculatePosition の
 * 入出力を検証済みなので、ここでは重複させず「compositeOverlayFrame がどんな
 * elapsed/config/split で shared 関数を呼ぶか」という分岐ロジックのみを見る。
 * elapsed の期待値は実装のコピーではなく、仕様 (rawElapsed=timestamp-startSignalTime,
 * isFinished時はfinishTimeでクランプ) から独立に計算する。
 *
 * 型注記: 各テストは compositeOverlayFrame を呼んだ直後に drawStopwatch/drawPassedSplit
 * の呼び出し引数を読むので `.mock.calls[0]!` を使う。呼ばれていなければ直後の `[N]`
 * アクセスがそのままランタイムエラーになり、テストは検出できる。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@swimhub-timer/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@swimhub-timer/shared")>();
  return {
    ...actual,
    drawStopwatch: vi.fn(),
    drawPassedSplit: vi.fn(),
    drawWatermark: vi.fn(),
  };
});

import { drawStopwatch, drawPassedSplit, drawWatermark, DEFAULT_STOPWATCH_CONFIG } from "@swimhub-timer/shared";
import type { SplitTime } from "@swimhub-timer/shared";
import { compositeOverlayFrame } from "../overlay-frame-renderer";
import type { OverlayFrameCompositorContext, OverlayFrameInput } from "../overlay-frame-renderer";

function makeContext(): OverlayFrameCompositorContext {
  const ctx = {
    clearRect: vi.fn(),
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
    drawImage: vi.fn(),
    fillStyle: "",
    globalAlpha: 1,
    textBaseline: "top" as const,
    font: "",
    measureText: vi.fn(() => ({ width: 10 })),
  };
  return {
    ctx: ctx as unknown as OffscreenCanvasRenderingContext2D,
    canvas: {} as OffscreenCanvas,
    width: 1920,
    height: 1080,
  };
}

const baseInput: OverlayFrameInput = {
  timestamp: 0,
  startSignalTime: 5,
  stopwatchConfig: DEFAULT_STOPWATCH_CONFIG,
  splitTimes: [],
  isFinished: false,
  finishTime: null,
  showWatermark: false,
  watermarkIcon: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("compositeOverlayFrame — elapsed の計算 (V-02)", () => {
  it("[V-02] timestamp=5.32, startSignalTime=5 → elapsed=0.32 (rawElapsed=timestamp-startSignalTime) で drawStopwatch を呼ぶ", () => {
    compositeOverlayFrame(makeContext(), { ...baseInput, timestamp: 5.32 });
    expect(drawStopwatch).toHaveBeenCalledTimes(1);
    const elapsedArg = vi.mocked(drawStopwatch).mock.calls[0]![3];
    expect(elapsedArg).toBeCloseTo(0.32, 10);
  });

  it("[V-02] timestamp < startSignalTime (スタート前) では elapsed が 0 にクランプされ、例外を投げない", () => {
    expect(() => compositeOverlayFrame(makeContext(), { ...baseInput, timestamp: 2 })).not.toThrow();
    const elapsedArg = vi.mocked(drawStopwatch).mock.calls[0]![3];
    expect(elapsedArg).toBe(0);
  });

  it("[V-02] isFinished=true かつ elapsed > finishTime のとき、elapsed が finishTime にクランプされる (フィニッシュ後の凍結)", () => {
    // startSignalTime=5, finishTime=45 → rawElapsed=timestamp-5。timestamp=51 → rawElapsed=46>45 → 45にクランプ。
    // (summary 表示開始は startSignalTime+finishTime+SUMMARY_DELAY_SECONDS=52 なので、
    //  それより前の timestamp=51 を選び、サマリー抑制 (V-08) と混同しないようにする)
    compositeOverlayFrame(makeContext(), { ...baseInput, isFinished: true, finishTime: 45, timestamp: 51 });
    const elapsedArg = vi.mocked(drawStopwatch).mock.calls[0]![3];
    expect(elapsedArg).toBe(45);
  });

  it("[V-02] isFinished=true でも elapsed <= finishTime のときはクランプされない (実測値のまま)", () => {
    compositeOverlayFrame(makeContext(), { ...baseInput, isFinished: true, finishTime: 45, timestamp: 30 });
    const elapsedArg = vi.mocked(drawStopwatch).mock.calls[0]![3];
    expect(elapsedArg).toBeCloseTo(25, 10);
  });
});

describe("compositeOverlayFrame — config のそのままの受け渡し (V-03/V-04)", () => {
  it("[V-03][V-04] stopwatchConfig が変換されず (参照/内容とも) そのまま drawStopwatch に渡る", () => {
    const config = {
      ...DEFAULT_STOPWATCH_CONFIG,
      fontFamily: "sans-serif" as const,
      borderRadius: 8,
      backgroundColor: "rgba(0,50,120,0.85)",
      textColor: "#FFFFFF",
    };
    compositeOverlayFrame(makeContext(), { ...baseInput, stopwatchConfig: config });
    expect(drawStopwatch).toHaveBeenCalledWith(expect.anything(), expect.anything(), config, expect.any(Number));
  });
});

describe("compositeOverlayFrame — スプリットバッジの区間判定 (V-06)", () => {
  const split: SplitTime = { distance: 50, time: 25, lapTime: 25, memo: "" };

  it("[V-06] elapsed が [split.time, split.time+SPLIT_DISPLAY_DURATION_SECONDS) の区間内なら drawPassedSplit が呼ばれる", () => {
    // startSignalTime=5, split.time=25 → 区間は elapsed∈[25,28)。timestamp=31 → elapsed=26 (区間内)
    compositeOverlayFrame(makeContext(), { ...baseInput, splitTimes: [split], timestamp: 31 });
    expect(drawPassedSplit).toHaveBeenCalledTimes(1);
  });

  it("[V-06] 区間の直前 (elapsed=24.999) では drawPassedSplit が呼ばれない", () => {
    compositeOverlayFrame(makeContext(), { ...baseInput, splitTimes: [split], timestamp: 29.999 });
    expect(drawPassedSplit).not.toHaveBeenCalled();
  });

  it("[V-06] 区間の直後 (elapsed=28、境界は排他的<) では drawPassedSplit が呼ばれない", () => {
    compositeOverlayFrame(makeContext(), { ...baseInput, splitTimes: [split], timestamp: 33 });
    expect(drawPassedSplit).not.toHaveBeenCalled();
  });

  it("[V-06] memo 付きスプリットの memo がそのまま drawPassedSplit の引数に渡る", () => {
    const splitWithMemo: SplitTime = { ...split, memo: "ドルフィン5回" };
    compositeOverlayFrame(makeContext(), { ...baseInput, splitTimes: [splitWithMemo], timestamp: 31 });
    const passed = vi.mocked(drawPassedSplit).mock.calls[0]![4] as SplitTime;
    expect(passed.memo).toBe("ドルフィン5回");
  });

  it("[V-06] splitTimes=[] では drawPassedSplit が一度も呼ばれない", () => {
    compositeOverlayFrame(makeContext(), { ...baseInput, splitTimes: [], timestamp: 31 });
    expect(drawPassedSplit).not.toHaveBeenCalled();
  });

  it("[V-06] 複数スプリットのうち直近の該当区間のものだけが描画される (末尾から探索)", () => {
    const splits: SplitTime[] = [
      { distance: 50, time: 25, lapTime: 25, memo: "first" },
      { distance: 100, time: 26, lapTime: 1, memo: "second" },
    ];
    // startSignalTime=5, timestamp=31 → elapsed=26 → 両方の区間 [25,28)/[26,29) に該当するが
    // 末尾 (直近) の "second" が優先される。
    compositeOverlayFrame(makeContext(), { ...baseInput, splitTimes: splits, timestamp: 31 });
    expect(drawPassedSplit).toHaveBeenCalledTimes(1);
    const passed = vi.mocked(drawPassedSplit).mock.calls[0]![4] as SplitTime;
    expect(passed.memo).toBe("second");
  });
});

describe("compositeOverlayFrame — ウォーターマーク (V-07)", () => {
  it("[V-07] showWatermark=true のとき drawWatermark が呼ばれる", () => {
    compositeOverlayFrame(makeContext(), { ...baseInput, showWatermark: true });
    expect(drawWatermark).toHaveBeenCalledTimes(1);
  });

  it("[V-07] showWatermark=false のとき drawWatermark が呼ばれない", () => {
    compositeOverlayFrame(makeContext(), { ...baseInput, showWatermark: false });
    expect(drawWatermark).not.toHaveBeenCalled();
  });

  it("[V-07] watermarkIcon がそのまま drawWatermark に渡る", () => {
    const icon = { fakeIcon: true } as unknown as OverlayFrameInput["watermarkIcon"];
    compositeOverlayFrame(makeContext(), { ...baseInput, showWatermark: true, watermarkIcon: icon });
    expect(drawWatermark).toHaveBeenCalledWith(expect.anything(), expect.anything(), icon);
  });
});

describe("compositeOverlayFrame — サマリー区間はタイマー/スプリットの描画を止める (V-08)", () => {
  it("[V-08] summaryOverlayStartMicros 到達後 (startSignalTime=5,finishTime=45→閾値52秒) はdrawStopwatch/drawPassedSplitを呼ばない", () => {
    const split: SplitTime = { distance: 50, time: 25, lapTime: 25, memo: "" };
    compositeOverlayFrame(makeContext(), {
      ...baseInput,
      isFinished: true,
      finishTime: 45,
      splitTimes: [split],
      timestamp: 52,
    });
    expect(drawStopwatch).not.toHaveBeenCalled();
    expect(drawPassedSplit).not.toHaveBeenCalled();
  });

  it("[V-08] サマリー区間でも showWatermark=true なら drawWatermark は継続して呼ばれる", () => {
    compositeOverlayFrame(makeContext(), {
      ...baseInput,
      isFinished: true,
      finishTime: 45,
      timestamp: 52,
      showWatermark: true,
    });
    expect(drawWatermark).toHaveBeenCalledTimes(1);
  });

  it("[V-08] サマリー閾値の直前 (timestamp=51.999999) ではまだ drawStopwatch が呼ばれる", () => {
    compositeOverlayFrame(makeContext(), {
      ...baseInput,
      isFinished: true,
      finishTime: 45,
      timestamp: 51.999999,
    });
    expect(drawStopwatch).toHaveBeenCalledTimes(1);
  });
});

describe("compositeOverlayFrame — 透過クリア", () => {
  it("[V-10前提] 描画前に clearRect(0,0,width,height) で全面クリアする (透過背景の確保)", () => {
    const context = makeContext();
    compositeOverlayFrame(context, baseInput);
    expect(vi.mocked(context.ctx.clearRect)).toHaveBeenCalledWith(0, 0, 1920, 1080);
  });
});
