import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright 設定 — swimhub-timer web の実機ブラウザ E2E 用。
 *
 * `e2e/*.spec.ts` のうち以下はまだ `test`/`expect` の import がコメントアウトされた
 * ドキュメント的スケルトンで、実行すると `ReferenceError: test is not defined` で
 * 即死する (import 文があるだけの静的な行と違い、これは実行時に評価されるトップレベルの
 * `test.describe(...)` 呼び出しなので、テストランナーがファイルを読み込んだ瞬間に落ちる)。
 * QA が Phase B で各ファイルの import を有効化するまでは `testIgnore` で除外しておく:
 *   - timer-finish-summary.spec.ts
 *   - timer-overlay-drag.spec.ts
 *   - webcodecs-export.spec.ts
 *   - ffmpeg-fallback-overlay-parity.spec.ts (このスプリントの検証対象本体だが、現時点では
 *     まだ import 未有効化のスケルトンのまま — QA が有効化したらこの一覧から外すこと)
 *
 * WebCodecs/OffscreenCanvas 検証が主目的のため Chromium 系のみを対象とする
 * (Firefox は WebCodecs 非対応、WebKit は挙動差が大きく別途検討)。
 */
const UNACTIVATED_SKELETON_SPECS = [
  "timer-finish-summary.spec.ts",
  "timer-overlay-drag.spec.ts",
  "webcodecs-export.spec.ts",
  // ffmpeg-fallback-overlay-parity.spec.ts: QA が Phase B で test/expect を有効化し
  // 実行可能なテストに整備済みのため、この一覧から除外した (2026-07-08)。
];

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  testIgnore: UNACTIVATED_SKELETON_SPECS,

  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 1,

  reporter: [["list"]],

  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    video: "off",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // ローカル/CI いずれも `next dev` を自動起動する。既存サーバーがあれば再利用する
  // (CI では毎回クリーンに起動するため reuseExistingServer を無効化)。
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },

  expect: {
    timeout: 5 * 1000,
  },
});
