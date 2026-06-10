import type { SplitTime, StopwatchConfig } from "../types";
import { formatTime } from "../utils";
import type { OverlayContext, Size } from "./context";
import { roundedRectPath } from "./layout";
import { getStopwatchBounds } from "./stopwatch";
import { fillTextTabular, measureTextTabular } from "./text";

export function formatSplitText(split: SplitTime): string {
  const timeStr = formatTime(split.time);
  if (split.lapTime !== null) {
    const lapStr = formatTime(split.lapTime);
    return `${split.distance}m: ${timeStr} (lap: ${lapStr})`;
  }
  return `${split.distance}m: ${timeStr}`;
}

/**
 * Draw the active split badge directly below the stopwatch. The timer's top
 * edge stays fixed when a split appears (the badge always grows downward),
 * regardless of anchor.
 */
export function drawPassedSplit(
  ctx: OverlayContext,
  size: Size,
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

  // Get stopwatch bounds to position below it.
  const swBounds = getStopwatchBounds(ctx, size, config, elapsedSeconds);

  // Restore split font (getStopwatchBounds overwrites ctx.font).
  ctx.font = `bold ${splitFontSize}px ${config.fontFamily}`;
  ctx.textBaseline = "top";

  const gap = 4;
  const y = swBounds.y + swBounds.height + gap;
  const x = swBounds.x + (swBounds.width - boxWidth) / 2;

  ctx.fillStyle = config.backgroundColor;
  roundedRectPath(ctx, x, y, boxWidth, boxHeight, config.borderRadius);
  ctx.fill();

  ctx.fillStyle = config.textColor;
  ctx.font = `bold ${splitFontSize}px ${config.fontFamily}`;
  fillTextTabular(ctx, splitText, x + splitPadding, y + splitPadding);

  if (hasMemo) {
    ctx.font = `${memoFontSize}px ${config.fontFamily}`;
    ctx.globalAlpha = 0.75;
    ctx.fillText(latestSplit.memo, x + splitPadding, y + splitPadding + splitFontSize + memoGap);
    ctx.globalAlpha = 1.0;
  }
}
