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

// autodetect
await page.evaluate(async () => {
  const allBtns = Array.from(document.querySelectorAll("button"));
  const btn = allBtns.filter(b => b.innerText.trim() === "自動検出" && b.getBoundingClientRect().width > 0).pop();
  if (btn) btn.click();
});
await page.waitForTimeout(8000);

// confirm
await page.evaluate(() => {
  const allBtns = Array.from(document.querySelectorAll("button"));
  const btn = allBtns.find(b => b.innerText.includes("この時刻で確定"));
  if (btn) btn.click();
});
await page.waitForTimeout(500);

// chips check
const chips = await page.evaluate(() => {
  const allBtns = Array.from(document.querySelectorAll("button"));
  return allBtns.filter(b => /^\d+m$/.test(b.innerText.trim())).map(b => b.innerText.trim());
});
console.log("Distance chips:", chips);

// click 100m
await page.evaluate(() => {
  const allBtns = Array.from(document.querySelectorAll("button"));
  const btn = allBtns.find(b => b.innerText.trim() === "100m");
  if (btn) { console.log("clicking 100m"); btn.click(); }
});
await page.waitForTimeout(500);

// all buttons after 100m click
const btns = await page.evaluate(() => {
  return Array.from(document.querySelectorAll("button")).map(b => ({
    text: b.innerText.trim().replace(/\n/g, " | ").slice(0, 60),
    disabled: b.disabled,
    visible: b.getBoundingClientRect().width > 0,
  })).filter(b => b.text && b.visible);
});
console.log("All visible buttons after 100m click:");
btns.forEach(b => console.log(`  [${b.disabled ? "disabled" : "enabled"}] "${b.text}"`));

await page.screenshot({ path: "/Users/ryuuhei_0729/SwimHub/swimhub-timer/apps/web/qa-screenshots/v27-debug.png" });
await browser.close();
