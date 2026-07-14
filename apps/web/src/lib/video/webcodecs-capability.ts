/**
 * Feature detection for the client-side WebCodecs export pipeline.
 *
 * This is a coarse-but-honest gate: any missing API or a negative/throwing
 * `isConfigSupported` probe means "not supported", so `export-dispatcher.ts` can fall
 * back to the ffmpeg.wasm engine instead of the pipeline hanging or crashing later.
 */
import type { ExportResolution } from "@swimhub-timer/shared";
import { buildEncoderConfig } from "./webcodecs-encoder-config";
import type { WebCodecsCapability } from "./webcodecs-types";

export interface WebCodecsCapabilityParams {
  width: number;
  height: number;
  bitrate: number;
  framerate: number;
  /**
   * Full codec string to probe, e.g. `avc1.640033`. Must be the exact string that will
   * later be passed to the real encoder (see `buildEncoderConfig`) — probing a
   * different (typically lower/safer) string than what's actually configured would let a
   * `supported: true` result hide a real configuration failure at encode time.
   */
  codecString: string;
}

export async function detectWebCodecsCapability(
  params: WebCodecsCapabilityParams,
): Promise<WebCodecsCapability> {
  if (typeof VideoEncoder === "undefined" || typeof VideoDecoder === "undefined") {
    return { supported: false, reason: "VideoEncoder/VideoDecoder is not available in this browser." };
  }
  if (typeof OffscreenCanvas === "undefined") {
    return { supported: false, reason: "OffscreenCanvas is not available in this browser." };
  }

  try {
    const result = await VideoEncoder.isConfigSupported({
      codec: params.codecString,
      width: params.width,
      height: params.height,
      bitrate: params.bitrate,
      framerate: params.framerate,
      // Reviewer note (W1): probing with 'prefer-hardware' makes `isConfigSupported`
      // report `false` on environments without a hardware H.264 encoder (some
      // Linux/VMs/low-end Android) even though a software encoder could do the job —
      // sending those environments to the ffmpeg fallback unnecessarily. The probe uses
      // 'no-preference' so it only reflects "can this browser encode this at all". The real
      // encoder (`CanvasSource` in `webcodecs-export-pipeline.ts`) MUST request the same
      // 'no-preference' value: mediabunny re-runs `isConfigSupported` internally with
      // whatever `hardwareAcceleration` it's given and throws if that check fails, so a
      // stricter value there (e.g. 'prefer-hardware') *does* change whether configuration
      // succeeds — it would make this probe pass while the real encoder throws on SW-only
      // devices, wasting a full decode before falling back to ffmpeg.
      hardwareAcceleration: "no-preference",
    });

    if (!result.supported) {
      return {
        supported: false,
        reason: `VideoEncoder.isConfigSupported reported '${params.codecString}' at ${params.width}x${params.height} as unsupported.`,
      };
    }
  } catch (err) {
    return {
      supported: false,
      reason: err instanceof Error ? err.message : "VideoEncoder.isConfigSupported threw an error.",
    };
  }

  return { supported: true };
}

/**
 * Coarse, dispatcher-facing capability gate (see `export-dispatcher.ts`): resolves the
 * export's actual target width/height for `resolution` via `buildEncoderConfig` (so the
 * probed codec string/level always matches this specific export, never a fixed Baseline
 * Level 3.1 string that could under-provision 1080p — see the Sprint Contract QA note in
 * `webcodecs-encoder-config.ts`), then delegates to `detectWebCodecsCapability`.
 *
 * Known limitation (Reviewer W3, tracked but not fully closed this round): `fps` defaults
 * to 30 here, while the real pipeline (`webcodecs-export-pipeline.ts`) measures the
 * source's actual frame rate. A source that is e.g. 60fps could therefore be probed here
 * at an under-provisioned level. This is deliberately *not* fixed by having this function
 * open/parse the video file itself (which would require changing this signature away from
 * the plain numbers QA's Phase B test suite (`__tests__/webcodecs-capability.test.ts`) and
 * `export-dispatcher.test.ts` already assert against, and — more importantly — the
 * dispatcher unit tests do not mock any file-parsing module, so the dispatcher itself must
 * stay free of direct mediabunny calls). Safety is still guaranteed because
 * `webcodecs-export-pipeline.ts` re-runs this exact check with the *real* fps immediately
 * before starting the encoder (see `WebCodecsUnsupportedError` there); a wrong "supported"
 * verdict here only costs a wasted attempt before falling back to ffmpeg, it never produces
 * a broken export. Flagged for PM/QA follow-up: closing this fully requires either passing
 * a pre-measured fps through `ExportVideoOptions`, or updating the dispatcher test's mocking
 * strategy to allow a source probe.
 *
 * Returns a plain boolean (rather than `WebCodecsCapability`) because the dispatcher only
 * needs a yes/no branch decision; never throws (`detectWebCodecsCapability` already
 * catches `isConfigSupported` errors).
 */
export async function checkWebCodecsSupport(
  originalWidth: number,
  originalHeight: number,
  resolution: ExportResolution,
  fps = 30,
): Promise<boolean> {
  const config = buildEncoderConfig(originalWidth, originalHeight, resolution, fps);
  const capability = await detectWebCodecsCapability({
    width: config.width,
    height: config.height,
    bitrate: config.bitrate,
    framerate: fps,
    codecString: config.codecString,
  });
  return capability.supported;
}
