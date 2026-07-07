/**
 * WebCodecs export frame compositor — draws the decoded source frame plus the
 * stopwatch/split/summary/watermark overlays onto an `OffscreenCanvas`, using the
 * exact same `@swimhub-timer/shared` overlay-renderer draw functions as the live
 * preview (`useCanvasCompositor.ts`). This is what eliminates the historical
 * preview/export mismatch: both paths now render from one body of layout/draw code.
 *
 * `OffscreenCanvasRenderingContext2D` structurally satisfies `OverlayContext` the same
 * way `CanvasRenderingContext2D` does in `lib/stopwatch/renderer.ts` — the cast below is
 * the same "near-zero-cost adapter" pattern used there.
 */
import type { OverlayContext } from "@swimhub-timer/shared";
import {
  SUMMARY_DELAY_SECONDS,
  SPLIT_DISPLAY_DURATION_SECONDS,
  drawStopwatch,
  drawPassedSplit,
  drawFinishSummary,
  drawWatermark,
} from "@swimhub-timer/shared";
import type { FrameCompositorContext, FrameCompositorInput } from "./webcodecs-types";

function toOverlayContext(ctx: OffscreenCanvasRenderingContext2D): OverlayContext {
  return ctx as unknown as OverlayContext;
}

const MICROSECONDS_PER_SECOND = 1_000_000;

/**
 * Converts a frame index + constant frame rate into a WebCodecs-style microsecond
 * timestamp (`frameIndex / fps`, independently computed per call — never an accumulated
 * running total, so rounding error can't drift over a long export; this matters for
 * NTSC rates like 29.97fps where `1/fps` isn't exactly representable).
 *
 * NOTE: the real export loop in `webcodecs-export-pipeline.ts` does NOT use this function
 * for its main per-frame timing — it uses the source video's own decoded presentation
 * timestamps from mediabunny's `CanvasSink`, which are authoritative (including for
 * variable-frame-rate footage, where `frameIndex / fps` would be wrong). This function is
 * kept as a pure, independently-testable utility for diagnostics (see the PoC page) and
 * any future code path that needs to derive a timestamp from a frame index + frame rate.
 */
export function frameTimestampMicros(frameIndex: number, fps: number): number {
  if (!Number.isFinite(frameIndex) || frameIndex < 0 || !Number.isFinite(fps) || fps <= 0) {
    return 0;
  }
  return Math.round((frameIndex / fps) * MICROSECONDS_PER_SECOND);
}

/**
 * The timestamp (in microseconds, WebCodecs' native unit) at which the finish-summary
 * overlay should start appearing: `startSignalTime + finishTime + SUMMARY_DELAY_SECONDS`,
 * converted to microseconds. Reuses the shared `SUMMARY_DELAY_SECONDS` constant (imported,
 * never hardcoded as `2`) so this engine and the ffmpeg engine's `summaryEnableT`
 * (`export-pipeline.ts`) can never drift apart if that constant changes.
 */
export function summaryOverlayStartMicros(startSignalTime: number, finishTime: number): number {
  return Math.round((startSignalTime + finishTime + SUMMARY_DELAY_SECONDS) * MICROSECONDS_PER_SECOND);
}

/** Creates the reusable compositing canvas. One instance is reused for every frame of an
 *  export: each frame is drawn, then immediately captured by `CanvasSource.add()` before
 *  the next frame overwrites it (see `webcodecs-export-pipeline.ts`). */
export function createFrameCompositorContext(width: number, height: number): FrameCompositorContext {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to acquire an OffscreenCanvas 2D context.");
  }
  return { canvas, ctx, width, height };
}

/**
 * Composites one output frame in place, mirroring `useCanvasCompositor`'s per-frame
 * logic exactly (elapsed-time clamping, delayed summary reveal, active split badge
 * window, optional watermark) but driven by the decoded frame's presentation timestamp
 * instead of `<video>.currentTime`.
 */
export function compositeFrame(context: FrameCompositorContext, input: FrameCompositorInput): void {
  const { ctx, width, height } = context;
  const overlayCtx = toOverlayContext(ctx);
  const size = { width, height };

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(input.sourceFrame, 0, 0, width, height);

  const rawElapsed = Math.max(0, input.timestamp - input.startSignalTime);
  let elapsed = rawElapsed;
  if (input.isFinished && input.finishTime !== null && elapsed > input.finishTime) {
    elapsed = input.finishTime;
  }

  // Show the summary SUMMARY_DELAY_SECONDS after the finish (the timer stays frozen at
  // finishTime during the gap) — matches the preview and the ffmpeg engine's `summaryEnableT`.
  const timestampMicros = Math.round(input.timestamp * MICROSECONDS_PER_SECOND);
  const summaryVisible =
    input.isFinished &&
    input.finishTime !== null &&
    timestampMicros >= summaryOverlayStartMicros(input.startSignalTime, input.finishTime);

  if (summaryVisible && input.finishTime !== null) {
    const contentRect = { x: 0, y: 0, width, height };
    drawFinishSummary(
      overlayCtx,
      input.stopwatchConfig,
      input.splitTimes,
      input.finishTime,
      input.raceDistance,
      contentRect,
    );
  } else {
    drawStopwatch(overlayCtx, size, input.stopwatchConfig, elapsed);

    if (input.splitTimes.length > 0) {
      let activeSplit = null;
      for (let i = input.splitTimes.length - 1; i >= 0; i--) {
        const split = input.splitTimes[i];
        if (elapsed >= split.time && elapsed < split.time + SPLIT_DISPLAY_DURATION_SECONDS) {
          activeSplit = split;
          break;
        }
      }
      if (activeSplit) {
        drawPassedSplit(overlayCtx, size, input.stopwatchConfig, elapsed, activeSplit);
      }
    }
  }

  if (input.showWatermark) {
    drawWatermark(overlayCtx, size, input.watermarkIcon);
  }
}
