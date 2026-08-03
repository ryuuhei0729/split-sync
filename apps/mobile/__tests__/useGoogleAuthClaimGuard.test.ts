/**
 * useGoogleAuth (hooks/useGoogleAuth.ts) — claimOAuthCode 二重処理ガードのテスト
 *
 * PM 依頼4-3 (C-5 二重交換防止ロジックの穴埋め):
 * 同一の PKCE 認可コードは app/_layout.tsx のグローバル Linking ハンドラにも
 * 届きうるため、useGoogleAuth 側は交換前に claimOAuthCode を通す。既に他方
 * (_layout.tsx 側) が先に claim 済み (claimed:false が返る) の場合、
 * exchangeCodeForSession を自分では呼ばず、他方の実際の交換結果 (claim.result) を
 * 待って同期する (CodeRabbit 指摘: 他方の結果を待たず無条件で成功扱いにすると、
 * 実際には他方が失敗していても success:true を返してしまう)。
 *
 * 実装ノート: claimOAuthCode の状態はモジュールスコープを実際に共有させる必要が
 * あるため、../lib/google-auth はモックせず実物を使う (getRedirectUri のみ、
 * expo-auth-session 依存を避けるため signInWithGoogle 内では直接使わない
 * extractTokensFromUrl 経路の URL 生成側で問題にならないよう redirectUri は
 * WebBrowser のモック戻り値で完結させる)。
 *
 * トートロジー回避: claimOAuthCode を直接呼んで「他方が先に claim した」状態を
 * 事前に作り、実際の signInWithGoogle() が呼び出す claimOAuthCode がその
 * 共有状態を見て false を返すことを検証する (テスト側でロジックを複製しない)。
 *
 * 注意: claimedOAuthCodes はモジュールスコープでテスト間リセットされないため、
 * 他のテストファイルはもちろん本ファイル内の it 同士でも一意な code 文字列を使う。
 */
import { renderHook, act } from "@testing-library/react-native";
import * as WebBrowser from "expo-web-browser";
import { useGoogleAuth } from "../hooks/useGoogleAuth";
import { claimOAuthCode } from "../lib/google-auth";
import { supabase } from "../lib/supabase";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock("expo-auth-session", () => ({
  makeRedirectUri: jest.fn(() => "swimhubtimer://auth/callback"),
}));

jest.mock("expo-web-browser", () => ({
  maybeCompleteAuthSession: jest.fn(),
  openAuthSessionAsync: jest.fn(),
}));

jest.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      signInWithOAuth: jest.fn(),
      exchangeCodeForSession: jest.fn(),
      setSession: jest.fn(),
    },
  },
}));

const mockSignInWithOAuth = supabase!.auth.signInWithOAuth as jest.Mock;
const mockExchangeCodeForSession = supabase!.auth.exchangeCodeForSession as jest.Mock;
const mockOpenAuthSessionAsync = WebBrowser.openAuthSessionAsync as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockSignInWithOAuth.mockResolvedValue({
    data: { url: "https://accounts.google.com/o/oauth2/mock-auth" },
    error: null,
  });
  mockExchangeCodeForSession.mockResolvedValue({ data: {}, error: null });
});

describe("useGoogleAuth — claimOAuthCode が既に消費済み (claimed:false) のケース", () => {
  it("PM依頼4-3: _layout.tsx 側が既に claim 済みで、かつ実際に成功した code では exchangeCodeForSession を呼ばず { success: true } を返す", async () => {
    const code = "use-google-auth-claim-guard-001";
    // _layout.tsx 側のグローバルハンドラが先に処理した状態を再現する
    // (実際に claimOAuthCode を呼んで消費させる。テストロジックの複製ではなく
    // 「他方が先に claim した」という前提条件を作るための直接呼び出し)。
    const winnerClaim = claimOAuthCode(code);
    expect(winnerClaim.claimed).toBe(true);
    // 他方 (_layout.tsx) が実際に交換へ成功した、という前提を再現する。
    if (winnerClaim.claimed) winnerClaim.resolve({ success: true });

    mockOpenAuthSessionAsync.mockResolvedValue({
      type: "success",
      url: `swimhubtimer://auth/callback?code=${code}`,
    });

    const { result } = await renderHook(() => useGoogleAuth());

    let authResult: { success: boolean; error?: Error | null } | undefined;
    await act(async () => {
      authResult = await result.current.signInWithGoogle();
    });

    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
    expect(authResult).toEqual({ success: true });
    // 消費済み扱いのためエラー状態にはならない (元の Critical=偽エラー表示 の再発防止)
    expect(result.current.error).toBeNull();
  });

  it("CodeRabbit指摘の再発防止: _layout.tsx 側が既に claim 済みだが実際には交換に失敗した code では、無条件で success:true にせず失敗を返す", async () => {
    const code = "use-google-auth-claim-guard-003-other-failed";
    const winnerClaim = claimOAuthCode(code);
    expect(winnerClaim.claimed).toBe(true);
    // 他方 (_layout.tsx) が実際には交換に失敗した、という前提を再現する。
    if (winnerClaim.claimed) winnerClaim.resolve({ success: false });

    mockOpenAuthSessionAsync.mockResolvedValue({
      type: "success",
      url: `swimhubtimer://auth/callback?code=${code}`,
    });

    const { result } = await renderHook(() => useGoogleAuth());

    let authResult: { success: boolean; error?: Error | null } | undefined;
    await act(async () => {
      authResult = await result.current.signInWithGoogle();
    });

    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
    expect(authResult?.success).toBe(false);
    expect(result.current.error).not.toBeNull();
  });

  it("回帰: 未消費の code では通常どおり exchangeCodeForSession が呼ばれ成功を返す", async () => {
    const code = "use-google-auth-claim-guard-002-fresh";

    mockOpenAuthSessionAsync.mockResolvedValue({
      type: "success",
      url: `swimhubtimer://auth/callback?code=${code}`,
    });

    const { result } = await renderHook(() => useGoogleAuth());

    let authResult: { success: boolean; error?: Error | null } | undefined;
    await act(async () => {
      authResult = await result.current.signInWithGoogle();
    });

    expect(mockExchangeCodeForSession).toHaveBeenCalledWith(code);
    expect(authResult).toEqual({ success: true });
  });
});
