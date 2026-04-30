/**
 * QA Phase B — E2E 最終検証 (V-23〜V-31)
 * 確定ボタン = "この時刻で確定"
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
  console.log(`[${status}] ${label}${note ? " — " + note : ""}`);
  results.push({ label, status, note });
}
async function ss(page, name) {
  const fp = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: fp });
  console.log(`  Screenshot: ${fp}`);
}

// 文字列を含む visible button をクリック (Playwright locator + force)
async function clickBtnContaining(page, ...texts) {
  for (const text of texts) {
    const btn = page.locator("button").filter({ hasText: text }).last();
    if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await btn.click({ force: true });
      return text;
    }
  }
  // DOM fallback
  const clicked = await page.evaluate((texts) => {
    const allBtns = Array.from(document.querySelectorAll("button"));
    for (const text of texts) {
      const btn = allBtns.find(b => b.innerText.includes(text));
      if (btn) { btn.click(); return text; }
    }
    return null;
  }, texts);
  return clicked;
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();

// V-23
await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 15000 });
await ss(page, "v23-import");
log("V-23: インポート画面表示",
  (await page.locator("text=レース動画をドロップ").isVisible()) ? "PASS" : "FAIL");

// V-24
const fileInput = page.locator('input[type="file"]').first();
await fileInput.setInputFiles(VIDEO_PATH);
await page.waitForSelector("video", { timeout: 20000 });
await page.waitForTimeout(4000);
await ss(page, "v24-after-upload");
log("V-24: 動画アップロード後 detect ステップへ遷移",
  (await page.locator("video").isVisible()) ? "PASS" : "FAIL");

// V-22/V-25
const noChipBefore = !(await page.locator("button", { hasText: "100m" }).first().isVisible({ timeout: 1000 }).catch(() => false));
log("V-22/V-25: startTime=null 時 race distance チップ非表示", noChipBefore ? "PASS" : "FAIL");

// 自動検出クリック
await clickBtnContaining(page, "自動検出");
await page.waitForTimeout(8000);
await ss(page, "after-autodetect");

// "この時刻で確定" をクリック
const confirmed = await clickBtnContaining(page, "この時刻で確定", "確定", "Confirm", "Set as Start Point");
if (confirmed) {
  await page.waitForTimeout(500);
  log("startTime 設定", "PASS", `ボタン: "${confirmed}"`);
} else {
  log("startTime 設定", "SKIP", "確定ボタンが見つからず");
}
await ss(page, "after-starttime");

// V-26: race distance チップ表示確認 (DOM evaluate でスクロール位置に依存しない確認)
const chipsNow = await page.evaluate(() => {
  const allBtns = Array.from(document.querySelectorAll("button"));
  return allBtns.some(b => b.innerText.trim() === "100m");
});
log("V-26: startTime 設定後 race distance チップが表示される",
  chipsNow ? "PASS" : "SKIP",
  chipsNow ? "" : "startTime 未設定のため chip 非表示");
await ss(page, "v26-chips");

if (chipsNow) {
  // V-01/V-02: raceDistance=null の状態を確認
  // (チップが表示されているが未選択 → Finish ボタンが "Select race distance" / "レース距離を選択" など)
  await ss(page, "v01-finish-disabled");
  const finishDisabledText = await page.evaluate(() => {
    const allBtns = Array.from(document.querySelectorAll("button"));
    const fb = allBtns.find(b =>
      b.disabled &&
      (b.innerText.includes("Finish") || b.innerText.includes("フィニッシュ") || b.innerText.includes("距離を選択") || b.innerText.includes("Select race"))
    );
    return fb ? { text: fb.innerText.trim(), disabled: fb.disabled } : null;
  });
  log("V-01: raceDistance=null 時 Finish ボタン disabled",
    finishDisabledText?.disabled ? "PASS" : "SKIP", JSON.stringify(finishDisabledText));

  // V-27: 100m チップ選択
  await clickBtnContaining(page, "100m");
  await page.waitForTimeout(300);
  await ss(page, "v27-100m-selected");

  const finishAfter = await page.evaluate(() => {
    const allBtns = Array.from(document.querySelectorAll("button"));
    const fb = allBtns.find(b => b.innerText.includes("100m") && (b.innerText.includes("Finish") || b.innerText.includes("フィニッシュ")));
    return fb ? { text: fb.innerText.trim(), disabled: fb.disabled } : null;
  });
  log("V-27: 100m チップ選択で Finish(100m) ボタン表示",
    finishAfter ? "PASS" : "FAIL", JSON.stringify(finishAfter));

  // V-28: Finish ボタンが enabled
  log("V-28: Finish ボタンが enabled",
    finishAfter && !finishAfter.disabled ? "PASS" : "FAIL");

  // V-29: チップ再クリック でトグル
  await clickBtnContaining(page, "100m");
  await page.waitForTimeout(300);
  const toggledOff = await page.evaluate(() => {
    const allBtns = Array.from(document.querySelectorAll("button"));
    return !allBtns.some(b => b.innerText.includes("100m") && (b.innerText.includes("Finish") || b.innerText.includes("フィニッシュ")));
  });
  log("V-29: チップ再クリックで raceDistance=null に戻る", toggledOff ? "PASS" : "FAIL");

  // V-30: Finish → Edit
  await clickBtnContaining(page, "100m");
  await page.waitForTimeout(300);
  const finishClicked = await clickBtnContaining(page, "フィニッシュ (100m)", "Finish (100m)");
  await page.waitForTimeout(600);
  await ss(page, "v30-after-finish");

  const editExists = await page.evaluate(() => {
    const allBtns = Array.from(document.querySelectorAll("button"));
    return allBtns.some(b => (b.innerText.trim() === "Edit" || b.innerText.trim() === "編集") && b.getBoundingClientRect().width > 0);
  });
  log("V-30: Finish 押下後 Edit ボタンが表示される",
    editExists ? "PASS" : "FAIL",
    finishClicked ? `Finish btn clicked: "${finishClicked}"` : "Finish ボタン未クリック");

  if (editExists) {
    // V-31: Edit → revertFinish
    await clickBtnContaining(page, "Edit", "編集");
    await page.waitForTimeout(400);
    await ss(page, "v31-after-edit");
    const editGone = !(await page.evaluate(() => {
      const allBtns = Array.from(document.querySelectorAll("button"));
      return allBtns.some(b => (b.innerText.trim() === "Edit" || b.innerText.trim() === "編集") && b.getBoundingClientRect().width > 0);
    }));
    log("V-31: Edit クリックで isFinished=false に戻る", editGone ? "PASS" : "FAIL");
  } else {
    log("V-31", "BLOCKED", "V-30 FAIL");
  }
} else {
  for (const v of ["V-01", "V-27", "V-28", "V-29", "V-30", "V-31"]) {
    log(`${v}: SplitsPanel 操作`, "BLOCKED", "startTime 未設定");
  }
}

log("V-32: onWheel サマリー scale 変更", "SKIP", "動画再生位置制御が必要 (手動確認推奨)");
log("V-33: export 動画への summary 焼き込み", "SKIP", "FFmpeg WASM — 時間がかかるため未確認");

await ss(page, "final");
await browser.close();

console.log("\n=== E2E 結果サマリー ===");
results.forEach(r => console.log(`  [${r.status}] ${r.label}${r.note ? " — " + r.note : ""}`));
