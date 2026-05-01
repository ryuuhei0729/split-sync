/**
 * Sprint Contract E2E テストスケルトン — Phase A
 * Playwright を使用したドラッグ / タイマー回帰検証
 *
 * 検証対象の Sprint Contract 項目:
 *   V-32: タイマー本体ドラッグの回帰 (raceDistance 実装後も引き続き動く)
 *   V-28: サマリードラッグで summaryPosition が更新される (回帰確認込み)
 *   V-33: タッチ 2本指 pinch で summaryScale が更新される
 *
 * NOTE: Phase A はスケルトンのみ。実装は Phase B で行う。
 */

// Phase B: Playwright をインストール後にコメントアウトを外す
// import { test } from "@playwright/test";

// Phase B で以下を有効化:
// import { expect } from "@playwright/test";
// const BASE_URL = "http://localhost:3000";

test.describe("stopwatch drag regression", () => {
  test.todo(
    "[V-32] startTime 設定後、タイマー表示部分をドラッグすると stopwatchConfig.position が更新される",
  );

  test.todo("[V-32] タイマードラッグ後、位置が 0–1 にクランプされる");

  test.todo("[V-32] タイマードラッグ中に isFinished=true になっても崩れない (境界値)");
});

test.describe("summary drag (integration with stopwatch drag regression)", () => {
  test.todo(
    "[V-28] サマリー表示中 (elapsed >= finishTime+2) にサマリー領域をドラッグすると位置が変わる",
  );

  test.todo("[V-28] サマリー外をクリックすると play/pause がトリガーされる (タイマー本体ドラッグと干渉しない)");

  test.todo("[V-32] サマリー表示中でもタイマー領域をドラッグできる (タイマーが移動する)");
});

test.describe("touch pinch — summaryScale", () => {
  test.todo("[V-33] 2本指 pinch-out でサマリーが拡大する (summaryScale が増加)");

  test.todo("[V-33] 2本指 pinch-in でサマリーが縮小する (summaryScale が減少)");

  test.todo("[V-33] pinch で summaryScale が 0.4 未満にならない");

  test.todo("[V-33] pinch で summaryScale が 3.0 を超えない");
});
