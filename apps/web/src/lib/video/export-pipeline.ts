/**
 * ffmpeg.wasm フォールバック書き出しエンジン (WebCodecs 非対応環境、または WebCodecs 経路が
 * 実行時に例外を投げた場合に `export-dispatcher.ts` から呼ばれる)。
 *
 * 案A (Sprint Contract): 動的要素 (タイマー/スプリットバッジ/透かし) はもう `drawtext`
 * フィルタで手書き再実装しない。共有 overlay-renderer (`@swimhub-timer/shared`) を使う
 * `overlay-frame-renderer.ts`/`overlay-png-sequence.ts` で OffscreenCanvas に描画し、出力fps
 * 分の透過PNG連番 (`overlay_%05d.png`) を生成 → ffmpeg の第2入力として `overlay` フィルタで
 * 元動画に合成する。ffmpeg はスケーリング/エンコード/合成のみを行い、文字描画は一切行わない。
 * ねらいは、動的要素の書式・位置計算を旧 drawtext 手書き実装のように独自に持たず、プレビュー
 * (`useCanvasCompositor.ts`) / WebCodecs 書き出し (`webcodecs-frame-compositor.ts`) と同じ
 * `@swimhub-timer/shared` の描画関数だけを経由させること (単一ソース化)。実際にピクセル単位で
 * 一致するかは QA の実機/フレーム比較検証 (Sprint Contract V-15/V-22 等) で確認する。
 *
 * フィニッシュサマリーは従来通り呼び出し元 (`useVideoExport.ts`) が単一 PNG を事前生成して
 * 渡す方式のまま変更しない (V-08) — 第3入力として合成する。
 *
 * fps/解像度スケーリングは WebCodecs エンジンと同じ純粋関数 (`webcodecs-source-probe.ts` の
 * `probeVideoSource`, `webcodecs-encoder-config.ts` の `buildExportDimensions`/
 * `scaleStopwatchConfigForExport`) を再利用する。どちらもブラウザの `VideoEncoder`/
 * `VideoDecoder` を一切呼ばない (mediabunny のコンテナ解析のみ) ため、WebCodecs 非対応環境
 * でも安全に使える。
 */
import { SUMMARY_DELAY_SECONDS } from "@swimhub-timer/shared";
import { ffmpegManager, fetchFile } from "./ffmpeg-manager";
import { probeVideoSource } from "./webcodecs-source-probe";
import { buildExportDimensions, scaleStopwatchConfigForExport } from "./webcodecs-encoder-config";
import { loadWatermarkIcon } from "./webcodecs-export-pipeline";
import { generateOverlayPngSequence, overlayPngFileName } from "./overlay-png-sequence";
import type { ExportVideoOptions } from "./webcodecs-types";

export async function exportVideoWithStopwatch(options: ExportVideoOptions): Promise<Blob> {
  const {
    videoFile,
    startSignalTime,
    stopwatchConfig,
    originalVideoWidth,
    originalVideoHeight,
    exportSettings,
    onProgress,
    showWatermark,
    splitTimes,
    isFinished,
    finishTime,
    summaryImageData,
  } = options;

  const ffmpeg = await ffmpegManager.load(onProgress);

  // Write input video to virtual filesystem
  await ffmpeg.writeFile("input.mp4", await fetchFile(videoFile));

  // Metadata-only probe (no decode) — the same probe the WebCodecs engine uses, so both
  // engines always agree on fps/dimensions for a given file.
  const { videoTrack, displayWidth, displayHeight, fps } = await probeVideoSource(videoFile);
  const durationSeconds =
    (await videoTrack.getDurationFromMetadata()) ?? (await videoTrack.computeDuration());

  // Resolve the output pixel dimensions ffmpeg's `scale=-2:H` filter below is *intended* to
  // produce (same formula as `webcodecs-encoder-config.ts`'s WebCodecs sizing), so the
  // overlay PNG sequence is generated at that same size and `overlay=0:0` needs no extra
  // scaling filter on the overlay input. Not verified byte-for-byte against ffmpeg's actual
  // decoded/scaled output for every source (e.g. an odd-dimension "original"-resolution
  // source could in principle round differently) — flagged as a known open question for QA.
  const { width: outputWidth, height: outputHeight } = buildExportDimensions(
    originalVideoWidth || displayWidth,
    originalVideoHeight || displayHeight,
    exportSettings.resolution,
  );

  // Scale font/padding/borderRadius proportionally when exporting at a different resolution
  // than the source — identical formula to the WebCodecs engine (shared pure function).
  const scaledConfig = scaleStopwatchConfigForExport(
    stopwatchConfig,
    exportSettings.resolution,
    originalVideoHeight,
    outputHeight,
  );

  const watermarkIcon = showWatermark ? await loadWatermarkIcon() : null;

  // --- Generate the transparent overlay PNG sequence (timer/split/watermark only) -------
  // Frames are written to ffmpeg's virtual FS one at a time as they're generated (never
  // buffered as an array of Blobs in this function's own memory) — see overlay-png-sequence.ts
  // for what this does and doesn't bound.
  //
  // The `onFrame` progress callback below deliberately does NOT destructure `frameCount`
  // from this call's return value and reference it from inside the callback: `onFrame` runs
  // synchronously inside the `await` on every iteration — i.e. strictly *before* the
  // `generateOverlayPngSequence(...)` expression finishes evaluating and its result is bound
  // to a local — so referencing that not-yet-initialized `const` binding from inside
  // `onFrame` throws `ReferenceError: Cannot access '...' before initialization` (TDZ) on the
  // very first frame (Reviewer Critical-1). Instead, progress is derived from `index`/`fps`/
  // `durationSeconds` alone (all already in scope beforehand), which is an equivalent
  // approximation of `index / frameCount` without needing the total up front.
  await generateOverlayPngSequence({
    width: outputWidth,
    height: outputHeight,
    fps,
    durationSeconds,
    startSignalTime,
    stopwatchConfig: scaledConfig,
    splitTimes,
    isFinished,
    finishTime,
    showWatermark,
    watermarkIcon,
    onFrame: async (index, png) => {
      await ffmpeg.writeFile(overlayPngFileName(index), png);
      // Overlay generation has no ffmpeg "progress" event of its own; report it as the
      // first half of the bar so the UI doesn't sit at 0% for the whole rendering phase on
      // long clips. The encode step below drives the ffmpeg-reported progress for the rest.
      const elapsedFraction = durationSeconds > 0 ? (index + 1) / fps / durationSeconds : 1;
      onProgress(Math.min(50, Math.round(elapsedFraction * 50)));
    },
  });

  // --- Finish summary (unchanged single-PNG-overlay approach, V-08) ----------------------
  let hasSummary = false;
  if (summaryImageData !== null && finishTime !== null) {
    const summaryBuffer = await summaryImageData.arrayBuffer();
    await ffmpeg.writeFile("summary.png", new Uint8Array(summaryBuffer));
    hasSummary = true;
  }

  // --- Build the ffmpeg filter graph ------------------------------------------------------
  const crf = exportSettings.resolution === "original" ? "23" : "28";
  const bgFilter = exportSettings.resolution !== "original" ? `scale=-2:${exportSettings.resolution}` : "null";
  const summaryScale =
    exportSettings.resolution !== "original" ? `scale=-2:${exportSettings.resolution}` : "scale=iw:ih";
  const summaryEnableT =
    finishTime !== null ? (startSignalTime + finishTime + SUMMARY_DELAY_SECONDS).toFixed(3) : "0";

  const filterParts = [`[0:v]${bgFilter}[bg]`, `[1:v]format=rgba[ovl]`, `[bg][ovl]overlay=0:0[timed]`];
  let videoOutLabel = "timed";
  if (hasSummary) {
    filterParts.push(`[2:v]${summaryScale}[sum]`);
    filterParts.push(`[timed][sum]overlay=0:0:enable='gte(t,${summaryEnableT})'[v]`);
    videoOutLabel = "v";
  }

  // Trim to a sane CLI precision; the frame *generation* above already used the raw `fps`
  // for accurate per-frame timestamps — only the ffmpeg argument string needs rounding.
  const inputArgs = ["-i", "input.mp4", "-framerate", fps.toFixed(3), "-i", "overlay_%05d.png"];
  if (hasSummary) inputArgs.push("-i", "summary.png");

  const baseArgs = [
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", crf,
    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "output.mp4",
  ];

  await ffmpeg.exec([
    ...inputArgs,
    "-filter_complex", filterParts.join(";"),
    "-map", `[${videoOutLabel}]`,
    "-map", "0:a?",
    ...baseArgs,
  ]);

  // Read output
  const outputData = await ffmpeg.readFile("output.mp4");
  return new Blob([new Uint8Array(outputData as Uint8Array)], { type: "video/mp4" });
}
