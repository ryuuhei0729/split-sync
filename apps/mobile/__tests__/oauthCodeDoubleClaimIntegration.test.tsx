/**
 * PM 依頼4-4 (任意, 高優先度): app/_layout.tsx のグローバル Linking ハンドラと
 * hooks/useGoogleAuth.ts の両方に同一の PKCE 認可コードが競合して届く、
 * 実際のバグシナリオそのものを再現する結合テスト。
 *
 * シナリオ: Android で Custom Tabs から復帰した際、
 *   1. useGoogleAuth の openAuthSessionAsync が先に resolve し、code を交換する
 *   2. 直後に OS が同じコールバック URL を Linking の 'url' イベントとしても
 *      配送する (_layout.tsx のグローバルハンドラが安全網として受信)
 * この2つが同一 code を claimOAuthCode 経由で奪い合い、後者は何もしないこと
 * (2回目の exchangeCodeForSession が呼ばれずエラーも出ないこと) を検証する。
 *
 * トートロジー回避: RootLayout (app/_layout.tsx) と useGoogleAuth の両方を
 * 実物のまま (claimOAuthCode 含め) レンダリング・実行し、供給する URL/戻り値だけを
 * モックで制御する。
 */
import React from "react";
import { render, act, waitFor, renderHook } from "@testing-library/react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import RootLayout from "../app/_layout";
import { useGoogleAuth } from "../hooks/useGoogleAuth";
import { supabase } from "../lib/supabase";

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

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// app/_layout.tsx が (Reviewer Warning 1 対応で) `../lib/i18n` の default export
// (i18next インスタンス) を直接 import するようになった。lib/i18n.ts はモジュール
// 読み込み時に `i18next.use(initReactI18next)` を呼ぶが、上の react-i18next モック
// は `initReactI18next` を提供しないため実物を読み込むとクラッシュする。本テストは
// 交換「成功」の正常系のみを検証し、i18n.t が実際に呼ばれる失敗時 Alert 分岐には
// 到達しないため、最小のスタブで十分。
jest.mock("../lib/i18n", () => ({
  __esModule: true,
  default: { t: (key: string) => key },
}));

jest.mock("expo-auth-session", () => ({
  makeRedirectUri: jest.fn(() => "swimhubtimer://auth/callback"),
}));

jest.mock("expo-web-browser", () => ({
  maybeCompleteAuthSession: jest.fn(),
  openAuthSessionAsync: jest.fn(),
}));

// 実際の RootLayout / useGoogleAuth が同一の supabase インスタンス (同一の
// exchangeCodeForSession モック) を参照するよう共有する。
jest.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      verifyOtp: jest.fn(),
      exchangeCodeForSession: jest.fn(),
      setSession: jest.fn(),
      signInWithOAuth: jest.fn(),
    },
  },
}));

// expo-linking: rootLayoutAuthDeepLink.test.tsx と同じ最小実装。
jest.mock("expo-linking", () => {
  const state: { url: string | null } = { url: null };
  let urlHandler: ((e: { url: string }) => void) | null = null;
  return {
    parse: jest.fn((url: string) => {
      const query = url.split("?")[1]?.split("#")[0] ?? "";
      const params = new URLSearchParams(query);
      return { queryParams: Object.fromEntries(params.entries()) };
    }),
    getInitialURL: jest.fn(() => Promise.resolve(state.url)),
    addEventListener: jest.fn((_event: string, handler: (e: { url: string }) => void) => {
      urlHandler = handler;
      return { remove: jest.fn() };
    }),
    __setInitialUrl: (url: string | null) => {
      state.url = url;
    },
    __fireUrl: (url: string) => {
      urlHandler?.({ url });
    },
  };
});

const mockExchangeCodeForSession = supabase!.auth.exchangeCodeForSession as jest.Mock;
const mockSignInWithOAuth = supabase!.auth.signInWithOAuth as jest.Mock;
const mockOpenAuthSessionAsync = WebBrowser.openAuthSessionAsync as jest.Mock;
const setInitialUrl = (Linking as unknown as { __setInitialUrl: (url: string | null) => void })
  .__setInitialUrl;
const fireUrl = (Linking as unknown as { __fireUrl: (url: string) => void }).__fireUrl;

beforeEach(() => {
  jest.clearAllMocks();
  setInitialUrl(null);
  mockExchangeCodeForSession.mockResolvedValue({ data: {}, error: null });
  mockSignInWithOAuth.mockResolvedValue({
    data: { url: "https://accounts.google.com/o/oauth2/mock-auth" },
    error: null,
  });
});

describe("PM依頼4-4: _layout.tsx と useGoogleAuth の同一 code 競合 (実バグシナリオの結合テスト)", () => {
  it("useGoogleAuth が先に code を交換し、直後に同じ code が Linking イベントとして _layout.tsx に届いても再交換されない", async () => {
    const code = "integration-race-code-001";
    const callbackUrl = `swimhubtimer://auth/callback?code=${code}`;

    // RootLayout をマウントし、Linking の 'url' ハンドラを登録させる
    // (安全網としての _layout.tsx グローバルハンドラ)。
    render(<RootLayout />);
    await waitFor(() => {
      expect(Linking.addEventListener).toHaveBeenCalled();
    });

    // 1. useGoogleAuth 側の openAuthSessionAsync が先に resolve し、code を交換する。
    mockOpenAuthSessionAsync.mockResolvedValue({ type: "success", url: callbackUrl });
    const { result } = await renderHook(() => useGoogleAuth());

    let authResult: { success: boolean; error?: Error | null } | undefined;
    await act(async () => {
      authResult = await result.current.signInWithGoogle();
    });

    expect(mockExchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(mockExchangeCodeForSession).toHaveBeenCalledWith(code);
    expect(authResult).toEqual({ success: true });

    // 2. 直後に OS が同じコールバック URL を Linking の 'url' イベントとしても
    //    配送する (_layout.tsx の安全網が受信するケース)。
    mockExchangeCodeForSession.mockClear();
    await act(async () => {
      fireUrl(callbackUrl);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    // 既に useGoogleAuth 側が claim 済みのため、_layout.tsx 側は何もしない
    // (再交換なし・エラー Alert なし)。
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
  });

  // Reviewer Warning 2: 安全網 (_layout.tsx のグローバルハンドラ) が実際に
  // ログインを成立させる「正常系」が無検証だった穴を埋める。
  //
  // シナリオ (一律バイパス案が PM に差し戻された理由そのもの): Android で
  // Custom Tabs 復帰が新規 Intent になり、openAuthSessionAsync が
  // dismiss (URL なし) で解決するケース。useGoogleAuth は
  // `result.type === "success" && result.url` の分岐内でしか claimOAuthCode を
  // 呼ばないため、この場合は claim 自体が起きず exchangeCodeForSession も
  // 呼ばれない。その後 OS が同じコールバック URL を Linking 'url' イベントとして
  // 配送すると、_layout.tsx のグローバルハンドラが (誰にも先に claim されて
  // いないため) claim に勝ち、実際に exchangeCodeForSession を実行して
  // セッションを成立させる。この「逆方向」の安全網が機能しなくなっても、
  // useGoogleAuth 側だけを見るテストは全て緑のままになってしまうため、
  // 独立した結合テストとして固定する。
  it("openAuthSessionAsync が dismiss (URLなし) のとき useGoogleAuth は claim せず、後続の Linking イベントで _layout.tsx 側が交換してセッションを確立する", async () => {
    const code = "integration-dismiss-fallback-002";
    const callbackUrl = `swimhubtimer://auth/callback?code=${code}`;

    render(<RootLayout />);
    await waitFor(() => {
      expect(Linking.addEventListener).toHaveBeenCalled();
    });

    // 1. openAuthSessionAsync が dismiss (URL なし) で解決する
    //    (Custom Tabs が新規 Intent で復帰し、Promise 自体は解決するが URL が
    //    取れないケースを模す)。
    mockOpenAuthSessionAsync.mockResolvedValue({ type: "dismiss" });
    const { result } = await renderHook(() => useGoogleAuth());

    let authResult: { success: boolean; error?: Error | null } | undefined;
    await act(async () => {
      authResult = await result.current.signInWithGoogle();
    });

    // dismiss 経路では code 自体を読んでいないため claim も交換も発生しない
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
    expect(authResult?.success).toBe(false);

    // 2. 直後に OS が同じコールバック URL を Linking の 'url' イベントとして
    //    配送する。誰にも先に claim されていないため、_layout.tsx の
    //    グローバルハンドラが claim に勝ち、実際に交換を行う。
    await act(async () => {
      fireUrl(callbackUrl);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(mockExchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(mockExchangeCodeForSession).toHaveBeenCalledWith(code);
  });

  // CodeRabbit 指摘 (PR #23): claimOAuthCode に負けた側は、勝った側の実際の
  // 交換結果を知らずに無条件で success:true を返していた。勝った側 (_layout.tsx)
  // の交換が実際には失敗するケースを再現し、負けた側 (useGoogleAuth) がその
  // 失敗を正しく引き継ぐことを固定する。
  it("_layout.tsx が先に code を claim し、その交換が実際には失敗すると、後から届いた useGoogleAuth 側も success:true を返さない", async () => {
    const code = "integration-layout-wins-then-fails-003";
    const callbackUrl = `swimhubtimer://auth/callback?code=${code}`;

    render(<RootLayout />);
    await waitFor(() => {
      expect(Linking.addEventListener).toHaveBeenCalled();
    });

    // _layout.tsx 側の交換を意図的に失敗させる (期限切れ/再利用された code 等を想定)。
    mockExchangeCodeForSession.mockResolvedValue({
      data: null,
      error: { message: "invalid_grant" },
    });

    // 1. _layout.tsx がグローバル Linking ハンドラ経由でこの code を先に claim し、
    //    交換を試みて失敗する。
    await act(async () => {
      fireUrl(callbackUrl);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(mockExchangeCodeForSession).toHaveBeenCalledTimes(1);

    // 2. 直後に useGoogleAuth 側にも同じ code が届くが、既に claim 済みなので
    //    自分では交換せず、_layout.tsx 側の実際の (失敗という) 結果を引き継ぐ。
    mockOpenAuthSessionAsync.mockResolvedValue({ type: "success", url: callbackUrl });
    const { result } = await renderHook(() => useGoogleAuth());

    let authResult: { success: boolean; error?: Error | null } | undefined;
    await act(async () => {
      authResult = await result.current.signInWithGoogle();
    });

    // useGoogleAuth 自身は交換をやり直さない (claim 済みのため) が、
    // success:true を誤って返してもいけない。
    expect(mockExchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(authResult?.success).toBe(false);
  });
});
