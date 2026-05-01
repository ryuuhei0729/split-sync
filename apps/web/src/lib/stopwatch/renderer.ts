import type { StopwatchConfig, SplitTime } from "@swimhub-timer/shared";
import { formatTime, calculateRaceLapTimesTable, getVisibleLapIntervals } from "@swimhub-timer/shared";

export const SUMMARY_DELAY_SECONDS = 2;

/**
 * Measure the maximum digit width for the current ctx.font,
 * then draw/measure text with all digits at equal (max) width.
 */
function getDigitWidth(ctx: CanvasRenderingContext2D): number {
  let max = 0;
  for (let d = 0; d <= 9; d++) {
    const w = ctx.measureText(String(d)).width;
    if (w > max) max = w;
  }
  return max;
}

function measureTextTabular(ctx: CanvasRenderingContext2D, text: string): number {
  const dw = getDigitWidth(ctx);
  let total = 0;
  for (const ch of text) {
    total += ch >= "0" && ch <= "9" ? dw : ctx.measureText(ch).width;
  }
  return total;
}

function fillTextTabular(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  const dw = getDigitWidth(ctx);
  let cx = x;
  for (const ch of text) {
    if (ch >= "0" && ch <= "9") {
      const charW = ctx.measureText(ch).width;
      ctx.fillText(ch, cx + (dw - charW) / 2, y);
      cx += dw;
    } else {
      ctx.fillText(ch, cx, y);
      cx += ctx.measureText(ch).width;
    }
  }
}

function calculatePosition(
  config: StopwatchConfig,
  boxWidth: number,
  boxHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number } {
  const px = config.position.x * canvasWidth;
  const py = config.position.y * canvasHeight;

  let x = px;
  let y = py;

  switch (config.anchor) {
    case "top-left":
      break;
    case "top-center":
      x = px - boxWidth / 2;
      break;
    case "top-right":
      x = px - boxWidth;
      break;
    case "center":
      x = px - boxWidth / 2;
      y = py - boxHeight / 2;
      break;
    case "bottom-left":
      y = py - boxHeight;
      break;
    case "bottom-center":
      x = px - boxWidth / 2;
      y = py - boxHeight;
      break;
    case "bottom-right":
      x = px - boxWidth;
      y = py - boxHeight;
      break;
  }

  return { x, y };
}

export function renderStopwatch(
  ctx: CanvasRenderingContext2D,
  config: StopwatchConfig,
  elapsedSeconds: number,
): void {
  const timeText = formatTime(elapsedSeconds);

  ctx.font = `bold ${config.fontSize}px ${config.fontFamily}`;
  ctx.textBaseline = "top";

  const textWidth = measureTextTabular(ctx, timeText);
  const textHeight = config.fontSize;

  const boxWidth = textWidth + config.padding * 2;
  const boxHeight = textHeight + config.padding * 2;

  const { x, y } = calculatePosition(
    config,
    boxWidth,
    boxHeight,
    ctx.canvas.width,
    ctx.canvas.height,
  );

  // Background
  ctx.fillStyle = config.backgroundColor;
  ctx.beginPath();
  const r = config.borderRadius;
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + boxWidth - r, y);
  ctx.quadraticCurveTo(x + boxWidth, y, x + boxWidth, y + r);
  ctx.lineTo(x + boxWidth, y + boxHeight - r);
  ctx.quadraticCurveTo(x + boxWidth, y + boxHeight, x + boxWidth - r, y + boxHeight);
  ctx.lineTo(x + r, y + boxHeight);
  ctx.quadraticCurveTo(x, y + boxHeight, x, y + boxHeight - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();

  // Text
  ctx.fillStyle = config.textColor;
  fillTextTabular(ctx, timeText, x + config.padding, y + config.padding);
}

function formatSplitText(split: SplitTime): string {
  const timeStr = formatTime(split.time);
  if (split.lapTime !== null) {
    const lapStr = formatTime(split.lapTime);
    return `${split.distance}m: ${timeStr} (lap: ${lapStr})`;
  }
  return `${split.distance}m: ${timeStr}`;
}

export function renderSplitDisplay(
  ctx: CanvasRenderingContext2D,
  config: StopwatchConfig,
  elapsedSeconds: number,
  latestSplit: SplitTime,
): void {
  const splitText = formatSplitText(latestSplit);
  const splitFontSize = Math.round(config.fontSize * 0.55);
  const memoFontSize = Math.round(config.fontSize * 0.38);
  const splitPadding = Math.round(config.padding * 0.6);
  const hasMemo = latestSplit.memo.length > 0;
  const memoGap = Math.round(splitFontSize * 0.25);

  ctx.font = `bold ${splitFontSize}px ${config.fontFamily}`;
  ctx.textBaseline = "top";

  let contentWidth = measureTextTabular(ctx, splitText);
  if (hasMemo) {
    ctx.font = `${memoFontSize}px ${config.fontFamily}`;
    const memoMetrics = ctx.measureText(latestSplit.memo);
    contentWidth = Math.max(contentWidth, memoMetrics.width);
  }

  const boxWidth = contentWidth + splitPadding * 2;
  const boxHeight = splitFontSize + splitPadding * 2 + (hasMemo ? memoGap + memoFontSize : 0);

  // Get stopwatch bounds to position below/above it
  const swBounds = getStopwatchBounds(ctx, config, elapsedSeconds);

  // Restore split font (getStopwatchBounds overwrites ctx.font)
  ctx.font = `bold ${splitFontSize}px ${config.fontFamily}`;
  ctx.textBaseline = "top";

  const gap = 4;

  // Always render the split below the stopwatch so the timer's top edge
  // stays fixed when a split appears, regardless of the anchor.
  const y = swBounds.y + swBounds.height + gap;

  // Align horizontally with stopwatch center
  const x = swBounds.x + (swBounds.width - boxWidth) / 2;

  // Background
  ctx.fillStyle = config.backgroundColor;
  ctx.beginPath();
  const r = Math.min(config.borderRadius, boxHeight / 2);
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + boxWidth - r, y);
  ctx.quadraticCurveTo(x + boxWidth, y, x + boxWidth, y + r);
  ctx.lineTo(x + boxWidth, y + boxHeight - r);
  ctx.quadraticCurveTo(x + boxWidth, y + boxHeight, x + boxWidth - r, y + boxHeight);
  ctx.lineTo(x + r, y + boxHeight);
  ctx.quadraticCurveTo(x, y + boxHeight, x, y + boxHeight - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();

  // Split text
  ctx.fillStyle = config.textColor;
  ctx.font = `bold ${splitFontSize}px ${config.fontFamily}`;
  fillTextTabular(ctx, splitText, x + splitPadding, y + splitPadding);

  // Memo text
  if (hasMemo) {
    ctx.font = `${memoFontSize}px ${config.fontFamily}`;
    ctx.globalAlpha = 0.75;
    ctx.fillText(latestSplit.memo, x + splitPadding, y + splitPadding + splitFontSize + memoGap);
    ctx.globalAlpha = 1.0;
  }
}

// Lazy-loaded watermark icon
let _watermarkIcon: HTMLImageElement | null = null;
let _iconLoadStarted = false;

function getWatermarkIcon(): HTMLImageElement | null {
  if (!_iconLoadStarted) {
    _iconLoadStarted = true;
    const img = new Image();
    img.onload = () => {
      _watermarkIcon = img;
    };
    img.src = "/apple-touch-icon.png";
  }
  return _watermarkIcon;
}

/**
 * Render the "SwimHub Timer" watermark with icon in the bottom-right corner.
 */
export function renderWatermark(ctx: CanvasRenderingContext2D): void {
  const fontSize = Math.max(12, Math.round(ctx.canvas.height * 0.04));
  const margin = 0.03;
  const text = "SwimHub Timer";
  const gap = fontSize * 0.3;
  const iconSize = fontSize;

  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.font = `600 ${fontSize}px sans-serif`;
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "white";

  const textWidth = ctx.measureText(text).width;
  const textX = ctx.canvas.width * (1 - margin) - textWidth;
  const textY = ctx.canvas.height * (1 - margin);

  // Draw icon to the left of text
  const icon = getWatermarkIcon();
  if (icon) {
    const iconX = textX - gap - iconSize;
    const iconY = textY - iconSize;
    ctx.drawImage(icon, iconX, iconY, iconSize, iconSize);
  }

  ctx.fillText(text, textX, textY);
  ctx.restore();
}

export function getStopwatchBounds(
  ctx: CanvasRenderingContext2D,
  config: StopwatchConfig,
  elapsedSeconds: number,
): { x: number; y: number; width: number; height: number } {
  const timeText = formatTime(elapsedSeconds);
  ctx.font = `bold ${config.fontSize}px ${config.fontFamily}`;
  const boxWidth = measureTextTabular(ctx, timeText) + config.padding * 2;
  const boxHeight = config.fontSize + config.padding * 2;
  const { x, y } = calculatePosition(
    config,
    boxWidth,
    boxHeight,
    ctx.canvas.width,
    ctx.canvas.height,
  );
  return { x, y, width: boxWidth, height: boxHeight };
}

interface SummaryLayout {
  x: number;
  y: number;
  totalWidth: number;
  totalHeight: number;
  pad: number;
  rowHeight: number;
  headerHeight: number;
  colWidths: number[];
  cols: string[];
  effectiveRace: number;
  raceRows: ReturnType<typeof calculateRaceLapTimesTable>;
  intervals: number[];
  showFinalRow: boolean;
}

function computeSummaryLayout(
  ctx: CanvasRenderingContext2D,
  config: StopwatchConfig,
  splitTimes: SplitTime[],
  finishTime: number,
  raceDistance: number | null,
  contentRect: { x: number; y: number; width: number; height: number },
): SummaryLayout {
  const scale = config.summaryScale;
  const pad = config.padding * scale;
  const baseFontSize = Math.max(8, Math.round(13 * scale));
  const headerFontSize = Math.max(7, Math.round(10 * scale));

  const sortedSplits = [...splitTimes].sort((a, b) => a.distance - b.distance);
  const effectiveRace =
    raceDistance ?? (sortedSplits.length > 0 ? sortedSplits[sortedSplits.length - 1].distance : 0);

  const raceRows =
    effectiveRace > 0
      ? calculateRaceLapTimesTable(
          sortedSplits.map((s) => ({ distance: s.distance, splitTime: s.time })),
          effectiveRace,
        )
      : [];
  const intervals = effectiveRace > 0 ? getVisibleLapIntervals(raceRows, effectiveRace) : [];

  // Build column headers
  const cols = ["Dist", "Split", ...intervals.map((i) => `${i}M`)];

  // Measure column widths
  ctx.font = `bold ${baseFontSize}px monospace`;
  const timeStr = formatTime(finishTime);
  const timeWidth = measureTextTabular(ctx, timeStr);

  ctx.font = `${headerFontSize}px monospace`;
  const distHeaderW = ctx.measureText("Dist").width;
  const splitHeaderW = ctx.measureText("Split").width;

  ctx.font = `bold ${baseFontSize}px monospace`;
  const distW = Math.max(
    distHeaderW,
    ...raceRows.map((r) => ctx.measureText(`${r.distance}m`).width),
    effectiveRace > 0 ? ctx.measureText(`${effectiveRace}m`).width : 0,
  );

  const splitW = Math.max(splitHeaderW, timeWidth);

  const lapW =
    intervals.length > 0
      ? Math.max(...intervals.map((i) => ctx.measureText(`${i}M`).width), timeWidth)
      : 0;

  const colWidths: number[] = [
    distW + pad,
    splitW + pad,
    ...intervals.map(() => lapW + pad),
  ];

  const rowHeight = baseFontSize + pad;
  const headerHeight = headerFontSize + pad * 0.5;
  const showFinalRow = !raceRows.some((r) => r.distance === effectiveRace) && effectiveRace > 0;
  const dataRows = raceRows.length + (showFinalRow ? 1 : 0);
  const totalWidth = colWidths.reduce((a, b) => a + b, 0) + pad * 2;
  const totalHeight = headerHeight + dataRows * rowHeight + pad * 2;

  // Position using summaryPosition + summaryAnchor
  const fakeConfig: StopwatchConfig = {
    ...config,
    position: config.summaryPosition,
    anchor: config.summaryAnchor,
  };
  const { x, y } = calculatePosition(fakeConfig, totalWidth, totalHeight, contentRect.width, contentRect.height);

  return { x: x + contentRect.x, y: y + contentRect.y, totalWidth, totalHeight, pad, rowHeight, headerHeight, colWidths, cols, effectiveRace, raceRows, intervals, showFinalRow };
}

export function renderFinishSummary(
  ctx: CanvasRenderingContext2D,
  config: StopwatchConfig,
  splitTimes: SplitTime[],
  finishTime: number,
  raceDistance: number | null,
  contentRect: { x: number; y: number; width: number; height: number },
): void {
  const scale = config.summaryScale;
  const baseFontSize = Math.max(8, Math.round(13 * scale));
  const headerFontSize = Math.max(7, Math.round(10 * scale));

  const layout = computeSummaryLayout(ctx, config, splitTimes, finishTime, raceDistance, contentRect);
  const { x, y, totalWidth, totalHeight, pad, rowHeight, headerHeight, colWidths, cols, effectiveRace, raceRows, intervals, showFinalRow } = layout;

  // Background
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.beginPath();
  const r = Math.max(4, Math.round(8 * scale));
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + totalWidth - r, y);
  ctx.quadraticCurveTo(x + totalWidth, y, x + totalWidth, y + r);
  ctx.lineTo(x + totalWidth, y + totalHeight - r);
  ctx.quadraticCurveTo(x + totalWidth, y + totalHeight, x + totalWidth - r, y + totalHeight);
  ctx.lineTo(x + r, y + totalHeight);
  ctx.quadraticCurveTo(x, y + totalHeight, x, y + totalHeight - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = config.textColor;
  ctx.textBaseline = "top";

  // Lap interval columns are center-aligned within their cell content area
  // (the trailing `pad` in colWidths is a gutter to the next column, so the
  // visible cell width is colWidths[i] - pad).
  const lapCellContentWidth = (ci: number) => colWidths[ci] - pad;

  // Header row
  ctx.font = `${headerFontSize}px monospace`;
  ctx.globalAlpha = 0.7;
  let cx = x + pad;
  const headerY = y + pad;
  for (let ci = 0; ci < cols.length; ci++) {
    const label = cols[ci];
    if (ci >= 2) {
      const w = ctx.measureText(label).width;
      ctx.fillText(label, cx + (lapCellContentWidth(ci) - w) / 2, headerY);
    } else {
      ctx.fillText(label, cx, headerY);
    }
    cx += colWidths[ci];
  }
  ctx.globalAlpha = 1.0;

  // Data rows
  ctx.font = `bold ${baseFontSize}px monospace`;
  let rowY = y + pad + headerHeight;

  for (const row of raceRows) {
    cx = x + pad;
    // Dist
    ctx.fillText(`${row.distance}m`, cx, rowY);
    cx += colWidths[0];
    // Split
    fillTextTabular(ctx, row.splitTime !== null ? formatTime(row.splitTime) : "-", cx, rowY);
    cx += colWidths[1];
    // Lap columns (center-aligned)
    for (let ci = 0; ci < intervals.length; ci++) {
      const lap = row.lapTimes[intervals[ci]];
      const text = lap !== null && lap !== undefined ? formatTime(lap) : "-";
      const w = measureTextTabular(ctx, text);
      const colIdx = 2 + ci;
      fillTextTabular(ctx, text, cx + (lapCellContentWidth(colIdx) - w) / 2, rowY);
      cx += colWidths[colIdx];
    }
    rowY += rowHeight;
  }

  // Final row (highlighted)
  if (showFinalRow) {
    // Slight highlight background
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.fillRect(x + pad * 0.5, rowY - pad * 0.25, totalWidth - pad, rowHeight);
    ctx.fillStyle = config.textColor;

    cx = x + pad;
    ctx.fillText(`${effectiveRace}m`, cx, rowY);
    cx += colWidths[0];
    fillTextTabular(ctx, formatTime(finishTime), cx, rowY);
    cx += colWidths[1];
    for (let ci = 0; ci < intervals.length; ci++) {
      const colIdx = 2 + ci;
      const w = ctx.measureText("-").width;
      ctx.fillText("-", cx + (lapCellContentWidth(colIdx) - w) / 2, rowY);
      cx += colWidths[colIdx];
    }
  }
}

export function getFinishSummaryBounds(
  ctx: CanvasRenderingContext2D,
  config: StopwatchConfig,
  splitTimes: SplitTime[],
  finishTime: number,
  raceDistance: number | null,
  contentRect: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const layout = computeSummaryLayout(ctx, config, splitTimes, finishTime, raceDistance, contentRect);
  return { x: layout.x, y: layout.y, width: layout.totalWidth, height: layout.totalHeight };
}
