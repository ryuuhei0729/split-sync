/**
 * Skia typeface loading for the unified overlay renderer.
 *
 * The same bundled TTFs the FFmpeg export uses (`NotoSansMono-Bold` for the
 * digit timer, `NotoSansJP-Bold` for everything that may contain Japanese) are
 * loaded as Skia `Typeface`s, so the Skia preview and the Skia offscreen
 * export PNGs measure and rasterize glyphs identically.
 *
 * See `docs/design-skia-unified-renderer.md` §3 / §4.
 */
import { Skia, type SkTypeface } from "@shopify/react-native-skia";
import { Asset } from "expo-asset";

/**
 * Watermark sizing/font for the mobile Skia overlay, matching the mobile
 * FFmpeg `drawtext` watermark (`buildWatermarkFilter`: height*0.06, min 16) so
 * the Skia preview and the export watermark agree. (Web uses the 0.04/12
 * default.) `sans-serif` resolves to NotoSansJP-Bold via {@link pickTypeface}.
 */
export const MOBILE_WATERMARK_OPTIONS = {
  fontFamily: "sans-serif",
  fontWeight: "bold",
  heightFactor: 0.06,
  minFontSize: 16,
} as const;

export interface OverlayTypefaces {
  /** Latin-only monospace Bold — the timer's digit display. */
  mono: SkTypeface;
  /** Japanese-capable sans Bold — splits, summary, memo, watermark. */
  sans: SkTypeface;
}

let cached: OverlayTypefaces | null = null;
let inflight: Promise<OverlayTypefaces> | null = null;

async function loadTypeface(mod: number): Promise<SkTypeface> {
  const asset = Asset.fromModule(mod);
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  if (!uri) throw new Error("Font asset has no resolvable URI");
  const data = await Skia.Data.fromURI(uri);
  const tf = Skia.Typeface.MakeFreeTypeFaceFromData(data);
  if (!tf) throw new Error(`Failed to create Skia typeface from ${uri}`);
  return tf;
}

/**
 * Load (and cache) the overlay typefaces. Safe to call repeatedly — concurrent
 * callers share a single in-flight load.
 */
export async function loadOverlayTypefaces(): Promise<OverlayTypefaces> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const [mono, sans] = await Promise.all([
        loadTypeface(require("../../assets/fonts/NotoSansMono-Bold.ttf")),
        loadTypeface(require("../../assets/fonts/NotoSansJP-Bold.ttf")),
      ]);
      cached = { mono, sans };
      return cached;
    } catch (e) {
      // Clear the in-flight promise so a transient failure (e.g. asset not yet
      // downloaded, corrupt data) can be retried on the next call rather than
      // permanently returning a rejected promise.
      inflight = null;
      throw e;
    }
  })();
  return inflight;
}

/** Synchronously returns the typefaces if already loaded, else null. */
export function getLoadedTypefaces(): OverlayTypefaces | null {
  return cached;
}

/**
 * Resolve a CSS `font-family` token (as used in the shared renderer's font
 * shorthand) to one of the bundled typefaces. The shared renderer uses
 * `monospace` for the digit timer and the summary table; everything else maps
 * to the JP-capable sans.
 */
export function pickTypeface(fonts: OverlayTypefaces, family: string): SkTypeface {
  return family.includes("mono") ? fonts.mono : fonts.sans;
}
