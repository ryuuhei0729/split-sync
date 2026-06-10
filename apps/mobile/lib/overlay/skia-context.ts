/**
 * Skia adapter for the shared {@link OverlayContext}.
 *
 * Wraps a Skia `SkCanvas` so the platform-agnostic `draw*` functions in
 * `@swimhub-timer/shared` render through Skia — identically for the live
 * preview (`<Canvas>` / `PictureRecorder`) and the headless export
 * (`Surface.MakeOffscreen`). This is the mobile half of the "single
 * rasterizer" principle (design doc §2/§4).
 *
 * Coordinate model: Canvas2D draws text from its `textBaseline`; Skia draws
 * from the alphabetic baseline. We translate using the font metrics so
 * `textBaseline = "top"` (the renderer's default) and `"bottom"` (watermark)
 * land where Canvas2D would put them.
 */
import {
  Skia,
  type SkCanvas,
  type SkFont,
  type SkPaint,
  type SkPath,
  type SkImage,
} from "@shopify/react-native-skia";
import type {
  OverlayContext,
  OverlayImage,
  OverlayTextBaseline,
  OverlayTextMetrics,
} from "@swimhub-timer/shared";
import { pickTypeface, type OverlayTypefaces } from "./fonts";

interface ParsedFont {
  family: string;
  size: number;
}

/** Parse the renderer's CSS font shorthand: `[weight] <size>px <family>`. */
function parseFont(font: string): ParsedFont {
  const match = font.match(/(\d+(?:\.\d+)?)px\s+(.+)$/);
  if (!match) return { family: "sans-serif", size: 16 };
  return { size: parseFloat(match[1]), family: match[2].trim() };
}

export class SkiaOverlayContext implements OverlayContext {
  font = "16px sans-serif";
  fillStyle = "#000000";
  globalAlpha = 1;
  textBaseline: OverlayTextBaseline = "alphabetic";

  private readonly canvas: SkCanvas;
  private readonly typefaces: OverlayTypefaces;
  private readonly fontCache = new Map<string, SkFont>();
  private path: SkPath = Skia.Path.Make();

  constructor(canvas: SkCanvas, typefaces: OverlayTypefaces) {
    this.canvas = canvas;
    this.typefaces = typefaces;
  }

  // --- font / paint helpers ---------------------------------------------------

  private currentFont(): SkFont {
    const cached = this.fontCache.get(this.font);
    if (cached) return cached;
    const { family, size } = parseFont(this.font);
    const tf = pickTypeface(this.typefaces, family);
    const f = Skia.Font(tf, size);
    // NOTE: do NOT call f.setSubpixel(true) — @shopify/react-native-skia 2.4.18's
    // JSI binding for setSubpixel rejects a boolean ("Value is true, expected a
    // number") and crashes. It's an optional text-positioning nicety; omitting
    // it is harmless and preview/export stay consistent (same ctx both sides).
    this.fontCache.set(this.font, f);
    return f;
  }

  /** A fill paint using the current fillStyle modulated by globalAlpha. */
  private fillPaint(): SkPaint {
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    // SkColor is a Float32Array of [r, g, b, a] components in 0..1.
    const color = Skia.Color(this.fillStyle); // parses #rgb, rgba(), names
    paint.setColor(color);
    const baseAlpha = color[3];
    paint.setAlphaf(baseAlpha * this.globalAlpha);
    return paint;
  }

  // --- text -------------------------------------------------------------------

  measureText(text: string): OverlayTextMetrics {
    const font = this.currentFont();
    const ids = font.getGlyphIDs(text);
    const widths = font.getGlyphWidths(ids);
    let total = 0;
    for (const w of widths) total += w;
    return { width: total };
  }

  fillText(text: string, x: number, y: number): void {
    const font = this.currentFont();
    const metrics = font.getMetrics();
    let baselineY = y;
    switch (this.textBaseline) {
      case "top":
      case "hanging": {
        // Canvas2D "top" aligns the em-box top to y, but Skia's ascent metric
        // (hhea/typo ascender, often > the em box) would push glyphs low enough
        // to clip the box bottom. Instead, vertically center the glyph block
        // within the `fontSize` em band that starts at y — boxed text (which is
        // sized to fontSize + 2*padding) then sits with even margins and never
        // clips. ascent is negative, descent positive.
        const size = font.getSize();
        baselineY = y + size / 2 - (metrics.ascent + metrics.descent) / 2;
        break;
      }
      case "middle":
        baselineY = y - (metrics.ascent + metrics.descent) / 2;
        break;
      case "bottom":
      case "ideographic":
        baselineY = y - metrics.descent;
        break;
      // "alphabetic" → baseline at y
    }
    this.canvas.drawText(text, x, baselineY, this.fillPaint(), font);
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.canvas.drawRect(Skia.XYWHRect(x, y, w, h), this.fillPaint());
  }

  // --- path -------------------------------------------------------------------

  beginPath(): void {
    this.path = Skia.Path.Make();
  }
  moveTo(x: number, y: number): void {
    this.path.moveTo(x, y);
  }
  lineTo(x: number, y: number): void {
    this.path.lineTo(x, y);
  }
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    this.path.quadTo(cpx, cpy, x, y);
  }
  closePath(): void {
    this.path.close();
  }
  fill(): void {
    this.canvas.drawPath(this.path, this.fillPaint());
  }

  // --- images -----------------------------------------------------------------

  drawImage(image: OverlayImage, dx: number, dy: number, dw: number, dh: number): void {
    const img = image as SkImage;
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    paint.setAlphaf(this.globalAlpha);
    const src = Skia.XYWHRect(0, 0, img.width(), img.height());
    const dest = Skia.XYWHRect(dx, dy, dw, dh);
    this.canvas.drawImageRect(img, src, dest, paint);
  }

  // --- state ------------------------------------------------------------------
  // Skia's canvas save/restore covers the matrix/clip; the JS-side drawing
  // state (font, fillStyle, globalAlpha, textBaseline) lives here, so we
  // snapshot it too — a full Canvas2D-equivalent save/restore that holds even
  // if a future draw reorders elements after a save().

  private stateStack: {
    font: string;
    fillStyle: string;
    globalAlpha: number;
    textBaseline: OverlayTextBaseline;
  }[] = [];

  save(): void {
    this.stateStack.push({
      font: this.font,
      fillStyle: this.fillStyle,
      globalAlpha: this.globalAlpha,
      textBaseline: this.textBaseline,
    });
    this.canvas.save();
  }
  restore(): void {
    this.canvas.restore();
    const s = this.stateStack.pop();
    if (s) {
      this.font = s.font;
      this.fillStyle = s.fillStyle;
      this.globalAlpha = s.globalAlpha;
      this.textBaseline = s.textBaseline;
    }
  }
}
