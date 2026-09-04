/**
 * ffmpeg.wasm フォールバック書き出し専用の overlay フレーム描画器。
 *
 * `webcodecs-frame-compositor.ts` の `compositeFrame` と同じ `@swimhub-timer/shared`
 * overlay-renderer (drawStopwatch/drawPassedSplit/drawWatermark) を使うが、あちらと違って
 * **動画のソースフレームは一切描画しない** — この関数が生成するのは「タイマー/スプリット
 * バッジ/透かしだけが乗った透過 (alpha=0 背景) の OffscreenCanvas」であり、
 * `overlay-png-sequence.ts` がこれを連番 PNG として書き出し、ffmpeg 側の `overlay` フィルタで
 * 元動画に合成する (案A)。
 *
 * `compositeFrame` をそのまま流用しない理由: あの関数は `ctx.drawImage(input.sourceFrame, ...)`
 * を呼ぶため、ソースフレームを持たないこの用途にそのまま使うと動画フレームが二重に焼き込まれる
 * (QA Phase A ノート参照)。elapsed のクランプ・アクティブスプリットの区間判定ロジックは
 * `compositeFrame` と同一の仕様を独立に再実装しているが、実際の描画呼び出し
 * (drawStopwatch/drawPassedSplit/drawWatermark) と定数 (SPLIT_DISPLAY_DURATION_SECONDS) は
 * 全経路で `@swimhub-timer/shared` の同じ関数を経由するため、書式・位置計算が分岐することはない。
 *
 * finish summary はこのフレームには含まれない — 従来通り `useVideoExport.ts` が事前生成する
 * 単一 PNG のまま (V-08, 回帰なし)。summary が表示されるタイミング以降はタイマー/スプリットの
 * 描画を止める (透かしのみ継続) ことで `compositeFrame`/プレビューと同じ見え方にする。
 */
import type { OverlayContext, OverlayImage, SplitTime, StopwatchConfig } from "@swimhub-timer/shared";
import { SPLIT_DISPLAY_DURATION_SECONDS, drawPassedSplit, drawStopwatch, drawWatermark } from "@swimhub-timer/shared";
import { summaryOverlayStartMicros } from "./webcodecs-frame-compositor";

/** `OffscreenCanvasRenderingContext2D` 版の `OverlayContext` 変換 — `webcodecs-frame-compositor.ts`
 *  と同じ「ほぼゼロコストな構造的アダプタ」パターン。 */
function toOverlayContext(ctx: OffscreenCanvasRenderingContext2D): OverlayContext {
  return ctx as unknown as OverlayContext;
}

const MICROSECONDS_PER_SECOND = 1_000_000;

export interface OverlayFrameCompositorContext {
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
  width: number;
  height: number;
}

/** 1フレーム分の overlay 描画に必要な入力 — `FrameCompositorInput` (webcodecs-types.ts) の
 *  動的要素サブセット。`sourceFrame`/`raceDistance` は持たない (summary はこの経路の対象外)。 */
export interface OverlayFrameInput {
  /**
   * この出力フレームの提示時刻 (秒)。ffmpeg に渡す連番PNGのフレーム番号を `fps` で割った値
   * (`overlay-png-sequence.ts` 参照) — 合成先の元動画と同じタイムライン (0起点) で揃える。
   */
  timestamp: number;
  startSignalTime: number;
  stopwatchConfig: StopwatchConfig;
  splitTimes: SplitTime[];
  isFinished: boolean;
  finishTime: number | null;
  showWatermark: boolean;
  watermarkIcon: OverlayImage | null;
}

/** 連番PNG生成用に使い回す OffscreenCanvas を1つ作る (フレームごとに毎回 alloc しない)。 */
export function createOverlayFrameCompositorContext(
  width: number,
  height: number,
): OverlayFrameCompositorContext {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) {
    throw new Error("Failed to acquire an OffscreenCanvas 2D context.");
  }
  return { canvas, ctx, width, height };
}

/**
 * 1フレーム分の overlay を透過キャンバスに描画する (in-place)。`compositeFrame` の
 * elapsed クランプ・summary 表示判定・アクティブスプリット判定と同一仕様。
 */
export function compositeOverlayFrame(
  context: OverlayFrameCompositorContext,
  input: OverlayFrameInput,
): void {
  const { ctx, width, height } = context;
  const overlayCtx = toOverlayContext(ctx);
  const size = { width, height };

  // 完全透過でクリア (ffmpeg の overlay フィルタが背景を透かして合成できるようにする)。
  ctx.clearRect(0, 0, width, height);

  const rawElapsed = Math.max(0, input.timestamp - input.startSignalTime);
  let elapsed = rawElapsed;
  if (input.isFinished && input.finishTime !== null && elapsed > input.finishTime) {
    elapsed = input.finishTime;
  }

  // summaryOverlayStartMicros は webcodecs-frame-compositor.ts の純粋関数を再利用する
  // (SUMMARY_DELAY_SECONDS の計算式を三重に持たないため — V-08 の summaryEnableT と単一ソース)。
  const timestampMicros = Math.round(input.timestamp * MICROSECONDS_PER_SECOND);
  const summaryVisible =
    input.isFinished &&
    input.finishTime !== null &&
    timestampMicros >= summaryOverlayStartMicros(input.startSignalTime, input.finishTime);

  if (!summaryVisible) {
    drawStopwatch(overlayCtx, size, input.stopwatchConfig, elapsed);

    if (input.splitTimes.length > 0) {
      let activeSplit: SplitTime | null = null;
      for (let i = input.splitTimes.length - 1; i >= 0; i--) {
        const split = input.splitTimes[i];
        if (!split) continue; // i stays within [0, input.splitTimes.length) by the loop bound,
                               // so split is always defined; guard is defensive against future drift
        if (elapsed >= split.time && elapsed < split.time + SPLIT_DISPLAY_DURATION_SECONDS) {
          activeSplit = split;
          break;
        }
      }
      if (activeSplit) {
        drawPassedSplit(overlayCtx, size, input.stopwatchConfig, elapsed, activeSplit);
      }
    }
  }

  if (input.showWatermark) {
    drawWatermark(overlayCtx, size, input.watermarkIcon);
  }
}
