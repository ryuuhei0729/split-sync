/**
 * QA Phase B: RootLayout の completeAuthDeepLink (app/_layout.tsx, 非 export の内部関数)
 * が token_hash + type クエリを検知して supabase.auth.verifyOtp を呼び出すことを、
 * 実コンポーネントのマウント経由で検証する。
 *
 * completeAuthDeepLink 自体は export されていないため、直接 import してユニットテスト
 * することはできない。RootLayout をマウントし、Linking.getInitialURL が解決した URL を
 * トリガーとして実行される副作用 (supabase.auth.verifyOtp 呼び出し) を観測することで
 * 間接的に検証する (トートロジー回避: token_hash 抽出/type 判定ロジックを
 * テストファイル内で再実装しない)。
 *
 * Sprint Contract: V-04/V-07 相当 (token_hash 優先, code フロー非破壊)。
 * 依存が多いコンポーネントのため、認証状態/フォント/ルーティングはダミーに差し替え、
 * expo-linking と lib/supabase のみ挙動を制御する。
 *
 * 実装ノート: jest.mock のファクトリはモジュールの初回 require 時に評価される。
 * `import RootLayout from "../app/_layout"` は (他の import と同様) ファイル内の
 * どこに書いても先頭へ巻き上げられるため、後方に書いた `const mockX = jest.fn()`
 * より先に評価されてしまい、ファクトリ内で外側の const を参照すると undefined を
 * 捕まえる (典型的な Jest hoisting の罠)。そのため jest.fn() はファクトリの内側で
 * 生成し、実際のモック関数への参照はモック済みモジュールを require して取り出す。
 */
import React from "react";
import { render, waitFor } from "@testing-library/react-native";
import RootLayout from "../app/_layout";
import * as Linking from "expo-linking";
import { supabase } from "../lib/supabase";
import { isPasswordRecoveryPending, setPasswordRecoveryPending } from "../lib/passwordRecovery";

jest.mock("expo-router", () => ({
  Slot: () => null,
  useRouter: () => ({ replace: jest.fn() }),
  useSegments: () => [],
}));

jest.mock("expo-font", () => ({
  loadAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("expo-status-bar", () => ({
  StatusBar: () => null,
}));

jest.mock("@expo-google-fonts/chakra-petch", () => ({
  ChakraPetch_700Bold: "mock-font-asset",
}));

jest.mock("../providers/I18nProvider", () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("../contexts/AuthProvider", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({ user: null, isAuthenticated: false, guestMode: true, loading: false }),
}));

jest.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      verifyOtp: jest.fn(),
      exchangeCodeForSession: jest.fn(),
      setSession: jest.fn(),
    },
  },
}));

// expo-linking の実装 (Linking.parse) は内部で expo-constants のマニフェスト情報に
// 依存しており、jest 環境 (Constants.expoConfig 未設定) では例外を投げる。
// completeAuthDeepLink は try/catch で包んでいるため無音で握りつぶされてしまい、
// 検証したい token_hash 分岐に到達できない。ここでは parse だけをクエリ抽出に
// 限定した最小実装に差し替える (本番の queryParams 抽出結果と同じ形を再現するのみで、
// token_hash/type 判定ロジック自体は auth-deep-link 側の実装をそのまま使わせる)。
// getInitialURL が返す URL はテストごとに変えたいので、モジュール変数
// (`__mockInitialUrl`) 越しに差し替える。
jest.mock("expo-linking", () => {
  const state: { url: string | null } = { url: null };
  return {
    parse: jest.fn((url: string) => {
      const query = url.split("?")[1]?.split("#")[0] ?? "";
      const params = new URLSearchParams(query);
      return { queryParams: Object.fromEntries(params.entries()) };
    }),
    getInitialURL: jest.fn(() => Promise.resolve(state.url)),
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
    __setInitialUrl: (url: string | null) => {
      state.url = url;
    },
  };
});

// jest.mock ファクトリ内で生成した実体を取り出す (上記ノート参照)。
const mockVerifyOtp = supabase!.auth.verifyOtp as jest.Mock;
const mockExchangeCodeForSession = supabase!.auth.exchangeCodeForSession as jest.Mock;
const mockSetSession = supabase!.auth.setSession as jest.Mock;
const setInitialUrl = (Linking as unknown as { __setInitialUrl: (url: string | null) => void })
  .__setInitialUrl;

beforeEach(() => {
  jest.clearAllMocks();
  setInitialUrl(null);
  setPasswordRecoveryPending(false);
  mockVerifyOtp.mockResolvedValue({ data: {}, error: null });
  mockExchangeCodeForSession.mockResolvedValue({ data: {}, error: null });
  mockSetSession.mockResolvedValue({ data: {}, error: null });
});

describe("RootLayout — completeAuthDeepLink token_hash 分岐", () => {
  it("V-04/V-07: token_hash + type=signup の初期 URL で verifyOtp が呼ばれる", async () => {
    setInitialUrl("swimhubtimer://auth/callback?token_hash=abc123&type=signup");
    render(<RootLayout />);

    await waitFor(() => {
      expect(mockVerifyOtp).toHaveBeenCalledWith({ type: "signup", token_hash: "abc123" });
    });
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  it("V-07: token_hash と code が両方ある URL では token_hash が優先され exchangeCodeForSession は呼ばれない", async () => {
    setInitialUrl(
      "swimhubtimer://auth/callback?token_hash=abc123&type=signup&code=some-pkce-code",
    );
    render(<RootLayout />);

    await waitFor(() => {
      expect(mockVerifyOtp).toHaveBeenCalledWith({ type: "signup", token_hash: "abc123" });
    });
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("V-04 (既存回帰): token_hash が無く code のみの URL では exchangeCodeForSession が呼ばれる", async () => {
    setInitialUrl("swimhubtimer://auth/callback?code=some-pkce-code");
    render(<RootLayout />);

    await waitFor(() => {
      expect(mockExchangeCodeForSession).toHaveBeenCalledWith("some-pkce-code");
    });
    expect(mockVerifyOtp).not.toHaveBeenCalled();
  });

  it("type=recovery の token_hash URL では verifyOtp が呼ばれ、setPasswordRecoveryPending(true) が先立って呼ばれる", async () => {
    setInitialUrl("swimhubtimer://auth/callback?token_hash=abc123&type=recovery");

    render(<RootLayout />);

    await waitFor(() => {
      expect(mockVerifyOtp).toHaveBeenCalledWith({ type: "recovery", token_hash: "abc123" });
    });
    expect(isPasswordRecoveryPending()).toBe(true);
  });

  it("type=recovery の token_hash URL で verifyOtp がエラーを返すと setPasswordRecoveryPending(false) に戻す (誤った次回ログインの reset-password 誘導を防ぐ)", async () => {
    mockVerifyOtp.mockResolvedValue({ data: null, error: { message: "expired" } });
    setInitialUrl("swimhubtimer://auth/callback?token_hash=expired&type=recovery");

    render(<RootLayout />);

    await waitFor(() => {
      expect(mockVerifyOtp).toHaveBeenCalledWith({ type: "recovery", token_hash: "expired" });
    });
    await waitFor(() => {
      expect(isPasswordRecoveryPending()).toBe(false);
    });
  });

  it("auth/callback を含まない URL では verifyOtp も exchangeCodeForSession も呼ばれない", async () => {
    setInitialUrl("swimhubtimer://some/other/path");
    render(<RootLayout />);

    // 副作用が無いことを確認するため、他の非同期処理が落ち着くのを少し待つ
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("境界値: token_hash が空文字の場合は verifyOtp を呼ばず code フローにもフォールバックしない (type だけでは起動しない)", async () => {
    setInitialUrl("swimhubtimer://auth/callback?token_hash=&type=signup");
    render(<RootLayout />);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
  });
});
