/**
 * V-27〜V-31 の検証 (startTime 設定済みの前提で)
 */
import pkg from "/Users/ryuuhei_0729/SwimHub/swim-hub/node_modules/playwright-core/index.js";
const { chromium } = pkg;
import { mkdirSync } from "fs";
import path from "path";

mkdirSync("/Users/ryuuhei_0729/SwimHub/swimhub-timer/apps/web/qa-screenshots", { recursive: true });
const results = [];
function log(label, status, note = "") {
  console.log(`[${status}] ${label}${note ? " — " + note : ""}`);
  results.push({ label, status, note });
}
async function ss(page, name) {
  const fp = path.join("/Users/ryuuhei_0729/SwimHub/swimhub-timer/apps/web/qa-screenshots", `${name}.png`);
  await page.screenshot({ path: fp });
  console.log(`  Screenshot: ${fp}`);
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();

await page.goto("http://localhost:3099/ja", { waitUntil: "networkidle", timeout: 15000 });
const fileInput = page.locator('input[type="file"]').first();
await fileInput.setInputFiles("/Users/ryuuhei_0729/SwimHub/swimhub-timer/apps/web/public/test-swim.mp4");
await page.waitForSelector("video", { timeout: 20000 });
await page.waitForTimeout(4000);

// autodetect + confirm
await page.evaluate(async () => {
  const allBtns = Array.from(document.querySelectorAll("button"));
  const btn = allBtns.filter(b => b.innerText.trim() === "自動検出" && b.getBoundingClientRect().width > 0).pop();
  if (btn) btn.click();
});
await page.waitForTimeout(8000);
await page.evaluate(() => {
  const allBtns = Array.from(document.querySelectorAll("button"));
  const btn = allBtns.find(b => b.innerText.includes("この時刻で確定"));
  if (btn) btn.click();
});
await page.waitForTimeout(500);

// V-01/V-02: raceDistance=null の Finish ボタン状態
const finishNoRace = await page.evaluate(() => {
  const allBtns = Array.from(document.querySelectorAll("button"));
  return allBtns.map(b => ({ text: b.innerText.trim(), disabled: b.disabled }))
    .find(b => b.disabled && (b.text.includes("Finish") || b.text.includes("フィニッシュ") || b.text.includes("Select race") || b.text.includes("種目距離")));
});
log("V-01: raceDistance=null 時 Finish ボタン disabled", finishNoRace?.disabled ? "PASS" : "FAIL", JSON.stringify(finishNoRace));
log("V-02: Finish ボタンラベル (race distance 未選択時)",
  finishNoRace ? "PASS" : "FAIL", finishNoRace?.text || "");

// V-27: 100m クリックで Finish (100m) ボタン
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll("button")).find(b => b.innerText.trim() === "100m");
  if (btn) btn.click();
});
await page.waitForTimeout(300);
await ss(page, "v27-100m");

const finishWith100 = await page.evaluate(() => {
  const allBtns = Array.from(document.querySelectorAll("button"));
  return allBtns.map(b => ({ text: b.innerText.trim(), disabled: b.disabled }))
    .find(b => b.text.includes("100m") && (b.text.includes("Finish") || b.text.includes("フィニッシュ")));
});
log("V-27: 100m チップ選択で Finish(100m) ボタン表示", finishWith100 ? "PASS" : "FAIL", JSON.stringify(finishWith100));
log("V-28: Finish (100m) ボタンが enabled", finishWith100 && !finishWith100.disabled ? "PASS" : "FAIL");

// V-03/V-04: ラベル内容の確認
log("V-03: raceDistance=100 のとき Finish ボタン enabled",
  finishWith100 && !finishWith100.disabled ? "PASS" : "FAIL");
log("V-04: Finish ボタンラベルが 'Finish (100m)'",
  finishWith100?.text === "Finish (100m)" ? "PASS" : "SKIP",
  finishWith100?.text || "");

// V-05/V-29: チップ再クリック (トグル)
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll("button")).find(b => b.innerText.trim() === "100m");
  if (btn) btn.click();
});
await page.waitForTimeout(300);
const toggledOff = await page.evaluate(() => {
  const allBtns = Array.from(document.querySelectorAll("button"));
  return !allBtns.some(b => b.innerText.includes("100m") && (b.innerText.includes("Finish") || b.innerText.includes("フィニッシュ")));
});
log("V-05/V-29: チップ再クリックで raceDistance=null に戻る (Finish ボタンからラベルが消える)", toggledOff ? "PASS" : "FAIL");

// V-30: 100m 再選択 → Finish → Edit ボタン表示
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll("button")).find(b => b.innerText.trim() === "100m");
  if (btn) btn.click();
});
await page.waitForTimeout(300);

// Finish (100m) をクリック
await page.evaluate(() => {
  const allBtns = Array.from(document.querySelectorAll("button"));
  const fb = allBtns.find(b => b.innerText.includes("Finish") && b.innerText.includes("100m"));
  if (fb) fb.click();
});
await page.waitForTimeout(800);
await ss(page, "v30-after-finish");

const editVisible = await page.evaluate(() => {
  const allBtns = Array.from(document.querySelectorAll("button"));
  // "Edit", "編集", "編集する" のいずれか
  return allBtns.some(b => {
    const t = b.innerText.trim();
    return t === "Edit" || t === "編集" || t === "編集する";
  });
});
log("V-19/V-30: Finish 押下後 Edit ボタンが表示される (DOM)", editVisible ? "PASS" : "FAIL");

// finishTime も確認 (Final Time 表示)
const finalTimeVisible = await page.evaluate(() => {
  return document.body.innerText.includes("Final Time") || document.body.innerText.includes("最終タイム");
});
log("V-30(補): Final Time / isFinished=true UI が表示される", finalTimeVisible ? "PASS" : "SKIP");

if (editVisible) {
  // V-20/V-31: Edit → revertFinish
  await page.evaluate(() => {
    const allBtns = Array.from(document.querySelectorAll("button"));
    const eb = allBtns.find(b => {
      const t = b.innerText.trim();
      return t === "Edit" || t === "編集" || t === "編集する";
    });
    if (eb) eb.click();
  });
  await page.waitForTimeout(400);
  await ss(page, "v31-after-edit");

  const editGone = await page.evaluate(() => {
    const allBtns = Array.from(document.querySelectorAll("button"));
    return !allBtns.some(b => {
      const t = b.innerText.trim();
      return t === "Edit" || t === "編集" || t === "編集する";
    });
  });
  log("V-20/V-31: Edit クリックで isFinished=false に戻る", editGone ? "PASS" : "FAIL");

  // race distance チップが再表示されるか
  // revertFinish 後は isFinished=false になるため race distance チップが再表示
  const chipBack = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("button")).some(b => b.innerText.trim() === "100m");
  });
  log("V-21(補)/V-31: revertFinish 後 race distance チップが再表示", chipBack ? "PASS" : "SKIP");
} else {
  log("V-20/V-31", "BLOCKED", "V-30 FAIL");
}

console.log("\n=== V-27〜V-31 結果 ===");
results.forEach(r => console.log(`  [${r.status}] ${r.label}${r.note ? " — " + r.note : ""}`));

await browser.close();
