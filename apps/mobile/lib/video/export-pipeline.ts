import { Platform } from "react-native";
import type { StopwatchConfig, ExportSettings, SplitTime, ExportResolution } from "@swimhub-timer/shared";
import { SUMMARY_DELAY_SECONDS, SPLIT_DISPLAY_DURATION_SECONDS } from "@swimhub-timer/shared";
import type { StreamInformation } from "ffmpeg-kit-react-native";
// Minimum stretch of the existing video the summary must stay visible for.
// If the recording was stopped within SUMMARY_DELAY_SECONDS of the finish
// touch, the delayed transition would land past the end of the clip and the
// summary would never appear (while the preview still shows it). In that case
// we pull the transition earlier so it falls on the remaining frames.
const MIN_SUMMARY_VISIBLE_SECONDS = 1.5;

/**
 * Absolute video time (seconds) at which the stopwatch/splits hide and the
 * finish summary appears. Single source of truth shared by the stopwatch,
 * split, and summary-overlay filters so they transition in lockstep.
 *
 * Returns null when there is no finish (summary not shown).
 */
export function computeSummaryStartT(
  startSignalTime: number,
  finishTime: number | null,
  videoDurationSec: number,
): number | null {
  if (finishTime === null) return null;
  const finishAbs = startSignalTime + finishTime;
  const desired = finishAbs + SUMMARY_DELAY_SECONDS;
  if (videoDurationSec > 0 && desired > videoDurationSec - MIN_SUMMARY_VISIBLE_SECONDS) {
    // Clamp so the summary still lands on real frames, never earlier than the
    // finish moment itself (which matches the preview's earliest visibility),
    // and never at/after the clip end (else the overlay's gte(t,…) matches no
    // frame and the summary never appears in the export).
    const latest = videoDurationSec - 0.05;
    return Math.min(latest, Math.max(finishAbs, videoDurationSec - MIN_SUMMARY_VISIBLE_SECONDS));
  }
  return desired;
}

function getFFmpeg() {
  try {
    return require("ffmpeg-kit-react-native");
  } catch {
    throw new Error("FFmpeg is not available. Please use a development build.");
  }
}

// ---------------------------------------------------------------------------
// Hardware encoder helpers (pure functions)
// ---------------------------------------------------------------------------

export function getHwEncoder(): "h264_videotoolbox" | "h264_mediacodec" | null {
  if (Platform.OS === "ios") return "h264_videotoolbox";
  if (Platform.OS === "android") return "h264_mediacodec";
  return null;
}

export function buildHwDecodeArgs(useHw: boolean): string {
  if (!useHw) return "";
  if (Platform.OS === "ios") return "-hwaccel videotoolbox";
  if (Platform.OS === "android") return "-hwaccel mediacodec";
  return "";
}

export function buildVideoBitrateArgs(resolution: ExportResolution): string {
  switch (resolution) {
    case "original":
    case "1080":
      return "-b:v 10M -maxrate 12M -bufsize 16M";
    case "720":
    default:
      return "-b:v 5M -maxrate 6M -bufsize 8M";
  }
}

export function buildVideoEncoderArgs(
  encoder: "h264_videotoolbox" | "h264_mediacodec" | null,
  resolution: ExportResolution,
  crf: string,
): string {
  if (encoder === null) {
    return `-c:v libx264 -preset veryfast -crf ${crf}`;
  }
  return `-c:v ${encoder} ${buildVideoBitrateArgs(resolution)}`;
}

export function buildAudioArgs(audioCodec: string | null): string {
  if (audioCodec?.toLowerCase() === "aac") {
    return "-c:a copy";
  }
  return "-c:a aac -b:a 128k";
}

// ---------------------------------------------------------------------------
// Audio codec detection (side-effectful)
// ---------------------------------------------------------------------------

export async function detectAudioCodec(videoUri: string): Promise<string | null> {
  try {
    const { FFprobeKit } = getFFmpeg();
    const session = await FFprobeKit.getMediaInformation(videoUri);
    const info = session.getMediaInformation();
    if (!info) return null;
    const streams: StreamInformation[] = info.getStreams();
    for (const stream of streams) {
      if (stream.getType() === "audio") {
        return stream.getCodec();
      }
    }
    return null;
  } catch {
    return null;
  }
}

function rgbaToFFmpegColor(rgba: string): string {
  if (rgba.startsWith("rgba")) {
    const match = rgba.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
    const rStr = match?.[1];
    const gStr = match?.[2];
    const bStr = match?.[3];
    const aStr = match?.[4];
    if (rStr && gStr && bStr && aStr) {
      const r = parseInt(rStr).toString(16).padStart(2, "0");
      const g = parseInt(gStr).toString(16).padStart(2, "0");
      const b = parseInt(bStr).toString(16).padStart(2, "0");
      return `#${r}${g}${b}@${parseFloat(aStr).toFixed(2)}`;
    }
  }
  return rgba;
}

// Box-outer-aligned X position. FFmpeg drawtext places the TEXT origin at x
// and, with box=1, paints the background `boxBorderW` beyond the glyphs on
// every side. The RN preview instead aligns the OUTER box edge to the anchor
// point (padding is inset — see getTimerWrapperPixelStyle/getSplitBadgePixelStyle).
// We shift x by boxBorderW so the outer box lands where the preview puts it.
// `boxBorderW` is the relevant box border: config.padding for the timer,
// splitPad for the split badge.
function buildBoxedPositionX(config: StopwatchConfig, boxBorderW: number): string {
  const base = `(w*${config.position.x})`;
  switch (config.anchor) {
    // Preview frame-centers the box horizontally for *-center anchors
    // (position.x is ignored), so mirror that instead of centering on x.
    case "top-center":
    case "bottom-center":
      return `(w-tw)/2`;
    // Box centered on the point; the boxborder offsets cancel out.
    case "center":
      return `${base}-tw/2`;
    case "top-right":
    case "bottom-right":
      return `${base}-tw-${boxBorderW}`;
    default:
      return `${base}+${boxBorderW}`;
  }
}

// Timer Y: the timer box is anchored directly at the point (unlike the split,
// which sits below the timer), so the same boxborder compensation applies here.
function buildTimerPositionY(config: StopwatchConfig): string {
  const base = `(h*${config.position.y})`;
  const bb = config.padding;
  switch (config.anchor) {
    case "bottom-left":
    case "bottom-center":
    case "bottom-right":
      return `${base}-th-${bb}`;
    case "center":
      return `${base}-th/2`;
    default:
      return `${base}+${bb}`;
  }
}

/**
 * Build drawtext filters for the main stopwatch timer. Uses two filters with
 * mutually-exclusive `enable` clauses so the format matches the preview's
 * `formatTime()` exactly:
 *   - elapsed < 60s:   SS.xx     (no minute prefix)
 *   - elapsed >= 60s:  M:SS.xx
 */
function buildStopwatchFilters(
  startSignalTime: number,
  config: StopwatchConfig,
  isFinished: boolean,
  finishTime: number | null,
  fontPath: string | null,
  summaryStartT: number | null,
): string[] {
  const startT = startSignalTime.toFixed(3);

  const rawText = `max(0\\, t-${startT})`;
  const elapsedText =
    isFinished && finishTime !== null ? `min(${finishTime.toFixed(3)}\\, ${rawText})` : rawText;
  const elapsedEnable =
    isFinished && finishTime !== null
      ? `min(${finishTime.toFixed(3)}, max(0, t-${startSignalTime.toFixed(3)}))`
      : `max(0, t-${startSignalTime.toFixed(3)})`;

  const minutes = `trunc(${elapsedText}/60)`;
  const seconds = `trunc(mod(${elapsedText}\\,60))`;
  const centis = `trunc(mod(${elapsedText}*100\\,100))`;

  const xExpr = buildBoxedPositionX(config, config.padding);
  const yExpr = buildTimerPositionY(config);

  const fontPart = fontfileArg(fontPath);
  const baseParts = [
    ...(fontPart ? [fontPart] : []),
    `fontsize=${config.fontSize}`,
    `fontcolor=${config.textColor}`,
    `box=1`,
    `boxcolor=${rgbaToFFmpegColor(config.backgroundColor)}`,
    `boxborderw=${config.padding}`,
    `x=${xExpr}`,
    `y=${yExpr}`,
  ];

  // Match formatTime():
  //  - <60s: `${s}.${pad2(cs)}` (seconds not zero-padded)
  //  - >=60s: `${m}:${pad2(s)}.${pad2(cs)}` (minutes not zero-padded, seconds padded)
  const textUnder60 = `%{eif\\:${seconds}\\:d}.%{eif\\:${centis}\\:d\\:2}`;
  const textOver60 = `%{eif\\:${minutes}\\:d}\\:%{eif\\:${seconds}\\:d\\:2}.%{eif\\:${centis}\\:d\\:2}`;

  const cutoffGuard =
    summaryStartT !== null ? `*lt(t, ${summaryStartT.toFixed(3)})` : "";

  const under60Enable = `lt(${elapsedEnable}, 60)${cutoffGuard}`;
  const over60Enable = `gte(${elapsedEnable}, 60)${cutoffGuard}`;

  return [
    `drawtext=enable='${under60Enable}':${baseParts.join(":")}:text='${textUnder60}'`,
    `drawtext=enable='${over60Enable}':${baseParts.join(":")}:text='${textOver60}'`,
  ];
}

/**
 * Build drawtext filters for the active split — mirrors the web preview
 * (apps/web/src/hooks/useCanvasCompositor.ts): each split appears for
 * SPLIT_DISPLAY_DURATION_SECONDS once its time mark is reached, and is
 * superseded by the next split if one lands inside that window.
 *
 * Format matches the web renderer: "<dist>m: <time>".
 */
function buildPassedSplitFilters(
  startSignalTime: number,
  config: StopwatchConfig,
  finishTime: number | null,
  splits: SplitTime[],
  raceDistance: number | null,
  fontPath: string | null,
  memoFontPath: string | null,
  summaryStartT: number | null,
): string[] {
  if (splits.length === 0) return [];

  const visible = splits
    .filter((s) => {
      if (finishTime !== null && raceDistance !== null) {
        if (s.distance === raceDistance && s.time === finishTime) return false;
      }
      return true;
    })
    .sort((a, b) => a.time - b.time);

  if (visible.length === 0) return [];

  const splitFontSize = Math.max(8, Math.round(config.fontSize * 0.55));
  const splitMemoFontSize = Math.max(7, Math.round(config.fontSize * 0.38));
  const splitPad = Math.max(3, Math.round(config.padding * 0.6));
  const splitGap = Math.max(2, Math.round(config.padding * 0.3));
  const headlineH = splitFontSize + 2 * splitPad;
  const timerH = config.fontSize + 2 * config.padding;
  const fontPart = fontfileArg(fontPath);

  // Always render the split badge directly below the timer to match the
  // mobile preview (StopwatchOverlay.getSplitBadgePixelStyle). The preview
  // positions the OUTER box; drawtext positions the TEXT and paints the box
  // `splitPad` above it, so add splitPad here so the outer box top aligns.
  let splitYExpr: string;
  switch (config.anchor) {
    case "top-left":
    case "top-center":
    case "top-right":
      // Timer top = h*position.y, timer bottom = top + timerH.
      splitYExpr = `(h*${config.position.y}+${timerH + splitGap + splitPad})`;
      break;
    case "center":
      splitYExpr = `(h*${config.position.y}+${Math.round(timerH / 2) + splitGap + splitPad})`;
      break;
    case "bottom-left":
    case "bottom-center":
    case "bottom-right":
    default:
      // Timer bottom = h*position.y. Split sits BELOW the timer.
      splitYExpr = `(h*${config.position.y}+${splitGap + splitPad})`;
      break;
  }

  const filters: string[] = [];

  visible.forEach((s, i) => {
    const startT = (startSignalTime + s.time).toFixed(3);
    const naturalEnd = startSignalTime + s.time + SPLIT_DISPLAY_DURATION_SECONDS;
    const next = visible[i + 1];
    const supersededAt = next ? startSignalTime + next.time : Infinity;
    const summaryAt = summaryStartT ?? Infinity;
    const endT = Math.min(naturalEnd, supersededAt, summaryAt).toFixed(3);

    const enable = `gte(t,${startT})*lt(t,${endT})`;

    const xExpr = buildBoxedPositionX(config, splitPad);

    // Mirror the preview's SplitBadge headline exactly:
    //   "<dist>m: <time>"  and, when a lap time exists, " (lap: <lap>)".
    // (StopwatchOverlay.SplitBadge) — ':' escaped for drawtext.
    const distLabel = Number.isInteger(s.distance) ? String(s.distance) : s.distance.toString();
    let headlineText = `${distLabel}m\\: ${formatTimeForDrawtext(s.time)}`;
    if (s.lapTime !== null) {
      headlineText += ` (lap\\: ${formatTimeForDrawtext(s.lapTime)})`;
    }

    const headlineParts = [
      ...(fontPart ? [fontPart] : []),
      `fontsize=${splitFontSize}`,
      `fontcolor=${config.textColor}`,
      `box=1`,
      `boxcolor=${rgbaToFFmpegColor(config.backgroundColor)}`,
      `boxborderw=${splitPad}`,
      `x=${xExpr}`,
      `y=${splitYExpr}`,
      `text='${headlineText}'`,
    ];
    filters.push(`drawtext=enable='${enable}':${headlineParts.join(":")}`);

    const trimmedMemo = s.memo?.trim();
    if (trimmedMemo) {
      const memoYExpr = appendOffset(splitYExpr, headlineH);
      // Memo content may include Japanese — always use the JP-capable font
      // regardless of the user's `config.fontFamily` preference.
      const memoFontPart = fontfileArg(memoFontPath);
      const memoParts = [
        ...(memoFontPart ? [memoFontPart] : []),
        `fontsize=${splitMemoFontSize}`,
        `fontcolor=${config.textColor}`,
        `box=1`,
        `boxcolor=${rgbaToFFmpegColor(config.backgroundColor)}`,
        `boxborderw=${splitPad}`,
        `x=${xExpr}`,
        `y=${memoYExpr}`,
        `text='${escapeDrawtextText(trimmedMemo)}'`,
      ];
      filters.push(`drawtext=enable='${enable}':${memoParts.join(":")}`);
    }
  });

  return filters;
}

/** Append a positive pixel offset to a `(... +N)` style y-expression. */
function appendOffset(yExpr: string, addPx: number): string {
  if (yExpr.endsWith(")")) {
    return `${yExpr.slice(0, -1)}+${addPx})`;
  }
  return `${yExpr}+${addPx}`;
}

/**
 * Escape user-provided text for FFmpeg `drawtext text=` inside single quotes.
 * Strips characters that have unpredictable meaning in FFmpeg expressions to
 * avoid silent corruption of the filter graph.
 */
export function escapeDrawtextText(s: string): string {
  return s
    .replace(/\\/g, "")
    // The whole filtergraph is passed to ffmpeg-kit wrapped in double quotes, so
    // a `"` in user text closes the argument early and breaks the graph. Strip it.
    .replace(/"/g, "")
    .replace(/'/g, "’")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%");
}

/**
 * Format seconds for a static drawtext label (used for passed splits) so it is
 * byte-identical to the shared formatTime() the preview uses — floor (not
 * round) centiseconds, and seconds are NOT zero-padded under 1 minute:
 *  - < 60s:   S.xx     (e.g. "8.30", not "08.30")
 *  - 1–9min:  M:SS.xx
 *  - >=10min: MM:SS.xx
 * The only difference from formatTime() is that the ':' separator is escaped
 * as '\:' for FFmpeg drawtext.
 */
function formatTimeForDrawtext(seconds: number): string {
  if (seconds < 0) seconds = 0;
  const totalCenti = Math.floor(seconds * 100);
  const cs = totalCenti % 100;
  const totalSecs = Math.floor(seconds);
  const s = totalSecs % 60;
  const m = Math.floor(totalSecs / 60);
  const pad2 = (n: number) => String(n).padStart(2, "0");
  if (m >= 10) return `${pad2(m)}\\:${pad2(s)}.${pad2(cs)}`;
  if (m >= 1) return `${m}\\:${pad2(s)}.${pad2(cs)}`;
  return `${s}.${pad2(cs)}`;
}

/** Resolve the app icon to a local file URI for FFmpeg overlay. */
async function getWatermarkIconUri(): Promise<string | null> {
  try {
    const { Asset } = require("expo-asset") as typeof import("expo-asset");
    const asset = Asset.fromModule(require("../../assets/icon.png"));
    await asset.downloadAsync();
    return asset.localUri ?? null;
  } catch {
    return null;
  }
}

interface ResolvedFonts {
  /** Japanese-capable sans-serif Bold — also covers Latin. Used for memo and
   *  any text that may contain Japanese characters. */
  sansBold: string | null;
  /** Latin-only monospace Bold. Suitable for the timer's digit-only display. */
  monoBold: string | null;
}

/**
 * Resolve the bundled stopwatch fonts to local file URIs. FFmpeg drawtext
 * needs a `fontfile=` path; without it, the output font is platform-default
 * (different from the preview).
 */
async function resolveStopwatchFonts(): Promise<ResolvedFonts> {
  try {
    const { Asset } = require("expo-asset") as typeof import("expo-asset");
    const sansAsset = Asset.fromModule(require("../../assets/fonts/NotoSansJP-Bold.ttf"));
    const monoAsset = Asset.fromModule(require("../../assets/fonts/NotoSansMono-Bold.ttf"));
    await Promise.all([sansAsset.downloadAsync(), monoAsset.downloadAsync()]);
    return {
      sansBold: sansAsset.localUri ?? null,
      monoBold: monoAsset.localUri ?? null,
    };
  } catch {
    return { sansBold: null, monoBold: null };
  }
}

function pickFont(
  fonts: ResolvedFonts,
  family: StopwatchConfig["fontFamily"],
): string | null {
  if (family === "monospace") return fonts.monoBold ?? fonts.sansBold;
  return fonts.sansBold ?? fonts.monoBold;
}

/** Build a `fontfile=...` fragment, or an empty string when no font resolved. */
function fontfileArg(path: string | null): string {
  if (!path) return "";
  // expo-asset returns file:// URIs; FFmpeg's drawtext expects a filesystem
  // path. Strip the scheme.
  const fsPath = path.startsWith("file://") ? path.slice("file://".length) : path;
  return `fontfile=${fsPath}`;
}

/** Watermark font size for a given video height. */
function watermarkFontSize(videoHeight: number): number {
  return Math.max(16, Math.round(videoHeight * 0.06));
}

function buildWatermarkFilter(videoHeight: number, fontPath: string | null): string {
  const fontSize = watermarkFontSize(videoHeight);
  const fontPart = fontfileArg(fontPath);
  const parts = [
    ...(fontPart ? [fontPart] : []),
    `fontsize=${fontSize}`,
    `fontcolor=white@0.30`,
    `x=w-tw-w*0.03`,
    `y=h-th-h*0.03`,
    `text='SwimHub Timer'`,
  ];
  return `drawtext=${parts.join(":")}`;
}

/**
 * Build the filter_complex string and input args for summary PNG overlay.
 * Returns the complete command fragment when a summary image is present.
 *
 * Stream labeling:
 *   [0:v] → video base
 *   [1:v] → icon (if showWatermark && iconUri)
 *   [2:v] → summary PNG (if summaryImageUri)
 *
 * The function returns null when no overlay inputs are needed (falls back to -vf).
 */
function buildFilterComplex(params: {
  drawFilters: string[];
  iconUri: string | null;
  /** Skia-rendered full-frame watermark PNG (alpha baked). Takes precedence
   *  over the legacy FFmpeg icon + drawtext watermark; overlaid persistently. */
  watermarkImageUri: string | null;
  summaryImageUri: string | null;
  summaryStartT: number | null;
  watermarkHeight: number;
  resolution: string;
}): {
  filterComplex: string;
  /** Each entry is a single file path (no -i flag). Caller prepends -i per entry. */
  inputArgs: string[];
  outputLabel: string;
} | null {
  const { drawFilters, iconUri, watermarkImageUri, summaryImageUri, summaryStartT, watermarkHeight, resolution } =
    params;
  const summaryEnableT = summaryStartT !== null ? summaryStartT.toFixed(3) : "0";

  const scalePrefix = resolution !== "original" ? `scale=-2:${resolution},` : "";
  const baseOps = `${scalePrefix}${drawFilters.join(",")}`.replace(/,+$/g, "");
  const baseChain = baseOps.length > 0 ? baseOps : "null";
  // Native-resolution PNGs scaled to the output resolution so overlay=0:0 aligns.
  const overlayScale = resolution !== "original" ? `scale=-2:${resolution}` : "scale=iw:ih";

  const inputArgs: string[] = [];
  const parts: string[] = [`[0:v]${baseChain}[v0]`];
  let cur = "v0";
  let stage = 1;

  // Watermark: prefer the Skia full-frame PNG (pixel-identical to preview);
  // otherwise fall back to the legacy FFmpeg icon overlay (drawtext text is in
  // drawFilters in that case).
  if (watermarkImageUri) {
    inputArgs.push(watermarkImageUri);
    parts.push(`[${inputArgs.length}:v]${overlayScale}[wm]`);
    const out = `v${stage++}`;
    parts.push(`[${cur}][wm]overlay=0:0[${out}]`);
    cur = out;
  } else if (iconUri) {
    inputArgs.push(iconUri);
    const fontSize = watermarkFontSize(watermarkHeight);
    const iconSize = fontSize;
    const gap = Math.round(fontSize * 0.3);
    const textWidthEstimate = Math.round(fontSize * 5.8);
    const iconX = `W-w-${gap}-${textWidthEstimate}-W*0.03`;
    const iconY = "H-h-H*0.03";
    parts.push(`[${inputArgs.length}:v]scale=${iconSize}:${iconSize},format=rgba,colorchannelmixer=aa=0.30[icon]`);
    const out = `v${stage++}`;
    parts.push(`[${cur}][icon]overlay=${iconX}:${iconY}[${out}]`);
    cur = out;
  }

  // Summary PNG (timed) on top.
  if (summaryImageUri) {
    inputArgs.push(summaryImageUri);
    parts.push(`[${inputArgs.length}:v]${overlayScale}[summary]`);
    const out = `v${stage++}`;
    parts.push(`[${cur}][summary]overlay=0:0:enable='gte(t,${summaryEnableT})'[${out}]`);
    cur = out;
  }

  if (inputArgs.length === 0) return null;
  return { filterComplex: parts.join(";"), inputArgs, outputLabel: `[${cur}]` };
}

// ---------------------------------------------------------------------------
// Phase 4: Skia timer PNG-sequence overlay (design doc §4.2 / §5)
// ---------------------------------------------------------------------------

/**
 * A pre-rendered timer overlay as a numbered PNG sequence (from
 * `apps/mobile/lib/overlay/render-offscreen.ts:renderTimerSequence`). When
 * supplied, the FFmpeg `drawtext` timer + split filters are RETIRED and this
 * sequence is overlaid instead — so the exported timer box height matches the
 * preview exactly. The frames are at native video resolution; the graph scales
 * them to the output resolution like the summary PNG.
 */
export interface TimerSequenceInput {
  /** FFmpeg image2 input pattern, e.g. `<dir>/ol_%05d.png`. */
  pattern: string;
  fps: number;
  /** Absolute video time (s) at which frame 0 (elapsed 0) appears. */
  startT: number;
  /** Absolute video time (s) at which the timer hides (summary start / clip end). */
  endT: number;
  /** Native-resolution sub-rectangle the frames cover (overlay offset + size). */
  region: { x: number; y: number; width: number; height: number };
}

interface ExtraInput {
  path: string;
  /** Flags emitted *before* this input's `-i` (e.g. `-framerate N -itsoffset T`). */
  preFlags?: string;
}

interface OverlayGraph {
  filterComplex: string;
  extraInputs: ExtraInput[];
  outputLabel: string;
}

/**
 * Build a chained-overlay filtergraph for the Skia-sequence export path:
 *   [0:v] (scale + watermark text) → overlay timer-seq → overlay icon → overlay summary
 * Each present element adds one input + one overlay stage, so all
 * timer/icon/summary combinations are handled by the same loop.
 */
function buildSeqOverlayGraph(params: {
  /** Filters applied to the base video (watermark drawtext only here). */
  baseDrawFilters: string[];
  seq: TimerSequenceInput;
  iconUri: string | null;
  /** Skia full-frame watermark PNG; takes precedence over the FFmpeg icon. */
  watermarkImageUri: string | null;
  summaryImageUri: string | null;
  summaryStartT: number | null;
  watermarkHeight: number;
  /** Native video height — used to scale the timer-sequence sub-region to output. */
  nativeHeight: number;
  resolution: string;
}): OverlayGraph {
  const {
    baseDrawFilters,
    seq,
    iconUri,
    watermarkImageUri,
    summaryImageUri,
    summaryStartT,
    watermarkHeight,
    nativeHeight,
    resolution,
  } = params;

  const scalePrefix = resolution !== "original" ? `scale=-2:${resolution},` : "";
  const baseOps = `${scalePrefix}${baseDrawFilters.join(",")}`.replace(/,+$/g, "");
  const baseChain = baseOps.length > 0 ? baseOps : "null";
  // Native-resolution PNGs scaled down to the output resolution so overlay=0:0
  // aligns pixel-perfect (mirrors the summary PNG handling).
  const overlayScale = resolution !== "original" ? `scale=-2:${resolution}` : "scale=iw:ih";

  const extraInputs: ExtraInput[] = [];
  const parts: string[] = [`[0:v]${baseChain}[base]`];
  let cur = "base";
  let stage = 1;

  // Timer sequence (input 1). -itsoffset shifts frame 0 to startT; `enable`
  // gates visibility to [startT, endT); eof_action=pass avoids freezing the
  // last frame over the rest of the clip.
  // The frames cover only the timer+split sub-region (seq.region, native px);
  // scale it by the output factor and place it at the region offset so it lands
  // exactly where the full-frame draw would have.
  const seqF = resolution !== "original" ? parseInt(resolution) / nativeHeight : 1;
  const seqW = Math.round(seq.region.width * seqF);
  const seqH = Math.round(seq.region.height * seqF);
  const seqOx = Math.round(seq.region.x * seqF);
  const seqOy = Math.round(seq.region.y * seqF);
  extraInputs.push({
    path: seq.pattern,
    // Frames are 1-indexed (ol_00001.png); pin start_number so the image2
    // demuxer doesn't look for ol_00000.png (its default start is version-
    // dependent), which would desync the -itsoffset alignment by 1 frame.
    preFlags: `-framerate ${seq.fps} -start_number 1 -itsoffset ${seq.startT.toFixed(3)}`,
  });
  parts.push(`[${extraInputs.length}:v]scale=${seqW}:${seqH},format=rgba[seq]`);
  const seqOut = `v${stage++}`;
  parts.push(
    `[${cur}][seq]overlay=${seqOx}:${seqOy}:enable='between(t,${seq.startT.toFixed(3)},${seq.endT.toFixed(3)})':eof_action=pass[${seqOut}]`,
  );
  cur = seqOut;

  if (watermarkImageUri) {
    extraInputs.push({ path: watermarkImageUri });
    parts.push(`[${extraInputs.length}:v]${overlayScale}[wm]`);
    const out = `v${stage++}`;
    parts.push(`[${cur}][wm]overlay=0:0[${out}]`);
    cur = out;
  } else if (iconUri) {
    extraInputs.push({ path: iconUri });
    const fontSize = watermarkFontSize(watermarkHeight);
    const iconSize = fontSize;
    const gap = Math.round(fontSize * 0.3);
    const textWidthEstimate = Math.round(fontSize * 5.8);
    const iconX = `W-w-${gap}-${textWidthEstimate}-W*0.03`;
    const iconY = "H-h-H*0.03";
    parts.push(
      `[${extraInputs.length}:v]scale=${iconSize}:${iconSize},format=rgba,colorchannelmixer=aa=0.30[icon]`,
    );
    const out = `v${stage++}`;
    parts.push(`[${cur}][icon]overlay=${iconX}:${iconY}[${out}]`);
    cur = out;
  }

  if (summaryImageUri) {
    extraInputs.push({ path: summaryImageUri });
    const summaryEnableT = summaryStartT !== null ? summaryStartT.toFixed(3) : "0";
    parts.push(`[${extraInputs.length}:v]${overlayScale}[summary]`);
    const out = `v${stage++}`;
    parts.push(`[${cur}][summary]overlay=0:0:enable='gte(t,${summaryEnableT})'[${out}]`);
    cur = out;
  }

  return { filterComplex: parts.join(";"), extraInputs, outputLabel: `[${cur}]` };
}

/**
 * Export a video with stopwatch overlay using native FFmpeg.
 */
export async function exportVideoWithStopwatch(
  videoUri: string,
  startSignalTime: number,
  stopwatchConfig: StopwatchConfig,
  isFinished: boolean,
  finishTime: number | null,
  originalVideoHeight: number,
  exportSettings: ExportSettings,
  onProgress: (percent: number) => void,
  showWatermark = true,
  summaryImageUri: string | null = null,
  splitTimes: SplitTime[] = [],
  raceDistance: number | null = null,
  videoDurationSec = 0,
  timerSequence: TimerSequenceInput | null = null,
  watermarkImageUri: string | null = null,
): Promise<string> {
  const { Paths, File } = require("expo-file-system") as typeof import("expo-file-system");
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const outputFile = new File(Paths.cache, `swimhub-timer_${timestamp}.mp4`);
  const outputPath = outputFile.uri;

  let scaledConfig = stopwatchConfig;
  if (exportSettings.resolution !== "original" && originalVideoHeight > 0) {
    const outputHeight = parseInt(exportSettings.resolution);
    const resScale = outputHeight / originalVideoHeight;
    scaledConfig = {
      ...stopwatchConfig,
      fontSize: Math.round(stopwatchConfig.fontSize * resScale),
      padding: Math.round(stopwatchConfig.padding * resScale),
      borderRadius: Math.round(stopwatchConfig.borderRadius * resScale),
    };
  }

  const watermarkHeight =
    exportSettings.resolution !== "original"
      ? parseInt(exportSettings.resolution)
      : originalVideoHeight;

  const { FFmpegKit, FFmpegKitConfig, ReturnCode } = getFFmpeg();

  FFmpegKitConfig.enableStatisticsCallback((statistics: { getTime: () => number }) => {
    const time = statistics.getTime();
    if (time > 0) {
      onProgress(time);
    }
  });

  // When a Skia watermark PNG is supplied it carries the icon + text, so the
  // legacy FFmpeg icon overlay and drawtext watermark are not used.
  const useSkiaWatermark = watermarkImageUri !== null;
  const iconUri = showWatermark && !useSkiaWatermark ? await getWatermarkIconUri() : null;
  const crf = exportSettings.resolution === "original" ? "18" : "23";

  const audioCodec = await detectAudioCodec(videoUri);
  const audioArgs = buildAudioArgs(audioCodec);

  const hwEncoder = getHwEncoder();
  const videoArgs = buildVideoEncoderArgs(hwEncoder, exportSettings.resolution, crf);

  const fonts = await resolveStopwatchFonts();
  const timerFont = pickFont(fonts, scaledConfig.fontFamily);

  // Single transition time shared by the stopwatch, split and summary filters
  // so they all switch over in lockstep — and clamped to the clip length so a
  // recording stopped right after the finish still shows the summary.
  const summaryStartT = isFinished
    ? computeSummaryStartT(startSignalTime, finishTime, videoDurationSec)
    : null;

  // filter_complex handles the scale via scalePrefix inside buildFilterComplex ([0:v] stream).
  // Pass plain draw filters (stopwatch + watermark) without a leading scale here.
  // When a Skia timer sequence is supplied (Phase 4), the stopwatch + split
  // drawtext filters are retired — they're baked into the PNG sequence instead.
  const drawFiltersForFC = [
    ...(timerSequence
      ? []
      : buildStopwatchFilters(startSignalTime, scaledConfig, isFinished, finishTime, timerFont, summaryStartT)),
    ...(timerSequence
      ? []
      : buildPassedSplitFilters(
          startSignalTime,
          scaledConfig,
          finishTime,
          splitTimes,
          raceDistance,
          timerFont,
          fonts.sansBold,
          summaryStartT,
        )),
    ...(showWatermark && !useSkiaWatermark ? [buildWatermarkFilter(watermarkHeight, fonts.sansBold)] : []),
  ];

  // Resolve the overlay filtergraph. The Skia-sequence path uses a chained
  // overlay graph; the default path uses the existing drawtext-based graph.
  let graph: OverlayGraph | null;
  if (timerSequence) {
    graph = buildSeqOverlayGraph({
      baseDrawFilters: drawFiltersForFC,
      seq: timerSequence,
      iconUri,
      watermarkImageUri,
      summaryImageUri,
      summaryStartT,
      watermarkHeight,
      nativeHeight: originalVideoHeight,
      resolution: exportSettings.resolution,
    });
  } else {
    const fcResult = buildFilterComplex({
      drawFilters: drawFiltersForFC,
      iconUri,
      watermarkImageUri,
      summaryImageUri,
      summaryStartT,
      watermarkHeight,
      resolution: exportSettings.resolution,
    });
    graph = fcResult
      ? {
          filterComplex: fcResult.filterComplex,
          extraInputs: fcResult.inputArgs.map((path) => ({ path })),
          outputLabel: fcResult.outputLabel,
        }
      : null;
  }

  function buildCommand(decodeArgs: string, vArgs: string, aArgs: string): string {
    const decodePrefix = decodeArgs ? `${decodeArgs} ` : "";
    // -ignore_unknown lets FFmpeg skip streams whose codec it can't parse
    //   (e.g. Apple's spatial-audio `apac` codec on iPhone 16 captures).
    // -map 0:a:0? maps only the FIRST audio stream from input 0 — the
    //   compatibility AAC track — so we never touch the spatial-audio track
    //   that ffmpeg-kit doesn't have a decoder for.
    const ignoreUnknown = "-ignore_unknown";
    const audioMap = "-map 0:a:0?";
    if (graph) {
      const inputPart = graph.extraInputs
        // Strip the file:// scheme: the image2 demuxer (timer-sequence pattern)
        // can't resolve a file:// URI, and FFmpeg's file protocol accepts a
        // plain filesystem path for the single-image inputs too.
        .map((e) => {
          const p = e.path.startsWith("file://") ? e.path.slice("file://".length) : e.path;
          return `${e.preFlags ? `${e.preFlags} ` : ""}-i "${p}"`;
        })
        .join(" ");
      return `-y ${ignoreUnknown} ${decodePrefix}-i "${videoUri}" ${inputPart} -filter_complex "${graph.filterComplex}" -map "${graph.outputLabel}" ${audioMap} ${vArgs} ${aArgs} -movflags +faststart "${outputPath}"`;
    }
    // No overlay inputs — use simple -vf
    const scaleFilter = exportSettings.resolution !== "original" ? `scale=-2:${exportSettings.resolution},` : "";
    const filterChain = `${scaleFilter}${drawFiltersForFC.join(",")}`;
    return `-y ${ignoreUnknown} ${decodePrefix}-i "${videoUri}" -vf "${filterChain}" ${audioMap} ${vArgs} ${aArgs} -movflags +faststart "${outputPath}"`;
  }

  const decodeArgs = buildHwDecodeArgs(hwEncoder !== null);
  const command = buildCommand(decodeArgs, videoArgs, audioArgs);
  const session = await FFmpegKit.execute(command);
  const returnCode = await session.getReturnCode();

  // HW → SW fallback: retry with libx264 only on encoder/decoder-related errors.
  if (!ReturnCode.isSuccess(returnCode) && hwEncoder !== null) {
    const logs = await session.getLogsAsString();
    const encoderName = hwEncoder; // "h264_videotoolbox" | "h264_mediacodec"
    const hwBaseName = encoderName.replace(/^h264_/, ""); // "videotoolbox" | "mediacodec"
    const isHwError = new RegExp(
      [
        // Encoder failures
        `Unknown encoder '${encoderName}'`,
        `Encoder ${encoderName} not found`,
        `Cannot load ${encoderName}`,
        `Error initializing the ${encoderName}`,
        // HW decode/encode runtime errors (anchor on error verbs after the log prefix)
        `\\[${hwBaseName} @[^\\]]*\\][^\\n]*(failed|error|cannot|unsupported|invalid)`,
        // Hwaccel initialization/transfer failures (specific phrases only)
        `Failed setup for format ${hwBaseName}`,
        `Failed to initialise hwaccel`,
        `Failed to initialize hwaccel`,
        `hwaccel.*(failed|not found|init failed|transfer.*failed)`,
      ].join("|"),
      "i"
    ).test(logs);
    if (isHwError) {
      onProgress(0);
      const fallbackVideoArgs = buildVideoEncoderArgs(null, exportSettings.resolution, crf);
      const fallbackCommand = buildCommand("", fallbackVideoArgs, audioArgs);
      const fallbackSession = await FFmpegKit.execute(fallbackCommand);
      const fallbackRc = await fallbackSession.getReturnCode();
      if (!ReturnCode.isSuccess(fallbackRc)) {
        throw new Error(`FFmpeg export failed (fallback): ${await fallbackSession.getLogsAsString()}`);
      }
      return outputPath;
    }
    throw new Error(`FFmpeg export failed: ${logs}`);
  }

  if (!ReturnCode.isSuccess(returnCode)) {
    throw new Error(`FFmpeg export failed: ${await session.getLogsAsString()}`);
  }

  return outputPath;
}

/**
 * Save the exported video to the device's photo library.
 */
export async function saveToPhotoLibrary(filePath: string): Promise<void> {
  const MediaLibrary = require("expo-media-library") as typeof import("expo-media-library");
  const { status } = await MediaLibrary.requestPermissionsAsync();
  if (status !== "granted") {
    throw new Error("フォトライブラリへのアクセスが許可されていません");
  }

  await MediaLibrary.saveToLibraryAsync(filePath);
}

/**
 * Clean up temporary export files.
 * Accepts both the encoded output path and the intermediate summary PNG path.
 */
export async function cleanupExportFiles(
  outputPath?: string | null,
  summaryImageUri?: string | null,
): Promise<void> {
  const { File } = require("expo-file-system") as typeof import("expo-file-system");
  for (const uri of [outputPath, summaryImageUri]) {
    if (!uri) continue;
    try {
      new File(uri).delete();
    } catch {
      // Ignore cleanup errors
    }
  }
}
