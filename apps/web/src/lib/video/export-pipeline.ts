import type { StopwatchConfig, ExportSettings } from "@swimhub-timer/shared";
import { ffmpegManager, fetchFile } from "./ffmpeg-manager";
import { SUMMARY_DELAY_SECONDS } from "@/lib/stopwatch/renderer";

// Font file written to FFmpeg's virtual filesystem; must match the path used in writeFile()
const FONT_PATH = "/tmp/stopwatch.ttf";

function buildDrawtextFilter(startSignalTime: number, config: StopwatchConfig): string {
  const startT = startSignalTime.toFixed(3);

  // Elapsed time calculation: show 0:00.00 before start, count up after
  const elapsed = `max(0\\, t-${startT})`;
  const minutes = `trunc(${elapsed}/60)`;
  const seconds = `trunc(mod(${elapsed}\\,60))`;
  const centis = `trunc(mod(${elapsed}*100\\,100))`;

  // Auto format: SS.xx under 1min, M:SS.xx under 10min, MM:SS.xx otherwise
  // FFmpeg drawtext doesn't support conditional formatting easily,
  // so use M:SS.xx which covers all cases cleanly
  const textExpr = `%{eif\\:${minutes}\\:d}\\:%{eif\\:${seconds}\\:d\\:2}.%{eif\\:${centis}\\:d\\:2}`;

  // Position as proportional expression
  const xExpr = buildPositionX(config);
  const yExpr = buildPositionY(config);

  const parts = [
    `fontfile=${FONT_PATH}`,
    `fontsize=${config.fontSize}`,
    `fontcolor=${config.textColor}`,
    `box=1`,
    `boxcolor=${rgbaToFFmpegColor(config.backgroundColor)}`,
    `boxborderw=${config.padding}`,
    `x=${xExpr}`,
    `y=${yExpr}`,
    `text='${textExpr}'`,
  ];

  return `drawtext=${parts.join(":")}`;
}

function buildPositionX(config: StopwatchConfig): string {
  const base = `(w*${config.position.x})`;
  switch (config.anchor) {
    case "top-center":
    case "bottom-center":
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
    default:
      return base;
  }
}

function rgbaToFFmpegColor(rgba: string): string {
  // Convert "rgba(r,g,b,a)" or hex with alpha to ffmpeg-compatible color
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

/** Watermark font size for a given video height. */
function watermarkFontSize(videoHeight: number): number {
  return Math.max(16, Math.round(videoHeight * 0.04));
}

/**
 * Build a drawtext filter for the "SwimHub Timer" watermark text in the bottom-right corner.
 */
function buildWatermarkFilter(videoHeight: number): string {
  const fontSize = watermarkFontSize(videoHeight);
  const parts = [
    `fontfile=${FONT_PATH}`,
    `fontsize=${fontSize}`,
    `fontcolor=white@0.30`,
    `x=w-tw-w*0.03`,
    `y=h-th-h*0.03`,
    `text='SwimHub Timer'`,
  ];
  return `drawtext=${parts.join(":")}`;
}

export async function exportVideoWithStopwatch(
  videoFile: File,
  startSignalTime: number,
  stopwatchConfig: StopwatchConfig,
  originalVideoHeight: number,
  exportSettings: ExportSettings,
  onProgress: (percent: number) => void,
  showWatermark = true,
  summaryImageData: Blob | null = null,
  finishTime: number | null = null,
): Promise<Blob> {
  const ffmpeg = await ffmpegManager.load(onProgress);

  // Load font for drawtext filter (required by FFmpeg 5+ @ffmpeg/core)
  const fontResp = await fetch("/fonts/stopwatch.ttf");
  if (!fontResp.ok) {
    throw new Error(`Failed to load stopwatch font: ${fontResp.status}`);
  }
  const fontData = new Uint8Array(await fontResp.arrayBuffer());
  await ffmpeg.writeFile(FONT_PATH, fontData);

  // Write input video to virtual filesystem
  await ffmpeg.writeFile("input.mp4", await fetchFile(videoFile));

  // Scale font/padding when exporting at different resolution
  // so the stopwatch maintains the same proportional size as the preview
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

  // Build filter chain
  const filters: string[] = [];

  // Scale if not original
  if (exportSettings.resolution !== "original") {
    filters.push(`scale=-2:${exportSettings.resolution}`);
  }

  // Add stopwatch drawtext
  filters.push(buildDrawtextFilter(startSignalTime, scaledConfig));

  // Watermark: use output height (after scale) for font sizing
  const watermarkHeight =
    exportSettings.resolution !== "original"
      ? parseInt(exportSettings.resolution)
      : originalVideoHeight || 1080;
  if (showWatermark) {
    filters.push(buildWatermarkFilter(watermarkHeight));
  }

  const filterChain = filters.join(",");

  // Use lower CRF for original resolution to preserve quality
  const crf = exportSettings.resolution === "original" ? "23" : "28";

  // Write summary PNG to virtual FS if present
  let hasSummary = false;
  if (summaryImageData !== null && finishTime !== null) {
    const summaryBuffer = await summaryImageData.arrayBuffer();
    await ffmpeg.writeFile("summary.png", new Uint8Array(summaryBuffer));
    hasSummary = true;
  }

  // Try to load watermark icon (only when watermark is enabled)
  let hasIcon = false;
  if (showWatermark) {
    try {
      const iconResp = await fetch("/apple-touch-icon.png");
      if (iconResp.ok) {
        const iconData = new Uint8Array(await iconResp.arrayBuffer());
        await ffmpeg.writeFile("icon.png", iconData);
        hasIcon = true;
      }
    } catch {
      // Fall back to text-only watermark
    }
  }

  const baseArgs = ["-c:v", "libx264", "-preset", "ultrafast", "-crf", crf, "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "output.mp4"];

  // Execute ffmpeg
  if (hasIcon && hasSummary && finishTime !== null) {
    const fontSize = watermarkFontSize(watermarkHeight);
    const iconSize = fontSize;
    const gap = Math.round(fontSize * 0.3);
    const textWidthEstimate = Math.round(fontSize * 5.8);
    const iconX = `W-w-${gap}-${textWidthEstimate}-W*0.03`;
    const iconY = `H-h-H*0.03`;
    const summaryEnableT = (startSignalTime + finishTime + SUMMARY_DELAY_SECONDS).toFixed(3);
    const summaryScale = exportSettings.resolution !== "original" ? `scale=-2:${exportSettings.resolution}` : `scale=iw:ih`;

    await ffmpeg.exec([
      "-i", "input.mp4",
      "-i", "icon.png",
      "-i", "summary.png",
      "-filter_complex",
      `[0:v]${filterChain}[bg];[1:v]scale=${iconSize}:${iconSize},format=rgba,colorchannelmixer=aa=0.30[icon];[bg][icon]overlay=${iconX}:${iconY}[tmp];[2:v]${summaryScale}[sum];[tmp][sum]overlay=0:0:enable='gte(t,${summaryEnableT})'[v]`,
      "-map", "[v]",
      "-map", "0:a",
      ...baseArgs,
    ]);
  } else if (hasIcon) {
    const fontSize = watermarkFontSize(watermarkHeight);
    const iconSize = fontSize;
    const gap = Math.round(fontSize * 0.3);
    const textWidthEstimate = Math.round(fontSize * 5.8);
    const iconX = `W-w-${gap}-${textWidthEstimate}-W*0.03`;
    const iconY = `H-h-H*0.03`;

    await ffmpeg.exec([
      "-i", "input.mp4",
      "-i", "icon.png",
      "-filter_complex",
      `[0:v]${filterChain}[bg];[1:v]scale=${iconSize}:${iconSize},format=rgba,colorchannelmixer=aa=0.30[icon];[bg][icon]overlay=${iconX}:${iconY}[v]`,
      "-map", "[v]",
      "-map", "0:a",
      ...baseArgs,
    ]);
  } else if (hasSummary && finishTime !== null) {
    const summaryEnableT = (startSignalTime + finishTime + SUMMARY_DELAY_SECONDS).toFixed(3);
    const summaryScale = exportSettings.resolution !== "original" ? `scale=-2:${exportSettings.resolution}` : `scale=iw:ih`;

    await ffmpeg.exec([
      "-i", "input.mp4",
      "-i", "summary.png",
      "-filter_complex",
      `[0:v]${filterChain}[bg];[1:v]${summaryScale}[sum];[bg][sum]overlay=0:0:enable='gte(t,${summaryEnableT})'[v]`,
      "-map", "[v]",
      "-map", "0:a",
      ...baseArgs,
    ]);
  } else {
    await ffmpeg.exec([
      "-i", "input.mp4",
      "-vf", filterChain,
      ...baseArgs,
    ]);
  }

  // Read output
  const outputData = await ffmpeg.readFile("output.mp4");
  return new Blob([new Uint8Array(outputData as Uint8Array)], { type: "video/mp4" });
}
