/**
 * Chooses the video export engine: prefers the fast WebCodecs pipeline
 * (`webcodecs-export-pipeline.ts`) and transparently falls back to the ffmpeg.wasm
 * single-thread engine (`export-pipeline.ts`) in two independent situations:
 *
 *   1. `checkWebCodecsSupport()` reports the browser/config as unsupported up front —
 *      the WebCodecs pipeline module is never even invoked in this case.
 *   2. The WebCodecs pipeline *is* attempted (capability check passed) but throws for
 *      any reason at runtime (mid-decode, mid-encode, mux failure, ...).
 *
 * (2) must never be skipped: WebCodecs support (and correctness) varies a lot across
 * browsers/OS versions/video codecs, and a previous production incident with the ffmpeg
 * multi-thread core taught us that a client-side export path silently hanging is much
 * worse than a slower-but-working one (see the comment in `ffmpeg-manager.ts`). A single
 * `try/catch` around the whole WebCodecs call is what guarantees that — and because the
 * ffmpeg fallback call below reads only from the original `options` (never from any
 * value computed inside the failed WebCodecs attempt), a partial WebCodecs failure can
 * never leak into the ffmpeg run: it always starts from the source file from scratch.
 */
import { checkWebCodecsSupport } from "./webcodecs-capability";
import { exportVideoWithStopwatch } from "./export-pipeline";
import { exportVideoWithStopwatchWebCodecs } from "./webcodecs-export-pipeline";
import type { ExportEngineResult, ExportVideoOptions } from "./webcodecs-types";

export async function dispatchVideoExport(options: ExportVideoOptions): Promise<ExportEngineResult> {
  const supported = await checkWebCodecsSupport(
    options.originalVideoWidth,
    options.originalVideoHeight,
    options.exportSettings.resolution,
  );

  if (supported) {
    try {
      const blob = await exportVideoWithStopwatchWebCodecs(
        options.videoFile,
        options.startSignalTime,
        options.stopwatchConfig,
        options.originalVideoHeight,
        options.exportSettings,
        options.onProgress,
        options.showWatermark,
        options.splitTimes,
        options.isFinished,
        options.finishTime,
        options.raceDistance,
      );
      return { blob, engine: "webcodecs" };
    } catch (err) {
      console.warn("[export-dispatcher] WebCodecs export failed at runtime, falling back to ffmpeg.wasm.", err);
      options.onProgress(0);
    }
  }

  const blob = await exportVideoWithStopwatch(
    options.videoFile,
    options.startSignalTime,
    options.stopwatchConfig,
    options.originalVideoHeight,
    options.exportSettings,
    options.onProgress,
    options.showWatermark,
    options.summaryImageData,
    options.finishTime,
  );
  return { blob, engine: "ffmpeg" };
}
