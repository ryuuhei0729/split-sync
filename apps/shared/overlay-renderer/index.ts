/**
 * Unified overlay renderer.
 *
 * One body of layout + draw code, written against the {@link OverlayContext}
 * Canvas2D subset, shared by web (`<canvas>`) and mobile
 * (`@shopify/react-native-skia`) for BOTH preview and export. This is what
 * guarantees the preview and the exported video are pixel-identical.
 *
 * See `docs/design-skia-unified-renderer.md`.
 */

/** Delay (seconds) after the finish touch before the summary table appears. */
export const SUMMARY_DELAY_SECONDS = 2;
/** How long an active split badge stays on screen after its time mark. */
export const SPLIT_DISPLAY_DURATION_SECONDS = 3;

export type {
  OverlayContext,
  OverlayImage,
  OverlayTextBaseline,
  OverlayTextMetrics,
  Rect,
  Size,
} from "./context";

export { calculatePosition, roundedRectPath } from "./layout";
export { getDigitWidth, measureTextTabular, fillTextTabular } from "./text";
export { drawStopwatch, getStopwatchBounds } from "./stopwatch";
export { drawPassedSplit, formatSplitText } from "./split";
export { drawFinishSummary, getFinishSummaryBounds } from "./summary";
export { drawWatermark } from "./watermark";
export type { WatermarkOptions } from "./watermark";
