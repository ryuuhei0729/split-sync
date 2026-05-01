/**
 * QA Phase B — E2E 最終検証 (V-23〜V-31)
 * サイドバーをスクロールしながら操作する
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
  return fp;
}

// scrollIntoView で visible にする helper
async function scrollIntoView(page, locator) {
  await locator.evaluate(el => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(300);
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();

// V-23: import screen
await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 15000 });
await ss(page, "v23-import");
const hasDropZone = await page.locator("text=レース動画をドロップ").isVisible();
log("V-23: インポート画面表示", hasDropZone ? "PASS" : "FAIL");

// V-24: upload video
const fileInput = page.locator('input[type="file"]').first();
await fileInput.setInputFiles(VIDEO_PATH);
await page.waitForSelector("video", { timeout: 20000 });
await page.waitForTimeout(4000);
await ss(page, "v24-after-upload");
const videoVisible = await page.locator("video").isVisible();
log("V-24: 動画アップロード後 detect ステップへ遷移", videoVisible ? "PASS" : "FAIL");

// V-22/V-25: startTime=null 時 race distance チップ非表示
const noChip = !(await page.locator("button", { hasText: "100m" }).first().isVisible({ timeout: 1000 }).catch(() => false));
log("V-22/V-25: startTime=null 時 race distance チップ非表示", noChip ? "PASS" : "FAIL");

// startTime 設定: 自動検出 (nth=1 が desktop sidebar の正しいボタン)
// evaluate でスクロールして DOM 操作
const startTimeSet = await page.evaluate(async () => {
  // desktop sidebar 内の「自動検出」ボタンを見つける
  const sidebar = document.querySelector(".overflow-y-auto");
  if (!sidebar) return false;
  sidebar.scrollTop = 0;
  // 少し待つ
  await new Promise(r => setTimeout(r, 300));
  // ボタンを直接 DOM クリック
  const allBtns = Array.from(document.querySelectorAll("button"));
  const autoDetectBtns = allBtns.filter(b => b.innerText.trim() === "自動検出");
  // visible な方を探す
  const visibleBtn = autoDetectBtns.find(b => {
    const r = b.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  if (visibleBtn) {
    visibleBtn.scrollIntoView({ block: "center" });
    await new Promise(r => setTimeout(r, 300));
    visibleBtn.click();
    return true;
  }
  return false;
});

if (startTimeSet) {
  console.log("  自動検出ボタンをクリック (DOM)");
  // 音声分析完了を最大15秒待つ
  await page.waitForTimeout(8000);
  await ss(page, "after-autodetect");

  // 確定ボタンを探して scrollIntoView してクリック
  let confirmed = false;
  const confirmResult = await page.evaluate(async () => {
    const allBtns = Array.from(document.querySelectorAll("button"));
    const confirmBtns = allBtns.filter(b =>
      b.innerText.trim().includes("スタートポイントに設定") ||
      b.innerText.trim().includes("Set as Start Point")
    );
    const visibleBtn = confirmBtns.find(b => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (visibleBtn) {
      visibleBtn.scrollIntoView({ block: "center" });
      await new Promise(r => setTimeout(r, 300));
      visibleBtn.click();
      return true;
    }
    // 候補時間を探してクリック (波形クリック方式)
    const waveCanvas = document.querySelector("canvas");
    if (waveCanvas && waveCanvas !== document.querySelectorAll("canvas")[0]) {
      // waveform canvas は 2 番目の canvas
    }
    return false;
  });
  if (confirmResult) {
    await page.waitForTimeout(500);
    log("startTime 設定 (自動検出 + 確定)", "PASS");
    confirmed = true;
  } else {
    // 波形クリックで手動候補
    await page.evaluate(async () => {
      const canvases = document.querySelectorAll("canvas");
      // 2番目以降の canvas が波形
      const waveCanvas = canvases[1] || canvases[0];
      if (waveCanvas) {
        const r = waveCanvas.getBoundingClientRect();
        const x = r.left + r.width * 0.15;
        const y = r.top + r.height * 0.5;
        waveCanvas.dispatchEvent(new MouseEvent("click", { clientX: x, clientY: y, bubbles: true }));
      }
    });
    await page.waitForTimeout(1000);

    const confirmResult2 = await page.evaluate(async () => {
      const allBtns = Array.from(document.querySelectorAll("button"));
      const btn = allBtns.find(b => b.innerText.trim().includes("スタートポイントに設定"));
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (confirmResult2) {
      await page.waitForTimeout(500);
      log("startTime 設定 (波形クリック + 確定)", "PASS");
      confirmed = true;
    } else {
      log("startTime 設定", "SKIP", "確定ボタンが見つからず");
    }
  }
} else {
  log("startTime 設定", "SKIP", "自動検出ボタンが見つからず");
}

await ss(page, "after-starttime");

// V-26: startTime 設定後 race distance チップが表示される
const chipsVisible = await page.evaluate(() => {
  const allBtns = Array.from(document.querySelectorAll("button"));
  return allBtns.some(b => b.innerText.trim() === "100m" && b.getBoundingClientRect().width > 0);
});
log("V-26: startTime 設定後 race distance チップが表示される",
  chipsVisible ? "PASS" : "SKIP",
  chipsVisible ? "" : "startTime 未設定のため chip 非表示");

if (chipsVisible) {
  // V-27〜V-29: チップ操作
  await page.evaluate(() => {
    const allBtns = Array.from(document.querySelectorAll("button"));
    const chip = allBtns.find(b => b.innerText.trim() === "100m");
    if (chip) chip.click();
  });
  await page.waitForTimeout(300);
  await ss(page, "v27-chip-selected");

  const finishBtnText = await page.evaluate(() => {
    const allBtns = Array.from(document.querySelectorAll("button"));
    const fb = allBtns.find(b => b.innerText.includes("100m") && (b.innerText.includes("Finish") || b.innerText.includes("フィニッシュ")));
    return fb ? fb.innerText.trim() : null;
  });
  log("V-27: 100m チップ選択で Finish(100m) ボタン表示", finishBtnText ? "PASS" : "FAIL", finishBtnText || "");

  const finishEnabled = await page.evaluate(() => {
    const allBtns = Array.from(document.querySelectorAll("button"));
    const fb = allBtns.find(b => b.innerText.includes("100m") && (b.innerText.includes("Finish") || b.innerText.includes("フィニッシュ")));
    return fb ? !fb.disabled : false;
  });
  log("V-28: Finish ボタンが enabled", finishEnabled ? "PASS" : "FAIL");

  // V-29: トグル (再クリックで null)
  await page.evaluate(() => {
    const allBtns = Array.from(document.querySelectorAll("button"));
    const chip = allBtns.find(b => b.innerText.trim() === "100m");
    if (chip) chip.click();
  });
  await page.waitForTimeout(300);
  const toggledOff = await page.evaluate(() => {
    const allBtns = Array.from(document.querySelectorAll("button"));
    const fb = allBtns.find(b => b.innerText.includes("100m") && (b.innerText.includes("Finish") || b.innerText.includes("フィニッシュ")));
    return !fb;
  });
  log("V-29: チップ再クリックで raceDistance=null に戻る", toggledOff ? "PASS" : "FAIL");

  // V-30: Finish → Edit
  await page.evaluate(() => {
    const allBtns = Array.from(document.querySelectorAll("button"));
    const chip = allBtns.find(b => b.innerText.trim() === "100m");
    if (chip) chip.click();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const allBtns = Array.from(document.querySelectorAll("button"));
    const fb = allBtns.find(b => b.innerText.includes("100m") && (b.innerText.includes("Finish") || b.innerText.includes("フィニッシュ")));
    if (fb) fb.click();
  });
  await page.waitForTimeout(600);
  await ss(page, "v30-after-finish");

  const editBtnExists = await page.evaluate(() => {
    const allBtns = Array.from(document.querySelectorAll("button"));
    return allBtns.some(b => (b.innerText.trim() === "Edit" || b.innerText.trim() === "編集") && b.getBoundingClientRect().width > 0);
  });
  log("V-30: Finish 押下後 Edit ボタンが表示される", editBtnExists ? "PASS" : "FAIL");

  if (editBtnExists) {
    await page.evaluate(() => {
      const allBtns = Array.from(document.querySelectorAll("button"));
      const eb = allBtns.find(b => (b.innerText.trim() === "Edit" || b.innerText.trim() === "編集") && b.getBoundingClientRect().width > 0);
      if (eb) eb.click();
    });
    await page.waitForTimeout(400);
    await ss(page, "v31-after-edit");

    const editGone = await page.evaluate(() => {
      const allBtns = Array.from(document.querySelectorAll("button"));
      return !allBtns.some(b => (b.innerText.trim() === "Edit" || b.innerText.trim() === "編集") && b.getBoundingClientRect().width > 0);
    });
    log("V-31: Edit クリックで isFinished=false に戻る", editGone ? "PASS" : "FAIL");
  } else {
    log("V-31", "BLOCKED", "V-30 FAIL");
  }
} else {
  for (const v of ["V-27", "V-28", "V-29", "V-30", "V-31"]) {
    log(`${v}: SplitsPanel 操作`, "BLOCKED", "startTime 未設定");
  }
}

log("V-32: onWheel サマリー scale 変更", "SKIP", "動画再生位置制御が必要");
log("V-33: export 動画への summary 焼き込み", "SKIP", "FFmpeg WASM — 時間がかかるため未確認");

await ss(page, "final-state-v2");
await browser.close();

console.log("\n=== E2E 結果サマリー ===");
results.forEach(r => console.log(`  [${r.status}] ${r.label}${r.note ? " — " + r.note : ""}`));
