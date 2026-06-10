import type { OverlayContext } from "./context";

/**
 * Measure the maximum digit width for the current ctx.font, then draw/measure
 * text with all digits at equal (max) width. This reproduces a `tabular-nums`
 * font feature using only the primitive measure/fill calls, so the timer and
 * split readouts don't jitter as digits change.
 */
export function getDigitWidth(ctx: OverlayContext): number {
  let max = 0;
  for (let d = 0; d <= 9; d++) {
    const w = ctx.measureText(String(d)).width;
    if (w > max) max = w;
  }
  return max;
}

export function measureTextTabular(ctx: OverlayContext, text: string): number {
  const dw = getDigitWidth(ctx);
  let total = 0;
  for (const ch of text) {
    total += ch >= "0" && ch <= "9" ? dw : ctx.measureText(ch).width;
  }
  return total;
}

export function fillTextTabular(ctx: OverlayContext, text: string, x: number, y: number): void {
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
