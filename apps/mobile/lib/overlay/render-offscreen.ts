/**
 * Headless Skia rendering for video export.
 *
 * Renders overlay elements to transparent PNGs (or a numbered PNG sequence for
 * the per-frame timer) using `Surface.MakeOffscreen` + the shared `draw*`
 * functions through {@link SkiaOverlayContext}. Because preview and export run
 * the *same* draw code through the *same* rasterizer, the exported pixels match
 * the preview exactly — replacing both the FFmpeg `drawtext` path (timer /
 * split) and the fragile `react-native-view-shot` capture (summary).
 *
 * See `docs/design-skia-unified-renderer.md` §4.2.
 */
import { Skia, type SkImage } from "@shopify/react-native-skia";
import { Directory, File, Paths } from "expo-file-system";
import { Asset } from "expo-asset";
import type { SplitTime, StopwatchConfig, OverlayContext, Size } from "@swimhub-timer/shared";
import {
  drawStopwatch,
  drawPassedSplit,
  drawFinishSummary,
  drawWatermark,
  getStopwatchBounds,
} from "@swimhub-timer/shared";
import { loadOverlayTypefaces, MOBILE_WATERMARK_OPTIONS } from "./fonts";
import { SkiaOverlayContext } from "./skia-context";

/** Draw callback operating on the unified overlay context at a given size. */
type DrawFn = (ctx: OverlayContext, size: Size) => void;

/**
 * Render a single transparent overlay frame and return the encoded PNG bytes.
 * Throws if Skia can't allocate the offscreen surface.
 */
export async function renderOverlayPngBytes(
  width: number,
  height: number,
  draw: DrawFn,
): Promise<Uint8Array> {
  const typefaces = await loadOverlayTypefaces();
  const surface = Skia.Surface.MakeOffscreen(Math.round(width), Math.round(height));
  if (!surface) throw new Error("Skia.Surface.MakeOffscreen returned null");
  try {
    const canvas = surface.getCanvas();
    canvas.clear(Skia.Color("transparent"));
    const ctx = new SkiaOverlayContext(canvas, typefaces);
    draw(ctx, { width, height });
    surface.flush();
    const image = surface.makeImageSnapshot();
    const bytes = image.encodeToBytes(); // PNG, lossless
    // Dispose the SkImage immediately — it holds native/GPU-backed memory the
    // JS GC can't see, so leaving it to GC accumulates until the OS kills us.
    image.dispose?.();
    return bytes;
  } finally {
    surface.dispose?.();
  }
}

async function writePng(bytes: Uint8Array, fileName: string): Promise<string> {
  const file = new File(Paths.cache, fileName);
  if (file.exists) file.delete();
  file.create();
  file.write(bytes);
  return file.uri;
}

/**
 * Render the finish-summary overlay to a full-frame transparent PNG, sized to
 * the native video frame so FFmpeg can `overlay=0:0`. Replaces the view-shot
 * capture in `app/(app)/export.tsx`.
 */
export async function renderFinishSummaryPng(
  config: StopwatchConfig,
  splitTimes: SplitTime[],
  finishTime: number,
  raceDistance: number | null,
  width: number,
  height: number,
): Promise<string> {
  const bytes = await renderOverlayPngBytes(width, height, (ctx, size) => {
    drawFinishSummary(ctx, config, splitTimes, finishTime, raceDistance, {
      x: 0,
      y: 0,
      width: size.width,
      height: size.height,
    });
  });
  return writePng(bytes, `swimhub-summary_${width}x${height}.png`);
}

let cachedIcon: SkImage | null = null;
/** Load (and cache) the watermark icon as an SkImage. */
async function loadWatermarkIcon(): Promise<SkImage | null> {
  if (cachedIcon) return cachedIcon;
  try {
    const asset = Asset.fromModule(require("../../assets/icon.png"));
    await asset.downloadAsync();
    const uri = asset.localUri ?? asset.uri;
    if (!uri) return null;
    const data = await Skia.Data.fromURI(uri);
    cachedIcon = Skia.Image.MakeImageFromEncoded(data);
    return cachedIcon;
  } catch {
    return null;
  }
}

/**
 * Render the watermark (icon + "SwimHub Timer") to a full-frame transparent PNG
 * with the SAME shared renderer as the preview, so the exported watermark is
 * pixel-identical (replaces the FFmpeg drawtext + icon-overlay watermark, whose
 * icon position relied on a fontSize×5.8 text-width estimate that didn't match).
 * The PNG already bakes in the 0.30 alpha, so FFmpeg overlays it at 0:0 as-is.
 */
export async function renderWatermarkPng(width: number, height: number): Promise<string> {
  const icon = await loadWatermarkIcon();
  const bytes = await renderOverlayPngBytes(width, height, (ctx, size) => {
    drawWatermark(ctx, size, icon, MOBILE_WATERMARK_OPTIONS);
  });
  return writePng(bytes, `swimhub-watermark_${width}x${height}.png`);
}

/**
 * Render one timer frame (stopwatch + optional active split + optional
 * watermark) — used to build the per-frame PNG sequence that retires FFmpeg
 * `drawtext` so the timer box height matches the preview exactly (Phase 4).
 */
export async function renderTimerFramePng(opts: {
  config: StopwatchConfig;
  elapsedSeconds: number;
  activeSplit: SplitTime | null;
  watermarkIcon: unknown | null;
  width: number;
  height: number;
  fileName: string;
}): Promise<string> {
  const { config, elapsedSeconds, activeSplit, watermarkIcon, width, height, fileName } = opts;
  const bytes = await renderOverlayPngBytes(width, height, (ctx, size) => {
    drawStopwatch(ctx, size, config, elapsedSeconds);
    if (activeSplit) drawPassedSplit(ctx, size, config, elapsedSeconds, activeSplit);
    if (watermarkIcon) {
      drawWatermark(ctx, size, watermarkIcon, MOBILE_WATERMARK_OPTIONS);
    }
  });
  return writePng(bytes, fileName);
}

export interface TimerSequence {
  /** Directory containing the numbered frames. */
  dir: string;
  /** FFmpeg `-i` pattern, e.g. `<dir>/ol_%05d.png`. */
  pattern: string;
  frameCount: number;
  fps: number;
  /**
   * Native-resolution sub-rectangle the frames cover (timer + split band).
   * Frames are only this region (not the full frame) to slash PNG-encode cost;
   * the FFmpeg overlay must be placed at this offset (scaled to output res).
   */
  region: { x: number; y: number; width: number; height: number };
}

/**
 * Render a numbered PNG sequence for the live timer over [startSec, endSec).
 * Returns the directory + FFmpeg input pattern. Heavy (fps × duration frames):
 * the caller should measure and, per the design doc, consider rendering only
 * changed frames or a raw pipe if I/O dominates.
 *
 * `activeSplitAt(elapsed)` lets the caller mirror the preview's split-visibility
 * window per frame.
 */
export async function renderTimerSequence(opts: {
  config: StopwatchConfig;
  /** VIDEO-time range [startSec, endSec) the frames cover (frame i → startSec + i/fps). */
  startSec: number;
  endSec: number;
  fps: number;
  width: number;
  height: number;
  /** Map a video time (s) to the elapsed value to display — lets the caller
   *  show 0:00 before the start signal, count during the race, and freeze at
   *  the finish time, exactly like the preview. */
  elapsedFor: (videoSeconds: number) => number;
  activeSplitAt: (elapsedSeconds: number) => SplitTime | null;
  watermarkIcon: unknown | null;
  onProgress?: (done: number, total: number) => void;
}): Promise<TimerSequence> {
  const {
    config,
    startSec,
    endSec,
    fps,
    width,
    height,
    elapsedFor,
    activeSplitAt,
    watermarkIcon,
    onProgress,
  } = opts;
  const typefaces = await loadOverlayTypefaces();

  // Compute the sub-rectangle the timer + split occupy (full frame WIDTH for
  // safety — the split centers below the timer and can be wider — but only the
  // vertical band from the timer top to the split bottom). The timer's vertical
  // bounds don't depend on the elapsed value (height is fontSize-based and the
  // position is fixed during export), so we measure once.
  const region = (() => {
    const scratch = Skia.Surface.MakeOffscreen(8, 8);
    if (!scratch) throw new Error("Skia.Surface.MakeOffscreen returned null (measure)");
    const measureCtx = new SkiaOverlayContext(scratch.getCanvas(), typefaces);
    const tb = getStopwatchBounds(measureCtx, { width, height }, config, 0);
    scratch.dispose?.();
    const splitFontSize = Math.round(config.fontSize * 0.55);
    const splitPad = Math.round(config.padding * 0.6);
    const memoGap = Math.round(splitFontSize * 0.25);
    const memoFontSize = Math.round(config.fontSize * 0.38);
    const splitGap = 4;
    // Assume a memo is present (tallest case) so the band never clips a split.
    const maxSplitH = splitFontSize + 2 * splitPad + memoGap + memoFontSize;
    const margin = Math.max(8, Math.round(config.fontSize * 0.12));
    const top = Math.max(0, Math.floor(tb.y - margin));
    const bottom = Math.min(
      Math.round(height),
      Math.ceil(tb.y + tb.height + splitGap + maxSplitH + margin),
    );
    return { x: 0, y: top, width: Math.round(width), height: Math.max(1, bottom - top) };
  })();

  const dir = new Directory(Paths.cache, `swimhub-ol-${width}x${height}`);
  if (dir.exists) dir.delete();
  dir.create();

  const total = Math.max(0, Math.ceil((endSec - startSec) * fps));
  // Catastrophe backstop: without this a mis-computed range (e.g. startSec 0 on
  // a 10-min clip) would try to render tens of thousands of PNGs, freezing the
  // JS thread and filling the disk. The caller narrows [startSec,endSec) to the
  // race window; this only fires on a genuinely out-of-range request.
  const MAX_SEQUENCE_FRAMES = 30 * 60 * 12; // ~12 min at 30fps
  if (total > MAX_SEQUENCE_FRAMES) {
    throw new Error(
      `Timer sequence too long: ${total} frames (max ${MAX_SEQUENCE_FRAMES}). Trim the clip.`,
    );
  }
  const surface = Skia.Surface.MakeOffscreen(region.width, region.height);
  if (!surface) throw new Error("Skia.Surface.MakeOffscreen returned null");

  // Yield to the event loop every few frames so the JS thread isn't frozen for
  // the entire sequence (each frame does a synchronous PNG encode + file write).
  const YIELD_EVERY = 4;

  try {
    const canvas = surface.getCanvas();
    // One context (and its font cache) reused across all frames — re-creating
    // it per frame would churn ~fps×duration SkFont objects. Each draw* fully
    // re-sets the ctx font/fillStyle/alpha it needs, so reuse is safe.
    const ctx = new SkiaOverlayContext(canvas, typefaces);
    for (let i = 0; i < total; i++) {
      const videoTime = startSec + i / fps;
      const elapsed = elapsedFor(videoTime);
      canvas.clear(Skia.Color("transparent"));
      // Translate so the draw* (which use full-frame coordinates) paint into the
      // region-sized surface.
      canvas.save();
      canvas.translate(-region.x, -region.y);
      drawStopwatch(ctx, { width, height }, config, elapsed);
      const split = activeSplitAt(elapsed);
      if (split) drawPassedSplit(ctx, { width, height }, config, elapsed, split);
      if (watermarkIcon) {
        drawWatermark(ctx, { width, height }, watermarkIcon, MOBILE_WATERMARK_OPTIONS);
      }
      canvas.restore();
      surface.flush();
      const image = surface.makeImageSnapshot();
      const bytes = image.encodeToBytes();
      image.dispose?.(); // release native/GPU memory each frame (see above)
      const name = `ol_${String(i + 1).padStart(5, "0")}.png`;
      const file = new File(dir, name);
      file.create();
      file.write(bytes);
      onProgress?.(i + 1, total);
      if (i % YIELD_EVERY === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  } catch (e) {
    // A mid-render failure (disk full, Skia error) would otherwise orphan the
    // frames already written to `dir`; delete the partial directory first so
    // the deterministic dir name doesn't leave GBs behind until the next run.
    try {
      if (dir.exists) dir.delete();
    } catch {
      // ignore cleanup errors
    }
    throw e;
  } finally {
    surface.dispose?.();
  }

  return {
    dir: dir.uri,
    pattern: `${dir.uri.replace(/\/$/, "")}/ol_%05d.png`,
    frameCount: total,
    fps,
    region,
  };
}

/** Delete a rendered timer-sequence directory (best-effort). */
export function deleteTimerSequence(dirUri: string | null | undefined): void {
  if (!dirUri) return;
  try {
    const dir = new Directory(dirUri);
    if (dir.exists) dir.delete();
  } catch {
    // ignore cleanup errors
  }
}
