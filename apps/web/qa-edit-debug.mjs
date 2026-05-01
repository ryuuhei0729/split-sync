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

// autodetect + confirm
await page.evaluate(async () => {
  const allBtns = Array.from(document.querySelectorAll("button"));
  const btn = allBtns.filter(b => b.innerText.trim() === "自動検出" && b.getBoundingClientRect().width > 0).pop();
  if (btn) btn.click();
});
await page.waitForTimeout(8000);
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll("button")).find(b => b.innerText.includes("この時刻で確定"));
  if (btn) btn.click();
});
await page.waitForTimeout(500);

// 100m 選択
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll("button")).find(b => b.innerText.trim() === "100m");
  if (btn) btn.click();
});
await page.waitForTimeout(300);

// Finish (100m) をクリック
await page.evaluate(() => {
  const fb = Array.from(document.querySelectorAll("button")).find(b => b.innerText.includes("Finish") && b.innerText.includes("100m"));
  console.log("Finish btn:", fb ? fb.innerText.trim() : "not found");
  if (fb) fb.click();
});
await page.waitForTimeout(1000);

// 全ての DOM 内テキストを確認
const allText = await page.evaluate(() => document.body.innerText.replace(/\n+/g, " | ").slice(0, 500));
console.log("Page text after Finish:", allText);

// 全ボタン
const btns = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("button")).map(b => ({
    text: b.innerText.trim().replace(/\n/g, "|").slice(0, 50),
    disabled: b.disabled,
  })).filter(b => b.text);
});
console.log("All buttons:", JSON.stringify(btns.map(b => b.text)));

await page.screenshot({ path: "/Users/ryuuhei_0729/SwimHub/swimhub-timer/apps/web/qa-screenshots/edit-debug.png" });
await browser.close();
