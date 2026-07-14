/**
 * Type definitions for the client-side WebCodecs export pipeline.
 *
 * These types are web-only (WebCodecs / OffscreenCanvas / mediabunny are browser
 * APIs with no mobile equivalent), so they live in `apps/web` rather than
 * `apps/shared`. See `webcodecs-export-pipeline.ts` for how they're wired together
 * and `export-dispatcher.ts` for the ffmpeg.wasm fallback.
 */
import type { ExportSettings, SplitTime, StopwatchConfig, OverlayImage } from "@swimhub-timer/shared";

/** Result of probing whether this browser can encode the export at the resolved config. */
export interface WebCodecsCapability {
  supported: boolean;
  /** Human-readable reason when `supported` is false; surfaced on the PoC page and in logs. */
  reason?: string;
}

/**
 * Resolved WebCodecs video encoder parameters for a single export, derived from the
 * requested `ExportResolution` plus the source video's (rotation-corrected) dimensions
 * and frame rate. See `webcodecs-encoder-config.ts` for how each field is computed.
 */
export interface WebCodecsEncoderConfig {
  /** Output pixel dimensions after scale + rotation. Always even (H.264 macroblock alignment). */
  width: number;
  height: number;
  /** Target bitrate in bits per second (CRF-equivalent heuristic). */
  bitrate: number;
  /**
   * Full WebCodecs codec string (`avc1.<profile><constraint><level>`), sized to `width`/`height`
   * and the source frame rate so the encoder is never under-provisioned (see `pickAvcLevel` /
   * `buildEncoderConfig` in `webcodecs-encoder-config.ts`). This exact string is used for BOTH the
   * `VideoEncoder.isConfigSupported` capability probe and the real encoder configuration, so a
   * "supported" probe result is guaranteed to reflect the config that will actually be used.
   */
  codecString: string;
  /** Human-readable AVC level (e.g. `"4.2"`), for diagnostics on the PoC page. */
  levelName: string;
}

/** Everything the frame compositor needs to draw one composited output frame. */
export interface FrameCompositorContext {
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
  width: number;
  height: number;
}

/** Per-frame input for `compositeFrame` — mirrors the live preview's per-frame state in `useCanvasCompositor`. */
export interface FrameCompositorInput {
  /** The decoded source frame for this timestamp, already rotated + scaled by mediabunny's CanvasSink. */
  sourceFrame: CanvasImageSource;
  /** Presentation timestamp of this frame, in seconds, in the source video's timeline. */
  timestamp: number;
  startSignalTime: number;
  stopwatchConfig: StopwatchConfig;
  splitTimes: SplitTime[];
  isFinished: boolean;
  finishTime: number | null;
  raceDistance: number | null;
  showWatermark: boolean;
  watermarkIcon: OverlayImage | null;
}

/** Common return shape for both the WebCodecs and ffmpeg export engines (see `export-dispatcher.ts`). */
export interface ExportEngineResult {
  blob: Blob;
  engine: "webcodecs" | "ffmpeg";
}

/** Full option set accepted by the export dispatcher — a superset of the legacy `exportVideoWithStopwatch` params. */
export interface ExportVideoOptions {
  videoFile: File;
  startSignalTime: number;
  stopwatchConfig: StopwatchConfig;
  originalVideoWidth: number;
  originalVideoHeight: number;
  exportSettings: ExportSettings;
  onProgress: (percent: number) => void;
  showWatermark: boolean;
  splitTimes: SplitTime[];
  isFinished: boolean;
  finishTime: number | null;
  raceDistance: number | null;
  /** Pre-rendered finish-summary PNG; only consumed by the ffmpeg fallback engine. */
  summaryImageData: Blob | null;
}

/**
 * Thrown by the WebCodecs pipeline when this browser/video combination can't use it
 * (missing APIs, unsupported codec, encoder probe failure, ...). It is caught by
 * `export-dispatcher.ts` exactly like any other runtime error and triggers the
 * ffmpeg.wasm fallback — this class exists only to make that reason legible in logs.
 */
export class WebCodecsUnsupportedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "WebCodecsUnsupportedError";
  }
}
