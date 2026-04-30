import type { StopwatchConfig, ExportSettings, SplitTime } from "@swimhub-timer/shared";

const SUMMARY_DELAY_SECONDS = 2;
const SPLIT_DISPLAY_DURATION_SECONDS = 3;

function getFFmpeg() {
  try {
    return require("ffmpeg-kit-react-native");
  } catch {
    throw new Error("FFmpeg is not available. Please use a development build.");
  }
}

function rgbaToFFmpegColor(rgba: string): string {
  if (rgba.startsWith("rgba")) {
    const match = rgba.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
    if (match) {
      const r = parseInt(match[1]).toString(16).padStart(2, "0");
      const g = parseInt(match[2]).toString(16).padStart(2, "0");
      const b = parseInt(match[3]).toString(16).padStart(2, "0");
      return `#${r}${g}${b}@${parseFloat(match[4]).toFixed(2)}`;
    }
  }
  return rgba;
}

function buildPositionX(config: StopwatchConfig): string {
  const base = `(w*${config.position.x})`;
  switch (config.anchor) {
    case "top-center":
    case "bottom-center":
    case "center":
      return `${base}-tw/2`;
    case "top-right":
    case "bottom-right":
      return `${base}-tw`;
    default:
      return base;
  }
}

function buildPositionY(config: StopwatchConfig): string {
  const base = `(h*${config.position.y})`;
  switch (config.anchor) {
    case "bottom-left":
    case "bottom-center":
    case "bottom-right":
      return `${base}-th`;
    case "center":
      return `${base}-th/2`;
    default:
      return base;
  }
}

/**
 * Build drawtext filters for the main stopwatch timer.
 * Uses separate filters to match formatTime() output:
 *  - < 60s:   SS.xx
 *  - >= 60s:  M:SS.xx
 */
function buildStopwatchFilters(
  startSignalTime: number,
  config: StopwatchConfig,
  isFinished: boolean,
  finishTime: number | null,
): string[] {
  const startT = startSignalTime.toFixed(3);

  const rawText = `max(0\\, t-${startT})`;
  const elapsedText =
    isFinished && finishTime !== null ? `min(${finishTime.toFixed(3)}\\, ${rawText})` : rawText;

  const rawEnable = `max(0, t-${startT})`;
  const elapsedEnable =
    isFinished && finishTime !== null ? `min(${finishTime.toFixed(3)}, ${rawEnable})` : rawEnable;

  // When finished, hide the timer once the summary takes over (finishTime + SUMMARY_DELAY).
  const timerCutoffGuard =
    isFinished && finishTime !== null
      ? `*lt(t, ${(startSignalTime + finishTime + SUMMARY_DELAY_SECONDS).toFixed(3)})`
      : "";

  const minutes = `trunc(${elapsedText}/60)`;
  const seconds = `trunc(mod(${elapsedText}\\,60))`;
  const centis = `trunc(mod(${elapsedText}*100\\,100))`;

  const xExpr = buildPositionX(config);
  const yExpr = buildPositionY(config);

  const baseParts = [
    `fontsize=${config.fontSize}`,
    `fontcolor=${config.textColor}`,
    `box=1`,
    `boxcolor=${rgbaToFFmpegColor(config.backgroundColor)}`,
    `boxborderw=${config.padding}`,
    `x=${xExpr}`,
    `y=${yExpr}`,
  ];

  const textUnder60 = `%{eif\\:${seconds}\\:d\\:2}.%{eif\\:${centis}\\:d\\:2}`;
  const textOver60 = `%{eif\\:${minutes}\\:d}\\:%{eif\\:${seconds}\\:d\\:2}.%{eif\\:${centis}\\:d\\:2}`;

  return [
    `drawtext=enable='lt(${elapsedEnable}, 60)${timerCutoffGuard}':${baseParts.join(":")}:text='${textUnder60}'`,
    `drawtext=enable='gte(${elapsedEnable}, 60)${timerCutoffGuard}':${baseParts.join(":")}:text='${textOver60}'`,
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
  const splitPad = Math.max(3, Math.round(config.padding * 0.6));
  const splitGap = Math.max(2, Math.round(config.padding * 0.3));
  const splitH = splitFontSize + 2 * splitPad;
  const timerH = config.fontSize + 2 * config.padding;

  // The split sits below the timer for top/center anchors and above the
  // timer for bottom anchors — matches renderSplitDisplay() on the web.
  let splitYExpr: string;
  switch (config.anchor) {
    case "top-left":
    case "top-center":
    case "top-right":
      splitYExpr = `(h*${config.position.y}+${timerH + splitGap})`;
      break;
    case "center":
      splitYExpr = `(h*${config.position.y}+${Math.round(timerH / 2) + splitGap})`;
      break;
    case "bottom-left":
    case "bottom-center":
    case "bottom-right":
    default:
      // Timer's top = (h*position.y) - timerH. Split sits ABOVE the timer.
      splitYExpr = `(h*${config.position.y}-${timerH + splitGap + splitH})`;
      break;
  }

  return visible.map((s, i) => {
    const startT = (startSignalTime + s.time).toFixed(3);
    const naturalEnd = startSignalTime + s.time + SPLIT_DISPLAY_DURATION_SECONDS;
    const next = visible[i + 1];
    // Truncate the window when the next split lands so the latest split wins,
    // matching the web's "loop backwards and pick the most recent" behavior.
    const supersededAt = next ? startSignalTime + next.time : Infinity;
    const summaryAt = finishTime !== null
      ? startSignalTime + finishTime + SUMMARY_DELAY_SECONDS
      : Infinity;
    const endT = Math.min(naturalEnd, supersededAt, summaryAt).toFixed(3);

    const enable = `gte(t,${startT})*lt(t,${endT})`;

    const xExpr = buildPositionX(config);

    const distLabel = Number.isInteger(s.distance) ? String(s.distance) : s.distance.toString();
    const text = `${distLabel}m\\: ${formatSecondsForDrawtext(s.time)}`;

    const parts = [
      `fontsize=${splitFontSize}`,
      `fontcolor=${config.textColor}`,
      `box=1`,
      `boxcolor=${rgbaToFFmpegColor(config.backgroundColor)}`,
      `boxborderw=${splitPad}`,
      `x=${xExpr}`,
      `y=${splitYExpr}`,
      `text='${text}'`,
    ];
    return `drawtext=enable='${enable}':${parts.join(":")}`;
  });
}

/**
 * Format seconds for a static drawtext label (used for passed splits).
 * Matches formatTime():
 *  - < 60s:   SS.xx
 *  - >= 60s:  M:SS.xx
 * Note: the FFmpeg ':' separator inside text needs escaping with '\:'.
 */
function formatSecondsForDrawtext(seconds: number): string {
  const totalCenti = Math.round(seconds * 100);
  const totalSecs = Math.floor(totalCenti / 100);
  const cs = totalCenti % 100;
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  const cs2 = String(cs).padStart(2, "0");
  const s2 = String(s).padStart(2, "0");
  if (m === 0) return `${s2}.${cs2}`;
  return `${m}\\:${s2}.${cs2}`;
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

/** Watermark font size for a given video height. */
function watermarkFontSize(videoHeight: number): number {
  return Math.max(16, Math.round(videoHeight * 0.06));
}

function buildWatermarkFilter(videoHeight: number): string {
  const fontSize = watermarkFontSize(videoHeight);
  const parts = [
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
  summaryImageUri: string | null;
  startSignalTime: number;
  finishTime: number | null;
  watermarkHeight: number;
  resolution: string;
}): {
  filterComplex: string;
  /** Each entry is a single file path (no -i flag). Caller prepends -i per entry. */
  inputArgs: string[];
  outputLabel: string;
} | null {
  const { drawFilters, iconUri, summaryImageUri, startSignalTime, finishTime, watermarkHeight, resolution } = params;

  const hasIcon = iconUri !== null;
  const hasSummary = summaryImageUri !== null;

  if (!hasIcon && !hasSummary) return null;

  const scalePrefix = resolution !== "original" ? `scale=-2:${resolution},` : "";
  const baseFilters = `${scalePrefix}${drawFilters.join(",")}`;

  if (hasIcon && hasSummary) {
    // 3-input: video + icon + summary
    // [0:v]drawtext...[bg]; [1:v]scale..[icon]; [bg][icon]overlay[tmp]; [2:v]scale..[summary]; [tmp][summary]overlay=enable=...[v]
    const fontSize = watermarkFontSize(watermarkHeight);
    const iconSize = fontSize;
    const gap = Math.round(fontSize * 0.3);
    const textWidthEstimate = Math.round(fontSize * 5.8);
    const iconX = `W-w-${gap}-${textWidthEstimate}-W*0.03`;
    const iconY = `H-h-H*0.03`;

    const summaryEnableT =
      finishTime !== null ? (startSignalTime + finishTime + SUMMARY_DELAY_SECONDS).toFixed(3) : "0";
    const summaryEnable = `enable='gte(t,${summaryEnableT})'`;

    // PNG is captured at videoWidth × videoHeight (native video size).
    // Scale it down to match the output resolution so overlay=0:0 aligns pixel-perfect.
    const summaryScale = resolution !== "original" ? `scale=-2:${resolution}` : `scale=iw:ih`;

    const fc = [
      `[0:v]${baseFilters}[bg]`,
      `[1:v]scale=${iconSize}:${iconSize},format=rgba,colorchannelmixer=aa=0.30[icon]`,
      `[bg][icon]overlay=${iconX}:${iconY}[tmp]`,
      `[2:v]${summaryScale}[summary]`,
      `[tmp][summary]overlay=0:0:${summaryEnable}[v]`,
    ].join(";");

    return {
      filterComplex: fc,
      // hasSummary && hasIcon are confirmed non-null above (guarded by hasIcon/hasSummary checks)
      inputArgs: [iconUri!, summaryImageUri!],
      outputLabel: "[v]",
    };
  }

  if (hasIcon && !hasSummary) {
    // 2-input: video + icon
    const fontSize = watermarkFontSize(watermarkHeight);
    const iconSize = fontSize;
    const gap = Math.round(fontSize * 0.3);
    const textWidthEstimate = Math.round(fontSize * 5.8);
    const iconX = `W-w-${gap}-${textWidthEstimate}-W*0.03`;
    const iconY = `H-h-H*0.03`;

    const fc = [
      `[0:v]${baseFilters}[bg]`,
      `[1:v]scale=${iconSize}:${iconSize},format=rgba,colorchannelmixer=aa=0.30[icon]`,
      `[bg][icon]overlay=${iconX}:${iconY}[v]`,
    ].join(";");

    return {
      filterComplex: fc,
      // hasIcon confirmed non-null above
      inputArgs: [iconUri!],
      outputLabel: "[v]",
    };
  }

  // hasSummary && !hasIcon
  const summaryEnableT = finishTime !== null ? (startSignalTime + finishTime).toFixed(3) : "0";
  const summaryEnable = `enable='gte(t,${summaryEnableT})'`;
  // PNG is captured at videoWidth × videoHeight (native video size).
  // Scale it down to match the output resolution so overlay=0:0 aligns pixel-perfect.
  const summaryScaleOnly = resolution !== "original" ? `scale=-2:${resolution}` : `scale=iw:ih`;

  const fc = [
    `[0:v]${baseFilters}[bg]`,
    `[1:v]${summaryScaleOnly}[summary]`,
    `[bg][summary]overlay=0:0:${summaryEnable}[v]`,
  ].join(";");

  return {
    filterComplex: fc,
    // hasSummary confirmed non-null above
    inputArgs: [summaryImageUri!],
    outputLabel: "[v]",
  };
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

  const iconUri = showWatermark ? await getWatermarkIconUri() : null;
  const crf = exportSettings.resolution === "original" ? "18" : "23";

  // filter_complex handles the scale via scalePrefix inside buildFilterComplex ([0:v] stream).
  // Pass plain draw filters (stopwatch + watermark) without a leading scale here.
  const drawFiltersForFC = [
    ...buildStopwatchFilters(startSignalTime, scaledConfig, isFinished, finishTime),
    ...buildPassedSplitFilters(startSignalTime, scaledConfig, finishTime, splitTimes, raceDistance),
    ...(showWatermark ? [buildWatermarkFilter(watermarkHeight)] : []),
  ];

  const fcResult = buildFilterComplex({
    drawFilters: drawFiltersForFC,
    iconUri,
    summaryImageUri,
    startSignalTime,
    finishTime,
    watermarkHeight,
    resolution: exportSettings.resolution,
  });

  let command: string;

  if (fcResult) {
    const inputPart = fcResult.inputArgs.map((p) => `-i "${p}"`).join(" ");
    command = `-y -i "${videoUri}" ${inputPart} -filter_complex "${fcResult.filterComplex}" -map "${fcResult.outputLabel}" -map 0:a? -c:v libx264 -preset medium -crf ${crf} -c:a aac -b:a 128k -movflags +faststart "${outputPath}"`;
  } else {
    // No overlay inputs — use simple -vf
    const scaleFilter = exportSettings.resolution !== "original" ? `scale=-2:${exportSettings.resolution},` : "";
    const vfFilters = [
      ...buildStopwatchFilters(startSignalTime, scaledConfig, isFinished, finishTime),
      ...buildPassedSplitFilters(startSignalTime, scaledConfig, finishTime, splitTimes, raceDistance),
      ...(showWatermark ? [buildWatermarkFilter(watermarkHeight)] : []),
    ];
    const filterChain = `${scaleFilter}${vfFilters.join(",")}`;
    command = `-y -i "${videoUri}" -vf "${filterChain}" -c:v libx264 -preset medium -crf ${crf} -c:a aac -b:a 128k -movflags +faststart "${outputPath}"`;
  }

  const session = await FFmpegKit.execute(command);
  const returnCode = await session.getReturnCode();

  if (!ReturnCode.isSuccess(returnCode)) {
    const logs = await session.getLogsAsString();
    throw new Error(`FFmpeg export failed: ${logs}`);
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
