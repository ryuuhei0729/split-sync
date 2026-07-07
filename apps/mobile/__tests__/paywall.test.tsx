/**
 * Sprint Contract テストスケルトン
 * タスク 1: timer mobile paywall のゲストガード
 *
 * NOTE: このファイルはスケルトンのみ。
 * - 両モバイルアプリには Jest/Vitest が未セットアップのため、
 *   Phase B で Developer がテスト基盤を追加したのち実装する。
 * - React Native Testing Library (@testing-library/react-native) を想定。
 */

import React from "react";
// import { render, screen, fireEvent } from "@testing-library/react-native";
// import PaywallScreen from "../app/(app)/paywall";

// --- モックヘルパー ---
// const mockRouterPush = jest.fn();
// const mockRouterBack = jest.fn();
// jest.mock("expo-router", () => ({
//   useRouter: () => ({ push: mockRouterPush, back: mockRouterBack }),
// }));
// jest.mock("../lib/revenucat", () => ({
//   getOfferings: jest.fn().mockResolvedValue({ current: { monthly: mockPkg, annual: mockPkg } }),
//   purchasePackage: jest.fn(),
//   restorePurchases: jest.fn(),
// }));

// --- ゲスト状態のモック ---
// const guestAuthContext = {
//   subscription: null,
//   guestMode: true,
//   refreshSubscription: jest.fn(),
// };

// --- Free ユーザーのモック ---
// const freeAuthContext = {
//   subscription: { plan: "free", status: null, ... },
//   guestMode: false,
//   refreshSubscription: jest.fn(),
// };

describe("PaywallScreen (timer) - ゲストガード", () => {
  describe("ゲスト状態", () => {
    it.todo("should NOT render purchase button when guestMode is true");

    it.todo("should render login CTA when guestMode is true");

    it.todo("should navigate to /(auth)/get-started when login CTA is pressed");

    it.todo("should NOT call purchasePackage even if handlePurchase is triggered directly");
  });

  describe("Free ユーザー状態", () => {
    it.todo("should render purchase button for free user");

    it.todo("should NOT render login CTA for free user");
  });

  describe("Premium ユーザー状態", () => {
    it.todo("should render already-premium message and NOT render purchase button");
  });

  describe("境界ケース", () => {
    it.todo("should render login CTA when guestMode transitions from false to true");
  });
});
