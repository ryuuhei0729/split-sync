/**
 * Sprint Contract テスト — Phase B 実装済み
 * 対象: apps/web/src/lib/stopwatch/renderer.ts
 *   追加関数: renderFinishSummary, getFinishSummaryBounds
 *
 * 検証対象の Sprint Contract 項目:
 *   V-14: renderFinishSummary が finishTime 行を描画する
 *   V-15: renderFinishSummary — splitTimes 空のときは finishTime 行のみ描画
 *   V-16: getFinishSummaryBounds が描画領域と整合するバウンズを返す
 *   V-17: summaryScale クランプ (0.4–3.0) が bounds に反映される
 *   V-18: summaryPosition / summaryAnchor に基づいて描画位置が変わる
 *
 * jsdom では HTMLCanvasElement.getContext("2d") が null を返すため、
 * CanvasRenderingContext2D を手動モックオブジェクトとして構築する。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderFinishSummary, getFinishSummaryBounds } from "../renderer";
import type { StopwatchConfig, SplitTime } from "@swimhub-timer/shared";
import { DEFAULT_STOPWATCH_CONFIG } from "@swimhub-timer/shared";

/**
 * jsdom の getContext("2d") が null を返すため、
 * CanvasRenderingContext2D のメソッドを vi.fn() で全てモックした偽 ctx を返す。
 * measureText は文字数比例の幅を返すように実装する (0 だとレイアウト計算が崩れる)。
 */
function makeMockCtx(width = 1920, height = 1080): CanvasRenderingContext2D {
  const canvas = { width, height } as HTMLCanvasElement;

  const ctx = {
    canvas,
    // 描画系メソッド (呼び出し検証のため vi.fn())
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
    // プロパティ (setter で記録するだけ)
    fillStyle: "",
    globalAlpha: 1,
    textBaseline: "top" as CanvasTextBaseline,
    font: "",
    // measureText: 文字数 × 8px の近似値を返す (0 だとレイアウト計算が全て 0 になる)
    measureText: vi.fn((text: string): TextMetrics => {
      const width = text.length * 8;
      return {
        width,
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: width,
        actualBoundingBoxAscent: 8,
        actualBoundingBoxDescent: 2,
        fontBoundingBoxAscent: 8,
        fontBoundingBoxDescent: 2,
        emHeightAscent: 8,
        emHeightDescent: 2,
        hangingBaseline: 8,
        alphabeticBaseline: 0,
        ideographicBaseline: 0,
      };
    }),
  } as unknown as CanvasRenderingContext2D;

  return ctx;
}

const BASE_CONFIG: StopwatchConfig = {
  ...DEFAULT_STOPWATCH_CONFIG,
  summaryPosition: { x: 0.5, y: 0.5 },
  summaryAnchor: "center",
  summaryScale: 1,
};

const CONTENT_RECT = { x: 0, y: 0, width: 1920, height: 1080 };

const SAMPLE_SPLITS: SplitTime[] = [
  { distance: 50, time: 30.5, lapTime: 30.5, memo: "" },
  { distance: 100, time: 65.0, lapTime: 34.5, memo: "" },
];

describe("renderFinishSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("[V-15] splitTimes が空のとき、finishTime の行だけ描画してもエラーにならない", () => {
    const ctx = makeMockCtx();
    expect(() => {
      renderFinishSummary(ctx, BASE_CONFIG, [], 45.0, 100, CONTENT_RECT);
    }).not.toThrow();
  });

  it("[V-14] splitTimes あり — ctx.fillText が複数回呼ばれる (各行の描画を確認)", () => {
    const ctx = makeMockCtx();
    renderFinishSummary(ctx, BASE_CONFIG, SAMPLE_SPLITS, 65.0, 100, CONTENT_RECT);
    // splitTimes=2行 + ヘッダー列 + 各行のセル → fillText が複数回呼ばれているはず
    expect(vi.mocked(ctx.fillText).mock.calls.length).toBeGreaterThan(2);
  });

  it("[V-14] summaryScale=1 のとき描画が実行される (fillText が 1 回以上呼ばれる)", () => {
    const ctx = makeMockCtx();
    const config = { ...BASE_CONFIG, summaryScale: 1 };
    renderFinishSummary(ctx, config, SAMPLE_SPLITS, 65.0, 100, CONTENT_RECT);
    expect(vi.mocked(ctx.fillText).mock.calls.length).toBeGreaterThan(0);
  });

  it("[V-17] summaryScale=0.4 (クランプ下限) のときも描画がクラッシュしない", () => {
    const ctx = makeMockCtx();
    const config = { ...BASE_CONFIG, summaryScale: 0.4 };
    expect(() => {
      renderFinishSummary(ctx, config, SAMPLE_SPLITS, 65.0, 100, CONTENT_RECT);
    }).not.toThrow();
  });

  it("[V-17] summaryScale=3.0 (クランプ上限) のときも描画がクラッシュしない", () => {
    const ctx = makeMockCtx();
    const config = { ...BASE_CONFIG, summaryScale: 3.0 };
    expect(() => {
      renderFinishSummary(ctx, config, SAMPLE_SPLITS, 65.0, 100, CONTENT_RECT);
    }).not.toThrow();
  });

  it("[V-15] splitTimes 空 + finishTime=0 の境界値: 0秒でも描画がクラッシュしない", () => {
    const ctx = makeMockCtx();
    expect(() => {
      renderFinishSummary(ctx, BASE_CONFIG, [], 0, 100, CONTENT_RECT);
    }).not.toThrow();
  });

  it("[V-14] raceDistance=null のときも finishTime 行が描画される (effectiveRace 推定)", () => {
    const ctx = makeMockCtx();
    // raceDistance=null だが splitTimes に距離がある → effectiveRace が推定される
    expect(() => {
      renderFinishSummary(ctx, BASE_CONFIG, SAMPLE_SPLITS, 65.0, null, CONTENT_RECT);
    }).not.toThrow();
    expect(vi.mocked(ctx.fillText).mock.calls.length).toBeGreaterThan(0);
  });
});

describe("getFinishSummaryBounds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("[V-16] 返り値に x, y, width, height プロパティが存在する", () => {
    const ctx = makeMockCtx();
    const bounds = getFinishSummaryBounds(ctx, BASE_CONFIG, [], 45.0, 100, CONTENT_RECT);
    expect(bounds).toHaveProperty("x");
    expect(bounds).toHaveProperty("y");
    expect(bounds).toHaveProperty("width");
    expect(bounds).toHaveProperty("height");
  });

  it("[V-16] width > 0 かつ height > 0 (splitTimes 空でも正の領域を返す)", () => {
    const ctx = makeMockCtx();
    const bounds = getFinishSummaryBounds(ctx, BASE_CONFIG, [], 45.0, 100, CONTENT_RECT);
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
  });

  it("[V-16] splitTimes あり (3行) のとき height が splitTimes 空のときより大きい", () => {
    const ctx1 = makeMockCtx();
    const ctx2 = makeMockCtx();
    const threeSplits: SplitTime[] = [
      { distance: 25, time: 15.0, lapTime: 15.0, memo: "" },
      { distance: 50, time: 30.5, lapTime: 15.5, memo: "" },
      { distance: 100, time: 65.0, lapTime: 34.5, memo: "" },
    ];
    const boundsEmpty = getFinishSummaryBounds(ctx1, BASE_CONFIG, [], 65.0, 100, CONTENT_RECT);
    const boundsWithSplits = getFinishSummaryBounds(ctx2, BASE_CONFIG, threeSplits, 65.0, 100, CONTENT_RECT);
    expect(boundsWithSplits.height).toBeGreaterThan(boundsEmpty.height);
  });

  it("[V-18] summaryPosition.x=0 (左寄せ) のとき、x が summaryPosition.x=1 (右寄せ) より小さい", () => {
    const ctx1 = makeMockCtx();
    const ctx2 = makeMockCtx();
    const leftConfig = { ...BASE_CONFIG, summaryPosition: { x: 0, y: 0.5 }, summaryAnchor: "top-left" as const };
    const rightConfig = { ...BASE_CONFIG, summaryPosition: { x: 1, y: 0.5 }, summaryAnchor: "top-right" as const };
    const boundsLeft = getFinishSummaryBounds(ctx1, leftConfig, [], 45.0, 100, CONTENT_RECT);
    const boundsRight = getFinishSummaryBounds(ctx2, rightConfig, [], 45.0, 100, CONTENT_RECT);
    expect(boundsLeft.x).toBeLessThan(boundsRight.x);
  });

  it("[V-17] summaryScale=2 のとき summaryScale=1 より width/height が大きい", () => {
    const ctx1 = makeMockCtx();
    const ctx2 = makeMockCtx();
    const config1 = { ...BASE_CONFIG, summaryScale: 1 };
    const config2 = { ...BASE_CONFIG, summaryScale: 2 };
    const bounds1 = getFinishSummaryBounds(ctx1, config1, SAMPLE_SPLITS, 65.0, 100, CONTENT_RECT);
    const bounds2 = getFinishSummaryBounds(ctx2, config2, SAMPLE_SPLITS, 65.0, 100, CONTENT_RECT);
    expect(bounds2.width).toBeGreaterThan(bounds1.width);
    expect(bounds2.height).toBeGreaterThan(bounds1.height);
  });

  it("[V-16] getFinishSummaryBounds の返す領域がキャンバス内に収まる (1920x1080 canvas, center anchor)", () => {
    const ctx = makeMockCtx(1920, 1080);
    const bounds = getFinishSummaryBounds(ctx, BASE_CONFIG, SAMPLE_SPLITS, 65.0, 100, CONTENT_RECT);
    // center anchor で summaryPosition={x:0.5,y:0.5} のとき
    // 左端・上端はキャンバス内に収まるはず
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    // 右端・下端もキャンバス内
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(1920);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(1080);
  });
});
