import type { SplitTime, StopwatchConfig } from "../types";
import { calculateRaceLapTimesTable, getVisibleLapIntervals } from "../utils/lap-time-calculator";
import { formatTime } from "../utils";
import type { OverlayContext, Rect } from "./context";
import { calculatePosition, roundedRectPath } from "./layout";
import { fillTextTabular, measureTextTabular } from "./text";

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
  ctx: OverlayContext,
  config: StopwatchConfig,
  splitTimes: SplitTime[],
  finishTime: number,
  raceDistance: number | null,
  contentRect: Rect,
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

  const cols = ["Dist", "Split", ...intervals.map((i) => `${i}M`)];

  ctx.font = `bold ${baseFontSize}px ${config.fontFamily}`;
  const timeStr = formatTime(finishTime);
  const timeWidth = measureTextTabular(ctx, timeStr);

  ctx.font = `${headerFontSize}px ${config.fontFamily}`;
  const distHeaderW = ctx.measureText("Dist").width;
  const splitHeaderW = ctx.measureText("Split").width;

  ctx.font = `bold ${baseFontSize}px ${config.fontFamily}`;
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

  const colWidths: number[] = [distW + pad, splitW + pad, ...intervals.map(() => lapW + pad)];

  const rowHeight = baseFontSize + pad;
  const headerHeight = headerFontSize + pad * 0.5;
  const showFinalRow = !raceRows.some((r) => r.distance === effectiveRace) && effectiveRace > 0;
  const dataRows = raceRows.length + (showFinalRow ? 1 : 0);
  const totalWidth = colWidths.reduce((a, b) => a + b, 0) + pad * 2;
  const totalHeight = headerHeight + dataRows * rowHeight + pad * 2;

  const { x, y } = calculatePosition(
    config.summaryPosition,
    config.summaryAnchor,
    totalWidth,
    totalHeight,
    contentRect.width,
    contentRect.height,
  );

  return {
    x: x + contentRect.x,
    y: y + contentRect.y,
    totalWidth,
    totalHeight,
    pad,
    rowHeight,
    headerHeight,
    colWidths,
    cols,
    effectiveRace,
    raceRows,
    intervals,
    showFinalRow,
  };
}

export function drawFinishSummary(
  ctx: OverlayContext,
  config: StopwatchConfig,
  splitTimes: SplitTime[],
  finishTime: number,
  raceDistance: number | null,
  contentRect: Rect,
): void {
  const scale = config.summaryScale;
  const baseFontSize = Math.max(8, Math.round(13 * scale));
  const headerFontSize = Math.max(7, Math.round(10 * scale));

  const layout = computeSummaryLayout(ctx, config, splitTimes, finishTime, raceDistance, contentRect);
  const {
    x,
    y,
    totalWidth,
    totalHeight,
    pad,
    rowHeight,
    headerHeight,
    colWidths,
    cols,
    effectiveRace,
    raceRows,
    intervals,
    showFinalRow,
  } = layout;

  // Background
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  const r = Math.max(4, Math.round(8 * scale));
  roundedRectPath(ctx, x, y, totalWidth, totalHeight, r);
  ctx.fill();

  ctx.fillStyle = config.textColor;
  ctx.textBaseline = "top";

  // Lap interval columns are center-aligned within their cell content area
  // (the trailing `pad` in colWidths is a gutter to the next column, so the
  // visible cell width is colWidths[i] - pad).
  const lapCellContentWidth = (ci: number) => colWidths[ci] - pad;

  // Header row
  ctx.font = `${headerFontSize}px ${config.fontFamily}`;
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
  ctx.font = `bold ${baseFontSize}px ${config.fontFamily}`;
  let rowY = y + pad + headerHeight;

  for (const row of raceRows) {
    cx = x + pad;
    ctx.fillText(`${row.distance}m`, cx, rowY);
    cx += colWidths[0];
    fillTextTabular(ctx, row.splitTime !== null ? formatTime(row.splitTime) : "-", cx, rowY);
    cx += colWidths[1];
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
  ctx: OverlayContext,
  config: StopwatchConfig,
  splitTimes: SplitTime[],
  finishTime: number,
  raceDistance: number | null,
  contentRect: Rect,
): Rect {
  const layout = computeSummaryLayout(ctx, config, splitTimes, finishTime, raceDistance, contentRect);
  return { x: layout.x, y: layout.y, width: layout.totalWidth, height: layout.totalHeight };
}
