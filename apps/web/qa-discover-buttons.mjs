import pkg from "/Users/ryuuhei_0729/SwimHub/swim-hub/node_modules/playwright-core/index.js";
const { chromium } = pkg;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();

await page.goto("http://localhost:3099/ja", { waitUntil: "networkidle", timeout: 15000 });

// Upload video
const fileInput = page.locator('input[type="file"]').first();
await fileInput.setInputFiles("/Users/ryuuhei_0729/SwimHub/swimhub-timer/apps/web/public/test-swim.mp4");
await page.waitForSelector("video", { timeout: 20000 });
await page.waitForTimeout(4000);

// Take screenshot of detect screen
await page.screenshot({ path: "/Users/ryuuhei_0729/SwimHub/swimhub-timer/apps/web/qa-screenshots/detect-screen-wide.png", fullPage: false });
console.log("Screenshot: detect-screen-wide.png");

// Print all visible buttons text
const buttons = await page.locator("button").all();
const buttonTexts = [];
for (const btn of buttons) {
  const text = (await btn.innerText().catch(() => "")).trim();
  const visible = await btn.isVisible().catch(() => false);
  if (text && visible) buttonTexts.push(text);
}
console.log("Visible buttons:", JSON.stringify(buttonTexts, null, 2));

// Print all visible text elements in sidebar
const sidebar = page.locator(".overflow-y-auto").first();
const sidebarText = await sidebar.innerText().catch(() => "N/A");
console.log("\nSidebar text:\n", sidebarText.slice(0, 1000));

await browser.close();
