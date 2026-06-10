/**
 * OverlayContext — a minimal Canvas2D subset shared by the web (`<canvas>`)
 * and mobile (`@shopify/react-native-skia`) overlay renderers.
 *
 * The `draw*` functions in this directory are written against this interface
 * only, so a single body of layout/draw code produces pixel-identical output
 * on both platforms (preview AND export). See
 * `docs/design-skia-unified-renderer.md`.
 *
 * Notes:
 * - `CanvasRenderingContext2D` already structurally satisfies this interface
 *   (web is a near-zero-cost adapter — see apps/web canvas2d-context.ts).
 * - The draw functions never read `ctx.canvas`; the canvas size is always
 *   passed explicitly as a `Size` so a headless Skia surface (which has no DOM
 *   canvas) works the same way.
 * - `OverlayImage` is opaque: the draw code only ever forwards it to
 *   `drawImage`. Web passes an `HTMLImageElement`; Skia passes an `SkImage`.
 */

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Opaque image handle forwarded to {@link OverlayContext.drawImage}. */
export type OverlayImage = unknown;

export interface OverlayTextMetrics {
  width: number;
}

/** Identical set to the DOM `CanvasTextBaseline` so a real ctx is assignable. */
export type OverlayTextBaseline =
  | "top"
  | "hanging"
  | "middle"
  | "alphabetic"
  | "ideographic"
  | "bottom";

export interface OverlayContext {
  /** CSS-font-style shorthand, e.g. `bold 48px monospace`. */
  font: string;
  /** CSS color string. */
  fillStyle: string;
  globalAlpha: number;
  textBaseline: OverlayTextBaseline;

  measureText(text: string): OverlayTextMetrics;
  fillText(text: string, x: number, y: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;

  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  closePath(): void;
  fill(): void;

  drawImage(image: OverlayImage, dx: number, dy: number, dw: number, dh: number): void;

  save(): void;
  restore(): void;
}
