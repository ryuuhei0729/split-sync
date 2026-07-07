/**
 * Sprint Contract テストスケルトン
 * タスク 4: timer mobile AuthGate の自動ゲストモード廃止
 *
 * NOTE: このファイルはスケルトンのみ。
 * - Jest/Vitest 未セットアップのため Phase B で実装する。
 */

import React from "react";
// import { render } from "@testing-library/react-native";
// import RootLayout (AuthGate 部分) from "../app/_layout";

// AuthGate は _layout.tsx 内の内部コンポーネントのため、
// 統合テストとして RootLayout をレンダリングして検証する。

// --- 未認証・非ゲストのモック ---
// const unauthenticatedContext = {
//   user: null,
//   isAuthenticated: false,
//   guestMode: false,
//   loading: false,
//   continueAsGuest: jest.fn(),
// };

describe("AuthGate - 自動ゲストモード廃止", () => {
  describe("未認証・非ゲストで (app) グループにアクセスした場合", () => {
    it.todo("should redirect to /(auth)/get-started instead of calling continueAsGuest automatically");

    it.todo("should NOT call continueAsGuest automatically on app startup");
  });

  describe("ゲストで続けるボタンが get-started 画面にある場合", () => {
    it.todo("should render 'continue as guest' button on get-started screen");

    it.todo("should call continueAsGuest when 'continue as guest' button is pressed");

    it.todo("should navigate to /(app) after continueAsGuest is called");
  });

  describe("ログイン済みユーザー", () => {
    it.todo("should redirect from auth group to /(app) when user is authenticated");
  });
});
