import { makeRedirectUri } from "expo-auth-session";

/**
 * リダイレクトURIを生成
 * カスタムスキーム(swimhubtimer://)を使用
 */
export const getRedirectUri = (): string => {
  return makeRedirectUri({
    scheme: "swimhubtimer",
    path: "auth/callback",
    native: "swimhubtimer://auth/callback",
  });
};

/**
 * パスワードリセット専用のリダイレクトURI。
 * PKCE フローでは code の交換がセッションの用途 (通常ログイン vs リカバリー) を
 * URL からは判別できないため、`flow=password-recovery` をクエリに付与して
 * completeAuthDeepLink (root layout) が確実に判別できるようにする。
 * Supabase は redirectTo の既存クエリを保持したまま code/token を付加する。
 */
export const getPasswordRecoveryRedirectUri = (): string => {
  return `${getRedirectUri()}?flow=password-recovery`;
};

/**
 * コールバックURLからトークンを抽出
 * Supabaseは認証成功後、フラグメント(#)でトークンを返す
 */
export interface ExtractedTokens {
  accessToken: string | null;
  refreshToken: string | null;
  expiresIn: number | null;
  tokenType: string | null;
  // Supabase が implicit フローのフラグメントに付与する `type` パラメータ。
  // パスワードリセットのリンクでは "recovery" になり、通常のメール確認/OAuth
  // ログインと区別するために使う (root layout の completeAuthDeepLink 参照)。
  recoveryType: string | null;
  error: string | null;
}

export const extractTokensFromUrl = (url: string): ExtractedTokens => {
  try {
    const urlObj = new URL(url);
    const hashParams = new URLSearchParams(urlObj.hash.substring(1));

    const error = hashParams.get("error_description") || hashParams.get("error");
    if (error) {
      return {
        accessToken: null,
        refreshToken: null,
        expiresIn: null,
        tokenType: null,
        recoveryType: null,
        error,
      };
    }

    return {
      accessToken: hashParams.get("access_token"),
      refreshToken: hashParams.get("refresh_token"),
      expiresIn: hashParams.get("expires_in") ? parseInt(hashParams.get("expires_in")!, 10) : null,
      tokenType: hashParams.get("token_type"),
      recoveryType: hashParams.get("type"),
      error: null,
    };
  } catch {
    return {
      accessToken: null,
      refreshToken: null,
      expiresIn: null,
      tokenType: null,
      recoveryType: null,
      error: "URLの解析に失敗しました",
    };
  }
};
