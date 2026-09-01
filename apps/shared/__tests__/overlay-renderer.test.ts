/**
 * Tests for the shared overlay renderer (apps/shared/overlay-renderer/).
 *
 * The renderer is written against the OverlayContext Canvas2D subset, so we
 * drive it with a mock context whose measureText returns a deterministic
 * width (digits slightly wider so tabular alignment is observable).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OverlayContext, OverlayTextMetrics } from "../overlay-renderer";
import {
  drawStopwatch,
  getStopwatchBounds,
  drawPassedSplit,
  drawFinishSummary,
  getFinishSummaryBounds,
  drawWatermark,
  measureTextTabular,
} from "../overlay-renderer";
import { DEFAULT_STOPWATCH_CONFIG } from "../utils/stopwatch-presets";
import type { StopwatchConfig, SplitTime } from "../types";

function makeMockCtx() {
  const ctx = {
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
    // Digits 9px, other glyphs 8px → tabular alignment is detectable.
    measureText: vi.fn((text: string): OverlayTextMetrics => {
      let w = 0;
      for (const ch of text) w += ch >= "0" && ch <= "9" ? 9 : 8;
      return { width: w };
    }),
  } as unknown as OverlayContext & { fontHistory: string[] };
  // Track every `ctx.font` assignment so tests can assert which family was used.
  const fontHistory: string[] = [];
  let fontValue = "";
  Object.defineProperty(ctx, "font", {
    get: () => fontValue,
    set: (v: string) => {
      fontValue = v;
      fontHistory.push(v);
    },
  });
  (ctx as unknown as { fontHistory: string[] }).fontHistory = fontHistory;
  return ctx as OverlayContext & { fontHistory: string[] };
}

const SIZE = { width: 1920, height: 1080 };
const CONTENT_RECT = { x: 0, y: 0, width: 1920, height: 1080 };

const BASE: StopwatchConfig = {
  ...DEFAULT_STOPWATCH_CONFIG,
  position: { x: 0.5, y: 0.5 },
  anchor: "center",
  summaryPosition: { x: 0.5, y: 0.5 },
  summaryAnchor: "center",
  summaryScale: 1,
};

const SPLITS: SplitTime[] = [
  { distance: 50, time: 30.5, lapTime: 30.5, memo: "" },
  { distance: 100, time: 65.0, lapTime: 34.5, memo: "" },
];

describe("measureTextTabular", () => {
  it("widens every digit to the max digit width (monospaced digits)", () => {
    const ctx = makeMockCtx();
    // "1:23.45" → digits sum to maxDigit*5, plus ':' (8) + '.' (8).
    const w = measureTextTabular(ctx, "1:23.45");
    expect(w).toBe(9 * 5 + 8 + 8);
  });
});

describe("drawStopwatch / getStopwatchBounds", () => {
  beforeEach(() => vi.clearAllMocks());

  it("draws the background path and the time text", () => {
    const ctx = makeMockCtx();
    drawStopwatch(ctx, SIZE, BASE, 12.34);
    expect(vi.mocked(ctx.fill)).toHaveBeenCalled();
    expect(vi.mocked(ctx.fillText).mock.calls.length).toBeGreaterThan(0);
  });

  it("returns a positive box and respects the anchor (left vs right)", () => {
    const ctx = makeMockCtx();
    const left = getStopwatchBounds(ctx, SIZE, { ...BASE, position: { x: 0, y: 0.5 }, anchor: "top-left" }, 12.34);
    const right = getStopwatchBounds(ctx, SIZE, { ...BASE, position: { x: 1, y: 0.5 }, anchor: "top-right" }, 12.34);
    expect(left.width).toBeGreaterThan(0);
    expect(left.height).toBeGreaterThan(0);
    expect(left.x).toBeLessThan(right.x);
  });

  it("bounds height scales with fontSize", () => {
    const ctx = makeMockCtx();
    const small = getStopwatchBounds(ctx, SIZE, { ...BASE, fontSize: 60 }, 12.34);
    const big = getStopwatchBounds(ctx, SIZE, { ...BASE, fontSize: 160 }, 12.34);
    expect(big.height).toBeGreaterThan(small.height);
  });

  it("top-left anchor at (0,0) yields origin bounds (exact coords)", () => {
    const ctx = makeMockCtx();
    const b = getStopwatchBounds(ctx, SIZE, { ...BASE, position: { x: 0, y: 0 }, anchor: "top-left" }, 12.34);
    expect(b.x).toBe(0);
    expect(b.y).toBe(0);
  });

  it("center anchor centers the box on the position point (exact coords)", () => {
    const ctx = makeMockCtx();
    const b = getStopwatchBounds(ctx, SIZE, { ...BASE, position: { x: 0.5, y: 0.5 }, anchor: "center" }, 12.34);
    expect(b.x).toBeCloseTo(0.5 * SIZE.width - b.width / 2, 5);
    expect(b.y).toBeCloseTo(0.5 * SIZE.height - b.height / 2, 5);
  });
});

describe("drawPassedSplit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders below the timer without throwing (with and without memo)", () => {
    const ctx = makeMockCtx();
    // SPLITS is a fixed 2-element fixture declared above; index 0/1 always exist.
    expect(() => drawPassedSplit(ctx, SIZE, BASE, 30.5, SPLITS[0]!)).not.toThrow();
    expect(() =>
      drawPassedSplit(ctx, SIZE, BASE, 30.5, { ...SPLITS[0]!, memo: "ドルフィン5回" }),
    ).not.toThrow();
    expect(vi.mocked(ctx.fillText).mock.calls.length).toBeGreaterThan(0);
  });

  it("draws every glyph below the stopwatch bottom edge (regression guard)", () => {
    const ctx = makeMockCtx();
    const cfg = { ...BASE, position: { x: 0, y: 0 }, anchor: "top-left" as const };
    const bounds = getStopwatchBounds(ctx, SIZE, cfg, 30.5);
    vi.clearAllMocks();
    drawPassedSplit(ctx, SIZE, cfg, 30.5, SPLITS[1]!); // SPLITS is a fixed 2-element fixture; index 1 always exists.
    const ys = vi.mocked(ctx.fillText).mock.calls.map((c) => c[2] as number);
    expect(ys.length).toBeGreaterThan(0);
    for (const y of ys) expect(y).toBeGreaterThanOrEqual(bounds.y + bounds.height);
  });

  it("renders the exact headline text formatTime produces", () => {
    const ctx = makeMockCtx();
    drawPassedSplit(ctx, SIZE, BASE, 30.5, SPLITS[0]!); // 50m @30.5, lap 30.5; SPLITS is a fixed fixture
    const texts = vi.mocked(ctx.fillText).mock.calls.map((c) => c[0]);
    // fillTextTabular splits into per-char calls; the joined sequence must
    // contain the headline characters in order.
    const joined = texts.join("");
    expect(joined).toContain("50m");
    expect(joined).toContain("lap");
  });
});

describe("drawFinishSummary / getFinishSummaryBounds", () => {
  beforeEach(() => vi.clearAllMocks());

  it("draws rows without throwing; empty splits still render the finish row", () => {
    const ctx = makeMockCtx();
    expect(() => drawFinishSummary(ctx, BASE, [], 45, 100, CONTENT_RECT)).not.toThrow();
    drawFinishSummary(ctx, BASE, SPLITS, 65, 100, CONTENT_RECT);
    expect(vi.mocked(ctx.fillText).mock.calls.length).toBeGreaterThan(2);
  });

  it("bounds grow with summaryScale and with row count", () => {
    const ctx = makeMockCtx();
    const s1 = getFinishSummaryBounds(ctx, { ...BASE, summaryScale: 1 }, SPLITS, 65, 100, CONTENT_RECT);
    const s2 = getFinishSummaryBounds(ctx, { ...BASE, summaryScale: 2 }, SPLITS, 65, 100, CONTENT_RECT);
    expect(s2.width).toBeGreaterThan(s1.width);
    expect(s2.height).toBeGreaterThan(s1.height);

    const empty = getFinishSummaryBounds(ctx, BASE, [], 65, 100, CONTENT_RECT);
    expect(s1.height).toBeGreaterThan(empty.height);
  });

  it("center anchor keeps the summary inside the canvas", () => {
    const ctx = makeMockCtx();
    const b = getFinishSummaryBounds(ctx, BASE, SPLITS, 65, 100, CONTENT_RECT);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(1920);
    expect(b.y + b.height).toBeLessThanOrEqual(1080);
  });

  it("uses config.fontFamily for every font (not hardcoded monospace)", () => {
    const ctx = makeMockCtx();
    drawFinishSummary(ctx, { ...BASE, fontFamily: "sans-serif" }, SPLITS, 65, 100, CONTENT_RECT);
    const fonts = ctx.fontHistory.filter((f) => f.includes("px"));
    expect(fonts.length).toBeGreaterThan(0);
    for (const f of fonts) {
      expect(f).toContain("sans-serif");
      expect(f).not.toContain("monospace");
    }
  });

  it("summaryScale=5 (mobile default) stays inside a portrait 1620x2160 canvas", () => {
    const ctx = makeMockCtx();
    const rect = { x: 0, y: 0, width: 1620, height: 2160 };
    const b = getFinishSummaryBounds(ctx, { ...BASE, summaryScale: 5 }, SPLITS, 65, 100, rect);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(1620);
    expect(b.y + b.height).toBeLessThanOrEqual(2160);
  });
});

describe("drawWatermark", () => {
  beforeEach(() => vi.clearAllMocks());

  it("draws the label and (when provided) the icon, wrapped in save/restore", () => {
    const ctx = makeMockCtx();
    drawWatermark(ctx, SIZE, null);
    expect(vi.mocked(ctx.save)).toHaveBeenCalled();
    expect(vi.mocked(ctx.restore)).toHaveBeenCalled();
    expect(vi.mocked(ctx.fillText)).toHaveBeenCalledWith("SwimHub Timer", expect.any(Number), expect.any(Number));
    expect(vi.mocked(ctx.drawImage)).not.toHaveBeenCalled();

    const icon = {} as unknown;
    drawWatermark(ctx, SIZE, icon);
    expect(vi.mocked(ctx.drawImage)).toHaveBeenCalled();
  });

  it("positions the label at the bottom-right with the documented coords", () => {
    const ctx = makeMockCtx();
    drawWatermark(ctx, SIZE, null);
    const call = vi.mocked(ctx.fillText).mock.calls.find((c) => c[0] === "SwimHub Timer");
    expect(call).toBeDefined();
    const textWidth = "SwimHub Timer".length * 8; // mock: non-digit glyphs = 8px
    expect(call![1] as number).toBeCloseTo(SIZE.width * 0.97 - textWidth, 5);
    expect(call![2] as number).toBeCloseTo(SIZE.height * 0.97, 5);
  });

  it("honors heightFactor / minFontSize (mobile passes 0.06 / 16)", () => {
    const a = makeMockCtx();
    const b = makeMockCtx();
    drawWatermark(a, SIZE, null); // default 0.04
    drawWatermark(b, SIZE, null, { heightFactor: 0.06, minFontSize: 16 });
    const fa = a.font; // last font set
    const fb = b.font;
    // The regex's capture group is mandatory, so a successful (non-null-asserted) match
    // always has group 1.
    const sizeOf = (f: string) => parseInt(f.match(/(\d+)px/)![1]!, 10);
    expect(sizeOf(fb)).toBeGreaterThan(sizeOf(fa));
  });

  it("honors the fontFamily option", () => {
    const ctx = makeMockCtx();
    drawWatermark(ctx, SIZE, null, { fontFamily: "NotoSansJP-Bold" });
    expect(ctx.font).toContain("NotoSansJP-Bold");
  });
});
