/**
 * Sprint Contract E2E テスト — Phase B (QA が実行可能な形に有効化)
 * ffmpeg.wasm フォールバック書き出しの overlay 一致化 (案A: 動的要素を透過PNG連番化して合成)
 *
 * 検証対象の Sprint Contract 項目:
 *   V-01(前提): ffmpeg フォールバックを実ブラウザで強制発火させる手段の確立
 *   V-02/V-06/V-07/V-08: ffmpeg フォールバック経由の書き出しが実際に完了し、タイマー/
 *         スプリット/透かし/フィニッシュサマリーを含む動画がダウンロードできること
 *   V-15/V-16: 焼き込まれた overlay をプレビューと目視比較 (フレーム抽出はローカル ffmpeg
 *         (homebrew) を使用 — ffmpeg.wasm とは別の実 ffmpeg バイナリ)
 *   V-17: 長尺 (2分10秒) 動画でもクラッシュ・ハング・進捗停止せずに完了すること
 *
 * fixture: e2e/fixtures/test-race-short.mp4 (6秒・640x360)、
 *          e2e/fixtures/test-race-long-2min.mp4 (130秒・640x360、V-17 用)
 * いずれも QA が用意した青一色+サイン波音声の合成動画。実機水泳動画ではないため画角/種目等の
 * 目視評価はできないが、ffmpeg フォールバック経路が完走し、overlay (タイマー/スプリット/
 * 透かし) が実際に合成されるかどうかの動作確認・連番PNG大量生成時の安定性確認には十分)。
 *
 * 経緯: Phase B 開始時点の export-pipeline.ts には Critical バグ (`const { frameCount } =
 * await generateOverlayPngSequence(...)` を onFrame コールバック内で参照する TDZ 参照エラーで
 * 1フレーム目から必ず失敗) があり、QA の単体テスト (export-pipeline.test.ts) と本ファイルの
 * 初回実行の両方で実機再現した。Developer が `computeOverlayFrameCount` を独立関数に切り出す
 * 形で修正済み (現在のソースにコメントあり) — 以下のテストは修正後の状態を検証する。
 */
import { test, expect, type Page } from "@playwright/test";
import path from "node:path";

const FIXTURE_SHORT = path.join(__dirname, "fixtures", "test-race-short.mp4");
const FIXTURE_LONG = path.join(__dirname, "fixtures", "test-race-long-2min.mp4");

/** Force `checkWebCodecsSupport()` to report unsupported so `dispatchVideoExport`
 *  always takes the ffmpeg.wasm fallback path (see webcodecs-capability.ts). */
async function forceFfmpegFallback(page: Page) {
  await page.addInitScript(() => {
    // @ts-expect-error テスト用の意図的な削除
    delete window.VideoEncoder;
    // @ts-expect-error テスト用の意図的な削除
    delete window.VideoDecoder;
  });
}

/** Drives the app from the import screen up to a confirmed start signal, landing on the
 *  main editor ("detect") screen with `startTime` set. */
async function importVideoAndConfirmStart(page: Page, fixturePath: string = FIXTURE_SHORT) {
  await page.goto("/ja");
  await page.locator('input[type="file"]').setInputFiles(fixturePath);

  // Wait for the waveform canvas (rendered once audio analysis completes) and click near
  // its start to set a candidate signal time, then confirm it as the start point.
  // NOTE: SignalDetector is mounted twice (mobile tabs + desktop stacked layout, both in
  // the DOM simultaneously, CSS-hidden per breakpoint — see editor-store.ts's comment on
  // why audio-decode state lives in the store). Filter to visible canvases only: #0 is
  // VideoCanvas's overlay canvas (video preview), #1 is the visible waveform canvas.
  const waveformCanvas = page.locator("canvas:visible").nth(1);
  await expect(waveformCanvas).toBeVisible({ timeout: 30_000 });
  const box = await waveformCanvas.boundingBox();
  if (!box) throw new Error("waveform canvas has no bounding box");
  await waveformCanvas.click({ position: { x: Math.max(2, box.width * 0.05), y: box.height / 2 } });

  await page.getByRole("button", { name: "この時刻で確定" }).click();
}

/** Records one split at ~50m and finishes the race, using the visible desktop SplitsPanel. */
async function recordSplitAndFinish(page: Page) {
  // Pick a common race distance chip (50m) so `canFinish` becomes true.
  await page.getByRole("button", { name: "50m", exact: true }).first().click();

  // Nudge the video forward a bit so `elapsed` (currentVideoTime - startTime) is > 0
  // before recording a split (Record is enabled once a distance is typed in).
  await page.getByRole("button", { name: /100ms/ }).nth(1).click(); // "+100ms" (2nd of the 4 nudge buttons)
  await page.getByRole("button", { name: /100ms/ }).nth(1).click();

  await page.getByPlaceholder("距離 (m)").fill("50");
  await page.getByRole("button", { name: "Record" }).click();

  await page.getByRole("button", { name: /Finish/ }).click();
}

async function goToExportStepAndStartExport(page: Page) {
  await page.getByRole("button", { name: "書き出し" }).click();
  await expect(page.getByRole("heading", { name: "動画を書き出し" })).toBeVisible();
  await page.getByRole("button", { name: "書き出し MP4" }).click();
}

test.describe("前提: ffmpeg フォールバックの強制発火 (V-01)", () => {
  test("[V-01][V-02][V-07] VideoEncoder/VideoDecoder を削除した状態でも書き出しが完了し、MP4 がダウンロードできる (透かしON)", async ({
    page,
  }) => {
    await forceFfmpegFallback(page);
    await importVideoAndConfirmStart(page);
    await goToExportStepAndStartExport(page);

    // Sprint Contract の期待: ffmpeg フォールバック経由でも最終的にダウンロード可能な状態に
    // 到達する (「エラー」表示にならない)。
    const errorPanel = page.getByText("エラー");
    const downloadButton = page.getByRole("button", { name: /ダウンロード/ });
    await expect(errorPanel.or(downloadButton)).toBeVisible({ timeout: 30_000 });

    await expect(errorPanel).toHaveCount(0);
    await expect(downloadButton).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent("download"), downloadButton.click()]);
    const savedPath = path.join(__dirname, "..", "test-results", "ffmpeg-fallback-output.mp4");
    await download.saveAs(savedPath);

    const fs = await import("node:fs");
    const stat = fs.statSync(savedPath);
    // A 6s/640x360 export with overlay burned in should be a non-trivial MP4 (well above a
    // few KB), which also indicates the ffmpeg overlay/encode step actually ran to
    // completion rather than producing a truncated/empty file.
    expect(stat.size).toBeGreaterThan(10_000);

    await page.screenshot({ path: "test-results/ffmpeg-fallback-export-complete.png", fullPage: true });
  });
});

test.describe("スプリット・フィニッシュサマリーを含む書き出し (V-06/V-08)", () => {
  test("[V-06][V-08] スプリットを記録しフィニッシュした状態で ffmpeg フォールバック書き出しが完了する", async ({
    page,
  }) => {
    await forceFfmpegFallback(page);
    await importVideoAndConfirmStart(page);
    await recordSplitAndFinish(page);
    await goToExportStepAndStartExport(page);

    const errorPanel = page.getByText("エラー");
    const downloadButton = page.getByRole("button", { name: /ダウンロード/ });
    await expect(errorPanel.or(downloadButton)).toBeVisible({ timeout: 30_000 });
    await expect(errorPanel).toHaveCount(0);
    await expect(downloadButton).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent("download"), downloadButton.click()]);
    await download.saveAs(path.join(__dirname, "..", "test-results", "ffmpeg-fallback-output-split-finish.mp4"));
  });
});

test.describe("長尺動画での安定性 (V-17)", () => {
  test(
    "[V-17] 130秒 (連番PNG ~3,900枚 @30fps) の動画を ffmpeg フォールバックで書き出しても" +
      "ハング・クラッシュせず、進捗が滞りなく完了に到達する",
    async ({ page }) => {
      test.setTimeout(180_000);
      await forceFfmpegFallback(page);
      await importVideoAndConfirmStart(page, FIXTURE_LONG);
      await goToExportStepAndStartExport(page);

      const errorPanel = page.getByText("エラー");
      const downloadButton = page.getByRole("button", { name: /ダウンロード/ });
      await expect(errorPanel.or(downloadButton)).toBeVisible({ timeout: 150_000 });
      await expect(errorPanel).toHaveCount(0);
      await expect(downloadButton).toBeVisible();
    },
  );
});
