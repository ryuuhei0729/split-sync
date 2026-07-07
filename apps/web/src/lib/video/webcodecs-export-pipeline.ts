/**
 * WebCodecs-based video export pipeline — the fast replacement for the ffmpeg.wasm
 * single-thread engine (`export-pipeline.ts`, kept as the fallback; see
 * `export-dispatcher.ts`).
 *
 * Architecture (Sprint Contract):
 *   mediabunny `Input` demuxes the source file and decodes it (via `CanvasSink`, which
 *   wraps a `VideoDecoder` and also applies the file's rotation metadata and any
 *   resolution scaling) -> each decoded frame is drawn onto a reusable `OffscreenCanvas`
 *   -> `webcodecs-frame-compositor` burns in the stopwatch/split/summary/watermark
 *   overlays using the same shared renderer as the live preview -> the composited canvas
 *   is captured and encoded (via mediabunny's `CanvasSource`, which wraps a
 *   `VideoEncoder` configured for H.264) -> muxed into an MP4 by mediabunny's `Output`,
 *   alongside the original audio track copied through byte-for-byte (no re-encode).
 *
 * mediabunny's Sink/Source classes own the underlying `VideoFrame`/`VideoDecoder`/
 * `VideoEncoder` lifecycle (including calling `.close()` on every frame) internally, so
 * this file does not need to manage that manually; it hands mediabunny a single
 * `OffscreenCanvas` and lets it capture the current pixels into a `VideoFrame`
 * synchronously each time `canvasSource.add()` is called.
 *
 * Reviewer C1 — abort coordination: the video and audio loops run concurrently. If either
 * fails mid-stream, we must not let the other keep running in the background (it would
 * race against the ffmpeg fallback re-decoding the same file, risking a double
 * decode/encode on the same device — the exact hang/crash pattern that motivated this
 * migration in the first place). This is guaranteed by two mechanisms together:
 *   1. A shared `AbortController`: whichever loop fails calls `abort()` first; the other
 *      loop checks `signal.aborted` between frames/packets and stops within one
 *      frame/packet of that happening (bounded, not "eventually").
 *   2. `Promise.allSettled` (not `Promise.all`): the pipeline does not proceed to
 *      `output.cancel()` / rethrow until *both* loops have actually finished — either
 *      normally or via their own rejection — so there is never a window where one loop is
 *      still running after this function has "moved on".
 */
import { BufferTarget, CanvasSink, CanvasSource, Mp4OutputFormat, Output } from "mediabunny";
import type { ExportSettings, OverlayImage, SplitTime, StopwatchConfig } from "@swimhub-timer/shared";
import { detectWebCodecsCapability } from "./webcodecs-capability";
import { buildEncoderConfig, scaleStopwatchConfigForExport } from "./webcodecs-encoder-config";
import { compositeFrame, createFrameCompositorContext } from "./webcodecs-frame-compositor";
import { setupAudioPassthrough } from "./webcodecs-audio-passthrough";
import { probeVideoSource } from "./webcodecs-source-probe";
import { WebCodecsUnsupportedError } from "./webcodecs-types";

/**
 * Tries to load the "SwimHub Timer" watermark icon as an `ImageBitmap`. Mirrors the
 * ffmpeg engine's icon fetch: on any failure, fall back to a text-only watermark
 * (`drawWatermark` already handles `icon: null` gracefully) rather than failing the export.
 */
async function loadWatermarkIcon(): Promise<OverlayImage | null> {
  try {
    const resp = await fetch("/apple-touch-icon.png");
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

export async function exportVideoWithStopwatchWebCodecs(
  videoFile: File,
  startSignalTime: number,
  stopwatchConfig: StopwatchConfig,
  originalVideoHeight: number,
  exportSettings: ExportSettings,
  onProgress: (percent: number) => void,
  showWatermark: boolean,
  splitTimes: SplitTime[],
  isFinished: boolean,
  finishTime: number | null,
  raceDistance: number | null,
): Promise<Blob> {
  const { input, videoTrack, displayWidth, displayHeight, fps } = await probeVideoSource(videoFile);

  if (!(await videoTrack.canDecode())) {
    throw new WebCodecsUnsupportedError("This browser cannot decode the source video's codec.");
  }

  const encoderConfig = buildEncoderConfig(displayWidth, displayHeight, exportSettings.resolution, fps);

  const capability = await detectWebCodecsCapability({
    width: encoderConfig.width,
    height: encoderConfig.height,
    bitrate: encoderConfig.bitrate,
    framerate: fps,
    codecString: encoderConfig.codecString,
  });
  if (!capability.supported) {
    throw new WebCodecsUnsupportedError(
      capability.reason ?? "WebCodecs H.264 encoding is not supported for this export.",
    );
  }

  // Scale font/padding/borderRadius proportionally when exporting at a different resolution
  // than the source, exactly like the ffmpeg engine, so the stopwatch keeps the same
  // relative on-screen size regardless of export resolution.
  const scaledConfig = scaleStopwatchConfigForExport(
    stopwatchConfig,
    exportSettings.resolution,
    originalVideoHeight,
    encoderConfig.height,
  );

  const watermarkIcon = showWatermark ? await loadWatermarkIcon() : null;

  const target = new BufferTarget();
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "in-memory" }), // equivalent to ffmpeg's `-movflags +faststart`
    target,
  });

  const compositor = createFrameCompositorContext(encoderConfig.width, encoderConfig.height);
  const canvasSource = new CanvasSource(compositor.canvas, {
    codec: "avc",
    bitrate: encoderConfig.bitrate,
    fullCodecString: encoderConfig.codecString,
    // Must match the capability probe's `hardwareAcceleration` (see webcodecs-capability.ts):
    // mediabunny re-runs `isConfigSupported` internally with this exact value and throws if it
    // fails, so probing with 'no-preference' but encoding with 'prefer-hardware' let SW-only
    // encoders pass the gate and then hard-fail here.
    hardwareAcceleration: "no-preference",
  });
  output.addVideoTrack(canvasSource);

  // setupAudioPassthrough must run (and, if applicable, addAudioTrack) before
  // output.start(); it may throw WebCodecsUnsupportedError (Reviewer C2: non-AAC audio or
  // no decoder config), which propagates out of this function before any output resource
  // is consumed — the dispatcher's catch-all then falls back to ffmpeg cleanly.
  const audioTrack = await input.getPrimaryAudioTrack();
  const audioHandle = await setupAudioPassthrough(audioTrack, output);

  // CanvasSink decodes + applies rotation metadata + scales to our target output size in
  // one step, so every yielded canvas is already exactly `encoderConfig.width x height`.
  const canvasSink = new CanvasSink(videoTrack, {
    width: encoderConfig.width,
    height: encoderConfig.height,
    // Our target dimensions are already aspect-corrected (see buildExportDimensions);
    // 'fill' avoids any sub-pixel letterboxing that 'contain' could introduce from the
    // even-number rounding.
    fit: "fill",
    // Reviewer Critical: without a pool, mediabunny allocates a brand-new OffscreenCanvas
    // for every decoded frame. Each one is fully consumed (composited + encoded) before the
    // next iteration, so a small ring buffer is enough to keep VRAM constant instead of
    // growing per-frame — the latter is what crashes the tab on iOS Safari for longer clips.
    poolSize: 2,
  });

  const durationSeconds =
    (await videoTrack.getDurationFromMetadata()) ?? (await videoTrack.computeDuration());
  const estimatedTotalFrames = Math.max(1, Math.round(durationSeconds * fps));

  // Reviewer C1: shared abort signal so a failure in either loop stops the other one
  // promptly instead of letting it keep decoding/encoding in the background.
  const abortController = new AbortController();

  let decodedFrames = 0;
  const runVideoLoop = async (): Promise<void> => {
    try {
      for await (const { canvas, timestamp, duration } of canvasSink.canvases()) {
        if (abortController.signal.aborted) break;

        compositeFrame(compositor, {
          sourceFrame: canvas,
          timestamp,
          startSignalTime,
          stopwatchConfig: scaledConfig,
          splitTimes,
          isFinished,
          finishTime,
          raceDistance,
          showWatermark,
          watermarkIcon,
        });

        // Respects encoder backpressure — this is also where a configuration/encode error
        // surfaces (see VideoEncoderWrapper), propagating up through this await.
        await canvasSource.add(timestamp, duration);

        if (abortController.signal.aborted) break;

        decodedFrames += 1;
        onProgress(Math.min(99, Math.round((decodedFrames / estimatedTotalFrames) * 100)));
      }
    } catch (err) {
      abortController.abort(err);
      throw err;
    } finally {
      try {
        canvasSource.close();
      } catch {
        // Best-effort: the output may already be in an error/canceled state.
      }
    }
  };

  const runAudioLoop = async (): Promise<void> => {
    if (!audioHandle) return;
    try {
      await audioHandle.run(abortController.signal);
    } catch (err) {
      abortController.abort(err);
      throw err;
    }
  };

  await output.start();

  // Wait for BOTH loops to fully settle (not just the first to reject) before deciding
  // whether to cancel/finalize — see the C1 note in the file header for why `allSettled`
  // (not `all`) is required for correctness here.
  const results = await Promise.allSettled([runVideoLoop(), runAudioLoop()]);
  const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");

  if (failure) {
    await output.cancel().catch(() => {
      // Best-effort cleanup; the original error is what matters to the caller/fallback.
    });
    throw failure.reason;
  }

  await output.finalize();
  onProgress(100);

  if (!target.buffer) {
    throw new Error("WebCodecs export produced no output buffer.");
  }
  return new Blob([target.buffer], { type: "video/mp4" });
}
