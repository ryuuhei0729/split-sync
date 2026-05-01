/**
 * startTime 設定フローのデバッグ
 */
import pkg from "/Users/ryuuhei_0729/SwimHub/swim-hub/node_modules/playwright-core/index.js";
const { chromium } = pkg;
import { mkdirSync } from "fs";

mkdirSync("/Users/ryuuhei_0729/SwimHub/swimhub-timer/apps/web/qa-screenshots", { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();

// ページコンソールをキャプチャ
page.on("console", msg => console.log("BROWSER:", msg.type(), msg.text()));

await page.goto("http://localhost:3099/ja", { waitUntil: "networkidle", timeout: 15000 });

const fileInput = page.locator('input[type="file"]').first();
await fileInput.setInputFiles("/Users/ryuuhei_0729/SwimHub/swimhub-timer/apps/web/public/test-swim.mp4");
await page.waitForSelector("video", { timeout: 20000 });
await page.waitForTimeout(3000);

// 全ての button の innerText をリスト
const allBtns = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll("button"));
  return btns.map(b => ({
    text: b.innerText.trim().slice(0, 50),
    visible: b.offsetParent !== null,
    disabled: b.disabled,
  })).filter(b => b.text);
});
console.log("All buttons after upload:", JSON.stringify(allBtns, null, 2));

// 音声解析の状態を確認 (audioBuffer が null かどうか)
const audioAnalyzeBtn = page.locator("button").filter({ hasText: "自動検出" });
const count = await audioAnalyzeBtn.count();
console.log("自動検出 button count:", count);

// ボタンを直接クリック試行
if (count > 0) {
  const box = await audioAnalyzeBtn.first().boundingBox();
  console.log("自動検出 bounding box:", JSON.stringify(box));
  await audioAnalyzeBtn.first().click({ force: true });
  await page.waitForTimeout(6000);

  await page.screenshot({ path: "/Users/ryuuhei_0729/SwimHub/swimhub-timer/apps/web/qa-screenshots/after-autodetect-force.png" });

  const btns2 = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    return btns.map(b => ({
      text: b.innerText.trim().slice(0, 50),
      visible: b.offsetParent !== null,
    })).filter(b => b.text && b.visible);
  });
  console.log("Buttons after autodetect:", JSON.stringify(btns2.map(b => b.text)));
} else {
  // スクロールして探す
  await page.evaluate(() => {
    const sidebar = document.querySelector(".overflow-y-auto");
    if (sidebar) sidebar.scrollTop = 0;
  });
  await page.waitForTimeout(500);
  const count2 = await audioAnalyzeBtn.count();
  console.log("After scroll, 自動検出 button count:", count2);
}

await browser.close();
