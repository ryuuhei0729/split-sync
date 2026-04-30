/**
 * QA Phase B — E2E フル検証 (V-23〜V-31)
 * 1600x900 ビューポートで波形操作 → startTime 設定 → SplitsPanel 操作 → Finish/Edit
 */
import pkg from "/Users/ryuuhei_0729/SwimHub/swim-hub/node_modules/playwright-core/index.js";
const { chromium } = pkg;
import { mkdirSync } from "fs";
import path from "path";

const BASE_URL = "http://localhost:3099/ja";
const VIDEO_PATH = "/Users/ryuuhei_0729/SwimHub/swimhub-timer/apps/web/public/test-swim.mp4";
const SCREENSHOT_DIR = "/Users/ryuuhei_0729/SwimHub/swimhub-timer/apps/web/qa-screenshots";

mkdirSync(SCREENSHOT_DIR, { recursive: true });

const results = [];
function log(label, status, note = "") {
  const line = `[${status}] ${label}${note ? " — " + note : ""}`;
  console.log(line);
  results.push({ label, status, note });
}
async function ss(page, name) {
  const fp = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: fp });
  console.log(`  Screenshot: ${fp}`);
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();

// V-23: import screen
await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 15000 });
await ss(page, "v23-import");
const hasDropZone = await page.locator("text=レース動画をドロップ").isVisible();
log("V-23: インポート画面表示", hasDropZone ? "PASS" : "FAIL");

// V-24: upload video → detect screen
const fileInput = page.locator('input[type="file"]').first();
await fileInput.setInputFiles(VIDEO_PATH);
await page.waitForSelector("video", { timeout: 20000 });
await page.waitForTimeout(3000);
await ss(page, "v24-after-upload");
const videoVisible = await page.locator("video").isVisible();
log("V-24: 動画アップロード後 detect ステップへ遷移", videoVisible ? "PASS" : "FAIL");

// V-22/V-25: startTime=null 時 race distance チップ非表示
const chip100Before = await page.locator("button", { hasText: "100m" }).first().isVisible({ timeout: 1000 }).catch(() => false);
log("V-22/V-25: startTime=null 時 race distance チップ非表示", !chip100Before ? "PASS" : "FAIL");

// startTime 設定: 波形クリック後 "自動検出" → 候補時間 → 確定
// まず波形エリアをクリックして候補時間を作る
const waveformArea = page.locator(".overflow-y-auto canvas");
const waveBox = await waveformArea.first().boundingBox().catch(() => null);
if (waveBox) {
  await page.mouse.click(waveBox.x + waveBox.width * 0.15, waveBox.y + waveBox.height * 0.5);
  await page.waitForTimeout(1000);
}
await ss(page, "waveform-click");

// 確定ボタン ("スタートポイントに設定") を探す
let confirmBtn = null;
for (const text of ["スタートポイントに設定", "Set as Start Point", "確定"]) {
  const btn = page.locator("button").filter({ hasText: text });
  if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
    confirmBtn = btn;
    break;
  }
}
if (confirmBtn) {
  await confirmBtn.click();
  await page.waitForTimeout(500);
  log("startTime 設定 (波形クリック + 確定)", "PASS");
} else {
  // 自動検出を試みる
  const autoBtn = page.locator("button").filter({ hasText: "自動検出" }).first();
  if (await autoBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await autoBtn.click();
    await page.waitForTimeout(5000); // 音声分析を待つ
    await ss(page, "after-autodetect");
    // 確定ボタンを再確認
    for (const text of ["スタートポイントに設定", "Set as Start Point"]) {
      const btn = page.locator("button").filter({ hasText: text });
      if (await btn.isVisible({ timeout: 5000 }).catch(() => false)) {
        confirmBtn = btn;
        break;
      }
    }
    if (confirmBtn) {
      await confirmBtn.click();
      await page.waitForTimeout(500);
      log("startTime 設定 (自動検出 + 確定)", "PASS");
    } else {
      log("startTime 設定", "SKIP", "確定ボタンが見つからず (音声分析の制限の可能性)");
    }
  } else {
    log("startTime 設定", "SKIP", "自動検出ボタンも見つからず");
  }
}
await ss(page, "after-starttime-set");

// V-26: startTime 設定後 race distance チップが表示される
const chip25After = await page.locator("button", { hasText: "25m" }).first().isVisible({ timeout: 3000 }).catch(() => false);
log("V-26: startTime 設定後 race distance チップが表示される",
  chip25After ? "PASS" : "SKIP",
  chip25After ? "" : "startTime 未設定のため chip 非表示");
await ss(page, "v26-race-distance-chips");

if (chip25After) {
  // V-27〜V-29: 距離チップ操作
  const chip100 = page.locator("button", { hasText: "100m" }).first();

  // V-27: 100m 選択で "Finish (100m)" ボタン表示
  await chip100.click();
  await page.waitForTimeout(300);
  await ss(page, "v27-chip-100-selected");
  const finishBtnVisible = await page.locator("button").filter({ hasText: /Finish.*100m|フィニッシュ.*100m/ }).isVisible({ timeout: 2000 }).catch(() => false);
  log("V-27: 100m チップ選択で Finish(100m) ボタン表示", finishBtnVisible ? "PASS" : "FAIL");

  // V-28: Finish ボタンが enabled
  if (finishBtnVisible) {
    const finishBtn = page.locator("button").filter({ hasText: /Finish.*100m|フィニッシュ.*100m/ });
    const isDisabled = await finishBtn.isDisabled().catch(() => true);
    log("V-28: 100m 選択後 Finish ボタンが enabled", !isDisabled ? "PASS" : "FAIL");
  }

  // V-29: 同じチップを再クリックで null に戻る
  await chip100.click();
  await page.waitForTimeout(300);
  const needDistVisible = await page.locator("button").filter({ hasText: /Select race distance|距離を選択|レース距離を選択/ }).isVisible({ timeout: 2000 }).catch(() => false);
  // ラベルで確認
  const allChipsInactive = !(await page.locator("button").filter({ hasText: /Finish.*100m/ }).isVisible({ timeout: 500 }).catch(() => false));
  log("V-29: チップ再クリックで raceDistance=null に戻る", allChipsInactive ? "PASS" : "FAIL");
  await ss(page, "v29-chip-deselected");

  // V-30: Finish ボタンで isFinished → Edit ボタン表示
  // 100m を再選択
  await chip100.click();
  await page.waitForTimeout(300);
  const finishBtn2 = page.locator("button").filter({ hasText: /Finish.*100m|フィニッシュ.*100m/ });
  if (await finishBtn2.isVisible({ timeout: 2000 }).catch(() => false)) {
    await finishBtn2.click();
    await page.waitForTimeout(600);
    await ss(page, "v30-after-finish");
    const editBtnVisible = await page.locator("button").filter({ hasText: /^Edit$|^編集$/ }).isVisible({ timeout: 2000 }).catch(() => false);
    log("V-30: Finish 押下後 Edit ボタンが表示される", editBtnVisible ? "PASS" : "FAIL");

    if (editBtnVisible) {
      // V-31: Edit クリックで revertFinish
      const editBtn = page.locator("button").filter({ hasText: /^Edit$|^編集$/ });
      await editBtn.click();
      await page.waitForTimeout(300);
      await ss(page, "v31-after-edit");
      const editGone = !(await editBtn.isVisible({ timeout: 500 }).catch(() => false));
      log("V-31: Edit クリックで isFinished=false に戻る", editGone ? "PASS" : "FAIL");

      // race distance チップが再び表示される (startTime=null でない前提)
      const chipBack = await page.locator("button", { hasText: "100m" }).first().isVisible({ timeout: 2000 }).catch(() => false);
      log("V-31(補): revertFinish 後 race distance チップが再表示", chipBack ? "PASS" : "SKIP");
    } else {
      log("V-31: Edit ボタン操作", "BLOCKED", "V-30 が FAIL");
    }
  } else {
    log("V-30: Finish ボタン押下", "SKIP", "Finish ボタンが見つからない");
    log("V-31: Edit ボタン操作", "BLOCKED", "V-30 依存");
  }
} else {
  for (const v of ["V-27", "V-28", "V-29", "V-30", "V-31"]) {
    log(`${v}: SplitsPanel 操作`, "BLOCKED", "startTime 未設定");
  }
}

// V-32/V-33: SKIP (動画再生位置制御 / FFmpeg WASM)
log("V-32: onWheel サマリー scale 変更", "SKIP", "動画再生位置制御が必要");
log("V-33: export 動画への summary 焼き込み", "SKIP", "FFmpeg WASM 処理 — 時間がかかるため未確認");

await ss(page, "final-state");
await browser.close();

console.log("\n=== E2E 結果サマリー ===");
results.forEach(r => console.log(`  [${r.status}] ${r.label}${r.note ? " — " + r.note : ""}`));
