/**
 * Sprint Contract E2E テストスケルトン — Phase A
 * Playwright を使用したフロー検証
 *
 * 検証対象の Sprint Contract 項目:
 *   V-01/V-03: raceDistance 選択 → Finish ボタン enable/disable
 *   V-02/V-04: Finish ボタンラベルの切り替え
 *   V-08: finishRecording で auto-split が追加される
 *   V-23: isFinished + elapsed >= finishTime+2 でプレビューにサマリーが表示される
 *   V-24: isFinished + elapsed < finishTime+2 ではサマリー非表示
 *   V-25: サマリー表示中はタイマー非表示
 *   V-11: Edit ボタンクリックで revertFinish — isFinished=false に戻る
 *   V-26: export 動画にサマリーが焼き込まれる (手動検証: 自動化困難)
 *   V-27: isFinished=false での export にサマリーなし (手動検証: 自動化困難)
 *
 * NOTE: Phase A はスケルトンのみ。実装は Phase B で行う。
 * test.todo で構造のみ定義する。
 *
 * 前提:
 *   - pnpm dev でローカルサーバーが起動していること (http://localhost:3000)
 *   - テスト用の短い mp4 ファイルが fixtures/ に置かれること (Phase B で準備)
 */

// Phase B: Playwright をインストール後にコメントアウトを外す
// import { test } from "@playwright/test";

// Phase B で以下を有効化:
// import { expect } from "@playwright/test";
// const BASE_URL = "http://localhost:3000";
// const TEST_VIDEO_PATH = "e2e/fixtures/test-race-short.mp4";

test.describe("raceDistance selection — Finish button state", () => {
  test.todo("[V-01][V-02] raceDistance 未選択時: Finish ボタンが disabled で \"Select race distance\" と表示される");

  test.todo("[V-03][V-04] raceDistance=100m 選択後: Finish ボタンが enabled で \"Finish (100m)\" と表示される");

  test.todo("[V-05] 同じチップを再クリックすると deselect され Finish ボタンが disabled に戻る");
});

test.describe("finishRecording — auto-split and finish flow", () => {
  test.todo(
    "[V-08] raceDistance=100m を選択して Finish を押すと splitTimes に 100m の auto-split が追加される",
  );

  test.todo("[V-08] Finish 後 isFinished=true になり \"Final Time\" が表示される");

  test.todo("[V-08] 既存の 100m split がある状態で Finish を押すと重複せず 1 件に保たれる");
});

test.describe("canvas — finish summary display", () => {
  test.todo(
    "[V-23] Finish 後、動画位置を finishTime+2秒 以降にシークするとキャンバスにサマリーが描画される (スクリーンショットで確認)",
  );

  test.todo(
    "[V-24] Finish 後、動画位置が finishTime+2秒 未満のときサマリーは表示されず通常タイマーが表示される",
  );

  test.todo("[V-25] サマリー表示中は通常タイマー (stopwatch テキスト) が非表示になる");
});

test.describe("Edit button — revertFinish", () => {
  test.todo(
    "[V-19] Finish 後に Edit ボタンが表示される",
  );

  test.todo(
    "[V-11] Edit ボタンをクリックすると isFinished=false に戻り race distance チップが再表示される",
  );

  test.todo(
    "[V-11] revertFinish 後、auto-added split (100m) が splitTimes から削除されている",
  );

  test.todo("[V-11] revertFinish 後に再度 Finish を実行できる (往復テスト)");
});

test.describe("canvas — summary drag", () => {
  test.todo(
    "[V-28] サマリー表示中にキャンバス上でドラッグすると summaryPosition が更新される (ドラッグ前後でサマリー位置が変化)",
  );

  test.todo(
    "[V-29] ドラッグでサマリーをキャンバス端まで移動しても位置が 0–1 にクランプされる",
  );
});

test.describe("canvas wheel — summaryScale", () => {
  test.todo("[V-30] サマリー表示中にマウスホイール下回転で summaryScale が縮小する");

  test.todo("[V-30] summaryScale が 0.4 を下回らない (クランプ)");

  test.todo("[V-31] マウスホイール上回転で summaryScale が拡大する");

  test.todo("[V-31] summaryScale が 3.0 を超えない (クランプ)");
});
