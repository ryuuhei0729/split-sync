/**
 * QA Phase B (人間判断による挙動変更の検出漏れ穴埋め):
 *
 * app/_layout.tsx の completeAuthDeepLink に `isColdStart` (第2引数, 既定 false) が
 * 導入された (scanner の app/_layout.tsx と同じ方式)。
 *   - `Linking.getInitialURL().then((url) => completeAuthDeepLink(url, true))` = cold start
 *   - `Linking.addEventListener("url", ...)` 経由 = 既定値 false = warm
 *   - OAuth 安全網の交換失敗パスは、`claim.resolve({success:false})` を必ず先に呼んだ
 *     後、isColdStart のときだけ Alert.alert を呼ぶ (warm 側は既にエラー表示済みの
 *     ため二重通知を避ける)。
 *
 * 既存の rootLayoutAuthDeepLink.test.tsx / oauthCodeDoubleClaimIntegration.test.tsx は
 * いずれも Alert.alert を直接アサートしていないため、この分岐が崩れても検出されない
 * (App Dev 報告のギャップ)。scanner の
 * `__tests__/oauthCallbackSafetyNet.test.tsx` の
 * `describe("cold start 分岐 (isColdStart)")` と同じ手法をそのまま流用してこの穴を
 * 埋める。
 *
 * トートロジー回避方針:
 * - completeAuthDeepLink はエクスポートされていないため RootLayout を実際にマウント
 *   して検証する。claimOAuthCode / exchangeCodeForSession の呼び分けロジックを
 *   テストファイル内で再実装しない。
 * - claim.resolve が実際に呼ばれたかどうかは、実装の内部状態を直接読むのではなく
 *   「同じ code で claimOAuthCode をもう一度呼んだ (負けた) 側の Promise が実際に
 *   解決するか」をタイムアウト付きで観測する (oauthCodeDoubleClaimIntegration.test.tsx
 *   / scanner のテストと同じ方式)。
 */
import React from "react";
import { render, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import * as Linking from "expo-linking";
import RootLayout from "../app/_layout";
import { claimOAuthCode } from "../lib/google-auth";
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

// app/_layout.tsx は `../lib/i18n` の default export (i18next インスタンス) を直接
// import する。lib/i18n.ts はモジュール読み込み時に `i18next.use(initReactI18next)` を
// 呼ぶが、上の react-i18next モックは initReactI18next を提供しないため実物は読み込め
// ない (oauthCodeDoubleClaimIntegration.test.tsx と同じ最小スタブ)。t はキーをそのまま
// 返すため、Alert.alert に渡る引数はそのまま i18n キー文字列になる。
jest.mock("../lib/i18n", () => ({
  __esModule: true,
  default: { t: (key: string) => key },
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

// rootLayoutAuthDeepLink.test.tsx と同じ最小実装。getInitialURL / addEventListener を
// 個別に制御できるようにする (isColdStart:true / false の経路を出し分けるため)。
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
const setInitialUrl = (Linking as unknown as { __setInitialUrl: (url: string | null) => void })
  .__setInitialUrl;
const fireUrl = (Linking as unknown as { __fireUrl: (url: string) => void }).__fireUrl;

/** claim.resolve が実際に呼ばれたかを、負けた側の Promise が解決するかで観測する。
 * 呼ばれていなければ永久に pending のままになるため、タイムアウトで検出する。 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(
        () => reject(new Error(`timeout: ${label} が解決しませんでした (claim.resolve 未呼び出しの疑い)`)),
        ms,
      );
    }),
  ]);
}

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  setInitialUrl(null);
  alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  mockExchangeCodeForSession.mockResolvedValue({ data: {}, error: null });
});

afterEach(() => {
  alertSpy.mockRestore();
});

describe("RootLayout — completeAuthDeepLink の isColdStart による Alert 通知の有無", () => {
  it("[cold start] getInitialURL 経由で auth/callback?code=... が届き交換に失敗すると、claim.resolve は必ず呼ばれた上で Alert.alert が1回呼ばれる", async () => {
    const code = "timer-coldstart-fail-001";
    const callbackUrl = `swimhubtimer://auth/callback?code=${code}`;

    // アプリ kill 後のコールドスタートを再現する: getInitialURL がこの URL を
    // 返す状態にしてから RootLayout をマウントする (addEventListener 経由の
    // fireUrl は使わない = isColdStart:true のパスだけを通す)。
    setInitialUrl(callbackUrl);
    mockExchangeCodeForSession.mockResolvedValue({
      data: null,
      error: { message: "invalid_grant" },
    });

    render(<RootLayout />);

    await waitFor(() => {
      expect(mockExchangeCodeForSession).toHaveBeenCalledTimes(1);
    });
    expect(mockExchangeCodeForSession).toHaveBeenCalledWith(code);

    // 敗者側 (2回目の claimOAuthCode 呼び出し) がハングしないこと =
    // claim.resolve が呼ばれたことの証拠。
    const loserOutcome = claimOAuthCode(code);
    expect(loserOutcome.claimed).toBe(false);
    if (!loserOutcome.claimed) {
      await expect(
        withTimeout(loserOutcome.result, 500, "loserOutcome.result (cold start 失敗)"),
      ).resolves.toEqual({ success: false });
    }

    // cold start (warm path の JS コンテキストが失われている) では二重通知の
    // 心配が無いため、Alert で明示的に失敗を伝える。
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith("common.error", "auth.errors.invalidGrant");
  });

  it("[warm] addEventListener 経由 (isColdStart:false) で交換に失敗しても Alert.alert は呼ばれない (warm path が既に表示済みのため)", async () => {
    const code = "timer-warm-fail-002";
    const callbackUrl = `swimhubtimer://auth/callback?code=${code}`;

    mockExchangeCodeForSession.mockResolvedValue({
      data: null,
      error: { message: "invalid_grant" },
    });

    render(<RootLayout />);
    await waitFor(() => {
      expect(Linking.addEventListener).toHaveBeenCalled();
    });

    // getInitialURL 側は null のまま (beforeEach で setInitialUrl(null) 済み)。
    // addEventListener 経由でのみこの code を届ける = isColdStart:false 固定。
    fireUrl(callbackUrl);
    await waitFor(() => {
      expect(mockExchangeCodeForSession).toHaveBeenCalledTimes(1);
    });
    expect(mockExchangeCodeForSession).toHaveBeenCalledWith(code);

    const loserOutcome = claimOAuthCode(code);
    expect(loserOutcome.claimed).toBe(false);
    if (!loserOutcome.claimed) {
      await expect(
        withTimeout(loserOutcome.result, 500, "loserOutcome.result (warm 失敗)"),
      ).resolves.toEqual({ success: false });
    }

    expect(alertSpy).not.toHaveBeenCalled();
  });
});
