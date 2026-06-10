import type { StopwatchConfig } from "../types";
import { formatTime } from "../utils";
import type { OverlayContext, Rect, Size } from "./context";
import { calculatePosition, roundedRectPath } from "./layout";
import { fillTextTabular, measureTextTabular } from "./text";

export function drawStopwatch(
  ctx: OverlayContext,
  size: Size,
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
    config.position,
    config.anchor,
    boxWidth,
    boxHeight,
    size.width,
    size.height,
  );

  ctx.fillStyle = config.backgroundColor;
  roundedRectPath(ctx, x, y, boxWidth, boxHeight, config.borderRadius);
  ctx.fill();

  ctx.fillStyle = config.textColor;
  fillTextTabular(ctx, timeText, x + config.padding, y + config.padding);
}

export function getStopwatchBounds(
  ctx: OverlayContext,
  size: Size,
  config: StopwatchConfig,
  elapsedSeconds: number,
): Rect {
  const timeText = formatTime(elapsedSeconds);
  ctx.font = `bold ${config.fontSize}px ${config.fontFamily}`;
  const boxWidth = measureTextTabular(ctx, timeText) + config.padding * 2;
  const boxHeight = config.fontSize + config.padding * 2;
  const { x, y } = calculatePosition(
    config.position,
    config.anchor,
    boxWidth,
    boxHeight,
    size.width,
    size.height,
  );
  return { x, y, width: boxWidth, height: boxHeight };
}
