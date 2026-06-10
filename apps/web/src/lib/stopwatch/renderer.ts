/**
 * Web overlay renderer — a thin Canvas2D adapter over the shared,
 * platform-agnostic `@swimhub-timer/shared` overlay renderer.
 *
 * All layout/draw logic now lives in the shared package so the web preview,
 * web export, and (via the Skia adapter) mobile all draw from one source.
 * This file keeps the original web-facing signatures (which read the canvas
 * size from `ctx.canvas`) so existing callers and tests are unchanged.
 *
 * See `docs/design-skia-unified-renderer.md`.
 */
import type { StopwatchConfig, SplitTime, OverlayContext, Rect } from "@swimhub-timer/shared";
import {
  SUMMARY_DELAY_SECONDS as SHARED_SUMMARY_DELAY_SECONDS,
  drawStopwatch,
  drawPassedSplit,
  drawFinishSummary,
  drawWatermark,
  getStopwatchBounds as sharedGetStopwatchBounds,
  getFinishSummaryBounds as sharedGetFinishSummaryBounds,
} from "@swimhub-timer/shared";

export const SUMMARY_DELAY_SECONDS = SHARED_SUMMARY_DELAY_SECONDS;

/**
 * A real `CanvasRenderingContext2D` structurally implements every primitive in
 * `OverlayContext`; the cast just narrows the wider DOM types (e.g.
 * `fillStyle: string | CanvasGradient | CanvasPattern`) to the subset the
 * shared renderer uses.
 */
function toOverlayContext(ctx: CanvasRenderingContext2D): OverlayContext {
  return ctx as unknown as OverlayContext;
}

function canvasSize(ctx: CanvasRenderingContext2D) {
  return { width: ctx.canvas.width, height: ctx.canvas.height };
}

export function renderStopwatch(
  ctx: CanvasRenderingContext2D,
  config: StopwatchConfig,
  elapsedSeconds: number,
): void {
  drawStopwatch(toOverlayContext(ctx), canvasSize(ctx), config, elapsedSeconds);
}

export function renderSplitDisplay(
  ctx: CanvasRenderingContext2D,
  config: StopwatchConfig,
  elapsedSeconds: number,
  latestSplit: SplitTime,
): void {
  drawPassedSplit(toOverlayContext(ctx), canvasSize(ctx), config, elapsedSeconds, latestSplit);
}

export function getStopwatchBounds(
  ctx: CanvasRenderingContext2D,
  config: StopwatchConfig,
  elapsedSeconds: number,
): Rect {
  return sharedGetStopwatchBounds(toOverlayContext(ctx), canvasSize(ctx), config, elapsedSeconds);
}

export function renderFinishSummary(
  ctx: CanvasRenderingContext2D,
  config: StopwatchConfig,
  splitTimes: SplitTime[],
  finishTime: number,
  raceDistance: number | null,
  contentRect: Rect,
): void {
  drawFinishSummary(toOverlayContext(ctx), config, splitTimes, finishTime, raceDistance, contentRect);
}

export function getFinishSummaryBounds(
  ctx: CanvasRenderingContext2D,
  config: StopwatchConfig,
  splitTimes: SplitTime[],
  finishTime: number,
  raceDistance: number | null,
  contentRect: Rect,
): Rect {
  return sharedGetFinishSummaryBounds(
    toOverlayContext(ctx),
    config,
    splitTimes,
    finishTime,
    raceDistance,
    contentRect,
  );
}

// --- Watermark (web keeps its own lazy-loaded HTMLImageElement) ---------------

let _watermarkIcon: HTMLImageElement | null = null;
let _iconLoadStarted = false;

function getWatermarkIcon(): HTMLImageElement | null {
  if (!_iconLoadStarted) {
    _iconLoadStarted = true;
    const img = new Image();
    img.onload = () => {
      _watermarkIcon = img;
    };
    img.src = "/apple-touch-icon.png";
  }
  return _watermarkIcon;
}

export function renderWatermark(ctx: CanvasRenderingContext2D): void {
  drawWatermark(toOverlayContext(ctx), canvasSize(ctx), getWatermarkIcon());
}
