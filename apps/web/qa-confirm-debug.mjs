/**
 * 確定ボタン特定デバッグ
 */
import pkg from "/Users/ryuuhei_0729/SwimHub/swim-hub/node_modules/playwright-core/index.js";
const { chromium } = pkg;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();

await page.goto("http://localhost:3099/ja", { waitUntil: "networkidle", timeout: 15000 });
const fileInput = page.locator('input[type="file"]').first();
await fileInput.setInputFiles("/Users/ryuuhei_0729/SwimHub/swimhub-timer/apps/web/public/test-swim.mp4");
await page.waitForSelector("video", { timeout: 20000 });
await page.waitForTimeout(4000);

// 自動検出をクリック
await page.evaluate(async () => {
  const allBtns = Array.from(document.querySelectorAll("button"));
  const btn = allBtns.find(b => {
    const r = b.getBoundingClientRect();
    return b.innerText.trim() === "自動検出" && r.width > 0 && r.height > 0;
  });
  if (btn) btn.click();
});
await page.waitForTimeout(8000);

// 全ボタンをリスト
const btns = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("button")).map(b => ({
    text: b.innerText.trim().slice(0, 60).replace(/\n/g, " | "),
    rect: b.getBoundingClientRect(),
    disabled: b.disabled,
  })).filter(b => b.text);
});
console.log("All buttons after autodetect:");
btns.forEach(b => console.log(`  [${b.rect.width > 0 ? "visible" : "hidden"}] "${b.text}" disabled=${b.disabled}`));

// スタートポイントに設定 を直接 evaluate でクリック
const clicked = await page.evaluate(async () => {
  const allBtns = Array.from(document.querySelectorAll("button"));
  for (const b of allBtns) {
    if (b.innerText.trim().includes("スタートポイント")) {
      b.scrollIntoView({ block: "center", behavior: "instant" });
      await new Promise(r => setTimeout(r, 200));
      const r = b.getBoundingClientRect();
      console.log("Found btn rect:", JSON.stringify(r));
      b.click();
      return b.innerText.trim();
    }
  }
  return null;
});
console.log("Clicked:", clicked);
await page.waitForTimeout(500);

// チップが表示されるか
const chipExists = await page.evaluate(() => {
  const allBtns = Array.from(document.querySelectorAll("button"));
  return allBtns.some(b => b.innerText.trim() === "100m" && b.getBoundingClientRect().width > 0);
});
console.log("100m chip visible:", chipExists);

await page.screenshot({ path: "/Users/ryuuhei_0729/SwimHub/swimhub-timer/apps/web/qa-screenshots/confirm-debug.png" });
await browser.close();
