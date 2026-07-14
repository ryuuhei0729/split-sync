/**
 * Renders a transparent overlay PNG sequence (timer / split badge / watermark — see
 * `overlay-frame-renderer.ts`) at a fixed output frame rate, for the ffmpeg.wasm fallback
 * engine (`export-pipeline.ts`) to feed into ffmpeg as a second `-framerate <fps> -i
 * overlay_%05d.png` input, composited via the `overlay` filter (案A).
 *
 * Has no ffmpeg dependency itself: each encoded frame is handed to the caller via
 * `onFrame` one at a time (never buffered as an array of Blobs in *this module's* JS heap),
 * so the caller can write it straight into ffmpeg's virtual filesystem and let the
 * `Uint8Array` be GC'd before the next frame is encoded — a 44s/30fps export (~1,320 frames)
 * never holds more than one frame's PNG bytes in this module's own memory at a time, instead
 * of ~1,320 of them.
 *
 * This does NOT make the export's overall memory footprint constant: every written frame
 * still accumulates in ffmpeg.wasm's virtual filesystem (MEMFS) for the duration of the
 * `ffmpeg.exec()` call, so total MEMFS usage still grows roughly linearly with clip length
 * (measured ~59KB/frame at 1080p in a Sprint Contract spike — see the Developer report for
 * numbers and the follow-up bounding-box-crop idea that was deliberately deferred).
 */
import type { OverlayImage, SplitTime, StopwatchConfig } from "@swimhub-timer/shared";
import { compositeOverlayFrame, createOverlayFrameCompositorContext } from "./overlay-frame-renderer";

/** ffmpeg's image2 demuxer default `start_number` is `0`, so the sequence is 0-indexed
 *  (`overlay_00000.png`, `overlay_00001.png`, ...) — no `-start_number` flag needed. */
const FRAME_INDEX_PAD = 5;

/** File name for a given 0-based frame index, matching the `overlay_%05d.png` pattern
 *  passed to ffmpeg as its second input. */
export function overlayPngFileName(index: number): string {
  return `overlay_${String(index).padStart(FRAME_INDEX_PAD, "0")}.png`;
}

/**
 * Total frame count for a `durationSeconds`/`fps` pair — at least 1 frame even for a
 * near-zero-length source, so ffmpeg's overlay input is never empty.
 *
 * Exported as the single source of truth for this calculation: `generateOverlayPngSequence`
 * uses it internally, and callers that need the total *before* the sequence finishes
 * generating (e.g. `export-pipeline.ts`'s `onFrame` progress callback, which must not read
 * the function's own return value — that binding isn't initialized until the whole
 * `await` resolves, i.e. after every `onFrame` call has already run) must call this instead
 * of duplicating the formula.
 */
export function computeOverlayFrameCount(durationSeconds: number, fps: number): number {
  return Math.max(1, Math.ceil(durationSeconds * fps));
}

export interface OverlayPngSequenceOptions {
  /** Output pixel dimensions — the caller should pass the main video's post-scale
   *  dimensions (see `buildExportDimensions` in `webcodecs-encoder-config.ts`) so that
   *  `overlay=0:0` in ffmpeg needs no extra scaling filter on this input. Whether that
   *  always lines up exactly with ffmpeg's own scaled output for every source is not
   *  independently verified here — see the caller's (`export-pipeline.ts`) notes. */
  width: number;
  height: number;
  /** Output frame rate the sequence is generated at (must match the `-framerate` value
   *  ffmpeg is given for this input — typically the source's probed fps). */
  fps: number;
  /** Total duration (seconds) the sequence must cover; at least 1 frame is always produced
   *  even for a near-zero-length source. */
  durationSeconds: number;
  startSignalTime: number;
  stopwatchConfig: StopwatchConfig;
  splitTimes: SplitTime[];
  isFinished: boolean;
  finishTime: number | null;
  showWatermark: boolean;
  watermarkIcon: OverlayImage | null;
  /**
   * Called once per generated frame, in order, with its 0-based sequence index and the
   * encoded transparent PNG bytes. The callback owns writing it to ffmpeg's virtual
   * filesystem (`ffmpegManager.writeFile(overlayPngFileName(index), png)`); this module
   * stays independently testable without an ffmpeg dependency.
   */
  onFrame: (index: number, png: Uint8Array) => Promise<void> | void;
}

export interface OverlayPngSequenceResult {
  /** Total number of frames generated (and passed to `onFrame`). */
  frameCount: number;
}

export async function generateOverlayPngSequence(
  options: OverlayPngSequenceOptions,
): Promise<OverlayPngSequenceResult> {
  const { width, height, fps, durationSeconds, onFrame } = options;

  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error(`generateOverlayPngSequence: invalid output size ${width}x${height}.`);
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(`generateOverlayPngSequence: invalid fps ${fps}.`);
  }

  const frameCount = computeOverlayFrameCount(durationSeconds, fps);
  const context = createOverlayFrameCompositorContext(width, height);

  for (let index = 0; index < frameCount; index++) {
    compositeOverlayFrame(context, {
      timestamp: index / fps,
      startSignalTime: options.startSignalTime,
      stopwatchConfig: options.stopwatchConfig,
      splitTimes: options.splitTimes,
      isFinished: options.isFinished,
      finishTime: options.finishTime,
      showWatermark: options.showWatermark,
      watermarkIcon: options.watermarkIcon,
    });

    const blob = await context.canvas.convertToBlob({ type: "image/png" });
    const png = new Uint8Array(await blob.arrayBuffer());
    await onFrame(index, png);
  }

  return { frameCount };
}
