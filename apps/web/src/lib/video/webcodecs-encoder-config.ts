/**
 * Pure functions that resolve an `ExportSettings.resolution` + the source video's
 * (rotation-corrected) dimensions/frame rate into a concrete WebCodecs H.264
 * encoder configuration: output size, bitrate, and codec string.
 *
 * No I/O, no WebCodecs/mediabunny calls here — this is the "constraint layer" the
 * capability probe and the real encoder are both built from (see
 * `webcodecs-capability.ts` / `webcodecs-export-pipeline.ts`).
 */
import type { ExportResolution, StopwatchConfig } from "@swimhub-timer/shared";
import type { WebCodecsEncoderConfig } from "./webcodecs-types";

/** Round to the nearest even integer — H.264 requires even width/height, matching the
 *  ffmpeg engine's `scale=-2:H` filter (`-2` = "nearest even, preserving aspect ratio"). */
function toEven(value: number): number {
  const rounded = Math.round(value);
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

/**
 * Output pixel dimensions for a given export resolution, mirroring the ffmpeg engine's
 * `scale=-2:H` behavior: height is pinned to the requested resolution (or left as-is for
 * "original"), width is derived from the source's aspect ratio and rounded to the nearest
 * even integer.
 *
 * `originalWidth`/`originalHeight` must already be rotation-corrected (i.e. "how the video
 * looks the right way up"), e.g. from mediabunny's `InputVideoTrack.getDisplayWidth/Height()`.
 * Guards against `0`/non-finite inputs (e.g. called before `videoMetadata` has loaded) by
 * falling back to a 16:9 assumption rather than dividing by zero / producing `NaN`.
 */
export function buildExportDimensions(
  originalWidth: number,
  originalHeight: number,
  resolution: ExportResolution,
): { width: number; height: number } {
  const hasValidSource =
    Number.isFinite(originalWidth) && originalWidth > 0 && Number.isFinite(originalHeight) && originalHeight > 0;

  if (resolution === "original") {
    return {
      width: toEven(hasValidSource ? originalWidth : 0),
      height: toEven(hasValidSource ? originalHeight : 0),
    };
  }

  const targetHeight = parseInt(resolution, 10);
  const aspectRatio = hasValidSource ? originalWidth / originalHeight : 16 / 9;
  return { width: toEven(targetHeight * aspectRatio), height: toEven(targetHeight) };
}

// Bitrate heuristics chosen to be visually comparable to the ffmpeg engine's CRF-based
// quality (crf 23 for "original" exports, crf 28 for scaled 720/1080 exports). CRF is
// content-adaptive so there's no exact CRF -> bitrate formula; these are fixed targets
// picked for swim-footage characteristics (mostly static camera, water motion/noise):
// - 1080p ≈ 8 Mbps: comparable to common "high quality" 1080p30 H.264 recommendations.
// - 720p ≈ 5 Mbps: same logic scaled down for the smaller frame.
// - "original": scaled proportionally to source pixel count relative to 1080p and clamped,
//   so 4K+ source footage doesn't produce an unreasonably large file.
const BITRATE_1080P_BPS = 8_000_000;
const BITRATE_720P_BPS = 5_000_000;
const REFERENCE_PIXELS_1080P = 1920 * 1080;
const MIN_BITRATE_BPS = 3_000_000;
const MAX_BITRATE_BPS = 20_000_000;

export function computeBitrate(
  resolution: ExportResolution,
  outputWidth: number,
  outputHeight: number,
): number {
  if (resolution === "1080") return BITRATE_1080P_BPS;
  if (resolution === "720") return BITRATE_720P_BPS;

  // "original": scale the 1080p reference bitrate by the actual pixel-count ratio.
  const pixelRatio = (outputWidth * outputHeight) / REFERENCE_PIXELS_1080P;
  const scaled = Math.round(BITRATE_1080P_BPS * pixelRatio);
  return Math.min(MAX_BITRATE_BPS, Math.max(MIN_BITRATE_BPS, scaled));
}

/**
 * H.264 level limits (ITU-T H.264 Table A-1): MaxFS = max macroblocks per frame,
 * MaxMBPS = max macroblocks per second, MaxBR = max bitrate in bits/s at High Profile
 * (base-profile MaxBR x1.25, the standard's `cpbBrVclFactor` for High Profile).
 *
 * QA correction (see Sprint Contract notes): a fixed Baseline Level 3.1 probe string
 * (`avc1.42E01F`) under-provisions real encodes — Level 3.1's MaxMBPS (108000) only
 * covers ~13fps at 1080p's 8160 macroblocks/frame, yet `isConfigSupported` could still
 * report `true` for a single low-bitrate probe. We instead pick a level from *this*
 * export's actual width/height/fps/bitrate, and use that exact string for both the
 * capability probe and the real `VideoEncoder`/mediabunny encoder config.
 */
// Reviewer W2: extended up through Level 6.2 (previously topped out at 5.1, which made
// 4K60+ source footage always miss the probe and fall back to ffmpeg — recent iPhones
// routinely shoot 4K60/ProRAW-adjacent H.264 footage that needs these higher levels).
const AVC_LEVELS = [
  { level: 0x1f, name: "3.1", maxMacroblocks: 3600, maxMbps: 108_000, maxBitrate: 14_000_000 * 1.25 },
  { level: 0x20, name: "3.2", maxMacroblocks: 5120, maxMbps: 216_000, maxBitrate: 20_000_000 * 1.25 },
  { level: 0x28, name: "4.0", maxMacroblocks: 8192, maxMbps: 245_760, maxBitrate: 20_000_000 * 1.25 },
  { level: 0x29, name: "4.1", maxMacroblocks: 8192, maxMbps: 245_760, maxBitrate: 50_000_000 * 1.25 },
  { level: 0x2a, name: "4.2", maxMacroblocks: 8704, maxMbps: 522_240, maxBitrate: 50_000_000 * 1.25 },
  { level: 0x32, name: "5.0", maxMacroblocks: 22_080, maxMbps: 589_824, maxBitrate: 135_000_000 * 1.25 },
  { level: 0x33, name: "5.1", maxMacroblocks: 36_864, maxMbps: 983_040, maxBitrate: 240_000_000 * 1.25 },
  { level: 0x34, name: "5.2", maxMacroblocks: 36_864, maxMbps: 2_073_600, maxBitrate: 240_000_000 * 1.25 },
  { level: 0x3c, name: "6.0", maxMacroblocks: 139_264, maxMbps: 4_177_920, maxBitrate: 240_000_000 * 1.25 },
  { level: 0x3d, name: "6.1", maxMacroblocks: 139_264, maxMbps: 8_355_840, maxBitrate: 480_000_000 * 1.25 },
  { level: 0x3e, name: "6.2", maxMacroblocks: 139_264, maxMbps: 16_711_680, maxBitrate: 800_000_000 * 1.25 },
] as const;

/** High Profile — matches mediabunny's own default codec string for `'avc'`, and is broadly
 *  hardware-accelerated (iOS VideoToolbox, Android MediaCodec, desktop Chrome/Edge) while
 *  compressing noticeably better than Baseline at the same bitrate. We prioritize iOS
 *  hardware-encoder compatibility since that's this app's primary export platform, and
 *  every iPhone capable of running this app's WebCodecs pipeline supports High Profile. */
const AVC_HIGH_PROFILE = 0x64;

function pickAvcLevel(width: number, height: number, fps: number, bitrate: number) {
  const macroblocks = Math.ceil(width / 16) * Math.ceil(height / 16);
  const macroblocksPerSecond = macroblocks * fps;

  const fit = AVC_LEVELS.find(
    (candidate) =>
      candidate.maxMacroblocks >= macroblocks &&
      candidate.maxMbps >= macroblocksPerSecond &&
      candidate.maxBitrate >= bitrate,
  );
  // If nothing fits (extreme resolution/fps/bitrate), use the highest level we know about —
  // isConfigSupported() will correctly report unsupported and the caller falls back to ffmpeg.
  // AVC_LEVELS is a non-empty literal array declared immediately above.
  return fit ?? AVC_LEVELS[AVC_LEVELS.length - 1]!;
}

function buildAvcCodecString(level: number): string {
  const profileHex = AVC_HIGH_PROFILE.toString(16).padStart(2, "0");
  const levelHex = level.toString(16).padStart(2, "0");
  return `avc1.${profileHex}00${levelHex}`;
}

/**
 * Resolves an export request into a concrete WebCodecs H.264 encoder configuration
 * (output size, bitrate, and a resolution/fps-appropriate codec string).
 *
 * `originalWidth`/`originalHeight` should be rotation-corrected display dimensions (see
 * `buildExportDimensions`); `fps` is the source video's frame rate (used only to pick a
 * safe AVC level — see `pickAvcLevel` — not to alter timing).
 */
export function buildEncoderConfig(
  originalWidth: number,
  originalHeight: number,
  resolution: ExportResolution,
  fps: number,
): WebCodecsEncoderConfig {
  const { width, height } = buildExportDimensions(originalWidth, originalHeight, resolution);
  const bitrate = computeBitrate(resolution, width, height);
  const level = pickAvcLevel(width, height, fps, bitrate);

  return {
    width,
    height,
    bitrate,
    codecString: buildAvcCodecString(level.level),
    levelName: level.name,
  };
}

/**
 * Scales `fontSize`/`padding`/`borderRadius` proportionally when exporting at a
 * different resolution than the source, so the stopwatch keeps the same relative
 * on-screen size regardless of export resolution. This is a straight port of
 * `export-pipeline.ts`'s (ffmpeg engine) scaling logic, kept as its own pure function so
 * both engines can share (and test) the exact same formula.
 *
 * No-ops (returns `config` unchanged) for `resolution === "original"` or when
 * `originalVideoHeight` isn't known yet (`<= 0`), matching the ffmpeg engine's guard.
 */
export function scaleStopwatchConfigForExport(
  config: StopwatchConfig,
  resolution: ExportResolution,
  originalVideoHeight: number,
  outputHeight: number,
): StopwatchConfig {
  if (resolution === "original" || originalVideoHeight <= 0) {
    return config;
  }

  const resScale = outputHeight / originalVideoHeight;
  return {
    ...config,
    fontSize: Math.round(config.fontSize * resScale),
    padding: Math.round(config.padding * resScale),
    borderRadius: Math.round(config.borderRadius * resScale),
  };
}
