/**
 * Sprint Contract テストスケルトン
 * タスク 3: timer mobile SplitsPanel のゲスト時遷移先修正
 *
 * NOTE: このファイルはスケルトンのみ。
 * - Jest/Vitest 未セットアップのため Phase B で実装する。
 */

import React from "react";
// import { render, screen, fireEvent } from "@testing-library/react-native";
// import { SplitsPanel } from "../components/splits/SplitsPanel";

// --- ゲスト状態のモック ---
// const guestAuthContext = {
//   subscription: null,
//   guestMode: true,
// };

// --- Free ユーザーのモック ---
// const freeAuthContext = {
//   subscription: { plan: "free" },
//   guestMode: false,
// };

describe("SplitsPanel - ゲスト時遷移先", () => {
  describe("ゲスト状態でスプリット上限に達した場合", () => {
    it.todo("should navigate to /(auth)/get-started when limit banner is pressed by guest");

    it.todo("should NOT navigate to /(app)/paywall when guest taps limit banner");
  });

  describe("Free ユーザーでスプリット上限に達した場合", () => {
    it.todo("should navigate to /(app)/paywall when limit banner is pressed by free user");
  });
});
