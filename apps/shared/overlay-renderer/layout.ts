import type { StopwatchAnchor } from "../types";
import type { OverlayContext } from "./context";

/**
 * Resolve a box's top-left corner from an anchor + a normalized position
 * (0..1 of the canvas) and the box dimensions. Identical for every overlay
 * element so timer / split / summary share one positioning model.
 */
export function calculatePosition(
  position: { x: number; y: number },
  anchor: StopwatchAnchor,
  boxWidth: number,
  boxHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number } {
  const px = position.x * canvasWidth;
  const py = position.y * canvasHeight;

  let x = px;
  let y = py;

  switch (anchor) {
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

/** Trace a rounded rectangle path (caller sets fillStyle and calls fill). */
export function roundedRectPath(
  ctx: OverlayContext,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
