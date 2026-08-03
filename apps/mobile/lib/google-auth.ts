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
 * Supabase メールテンプレートの `token_hash` 形式で使われる検証タイプ。
 * `invite` は本アプリのフローで使わないため対象外とする。
 */
export type EmailOtpLinkType = "signup" | "recovery" | "email_change" | "email" | "magiclink";

const EMAIL_OTP_LINK_TYPES: readonly EmailOtpLinkType[] = [
  "signup",
  "recovery",
  "email_change",
  "email",
  "magiclink",
];

export const isEmailOtpLinkType = (value: unknown): value is EmailOtpLinkType =>
  typeof value === "string" && (EMAIL_OTP_LINK_TYPES as readonly string[]).includes(value);

/**
 * PKCE の認可コードは使い捨てで、同じ `swimhubtimer://auth/callback?code=...`
 * URL が2つの独立した経路から届きうる:
 *   1. `useGoogleAuth` — `openAuthSessionAsync` の戻り URL から直接読む (warm path)
 *   2. `app/_layout.tsx` の `completeAuthDeepLink` — `Linking` の 'url' イベント/
 *      `getInitialURL` 経由 (Android で Custom Tabs 復帰が新規 Intent になった場合や、
 *      ブラウザ表示中にプロセスが kill されコールドスタートした場合の安全網)
 *
 * どちらか一方だけが交換を実行すべきで、後から来た側は「すでに他方が処理した」だけ
 * なのでエラーを出さず何もしないこと。JS はシングルスレッドなので、この判定を
 * `await` を挟まず同期的に行えば競合しない。
 *
 * 負けた側は、勝った側の実際の交換結果 (成功/失敗) を `result` で待てる。
 * これが無いと、勝った側の exchangeCodeForSession が実際には失敗したのに
 * 負けた側が無条件で success 扱いを返してしまう (CodeRabbit 指摘)。
 * 勝った側は交換結果が確定し次第、必ず `resolve` を呼ぶこと (例外時も `finally` 等で
 * 呼び、`result` を待つ負けた側が永久に解決しないままにならないようにする)。
 *
 * 保持するコードは直近 `MAX_TRACKED_CODES` 件のみ (無限にメモリを食わない)。
 */
const MAX_TRACKED_CODES = 5;

export interface OAuthCodeExchangeResult {
  success: boolean;
}

interface OAuthCodeClaim {
  resolve: (result: OAuthCodeExchangeResult) => void;
  result: Promise<OAuthCodeExchangeResult>;
}

export type ClaimOAuthCodeOutcome =
  | { claimed: true; resolve: (result: OAuthCodeExchangeResult) => void }
  | { claimed: false; result: Promise<OAuthCodeExchangeResult> };

const claimedOAuthCodes = new Map<string, OAuthCodeClaim>();
const claimedOAuthCodeOrder: string[] = [];

/**
 * 同一 code を最初に処理しようとした呼び出し側だけ `claimed: true` を得て、
 * 交換結果が確定したら `resolve` を呼ぶ責任を負う。2回目以降の呼び出しは
 * `claimed: false` となり、`result` を await すれば勝った側の実際の結果
 * (成功/失敗) を取得できる — エラー表示するかどうかは呼び出し側が判断すること。
 *
 * 必ず `await` の前 (同期的な位置) で呼び出すこと。
 */
export const claimOAuthCode = (code: string): ClaimOAuthCodeOutcome => {
  const existing = claimedOAuthCodes.get(code);
  if (existing) {
    return { claimed: false, result: existing.result };
  }

  let resolve!: (result: OAuthCodeExchangeResult) => void;
  const result = new Promise<OAuthCodeExchangeResult>((res) => {
    resolve = res;
  });
  claimedOAuthCodes.set(code, { resolve, result });
  claimedOAuthCodeOrder.push(code);
  if (claimedOAuthCodeOrder.length > MAX_TRACKED_CODES) {
    const oldest = claimedOAuthCodeOrder.shift();
    if (oldest !== undefined) claimedOAuthCodes.delete(oldest);
  }
  return { claimed: true, resolve };
};

/**
 * コールバックURLからトークン (または PKCE の認可コード) を抽出する。
 *
 * Supabase クライアントは flowType: "pkce" で構成されているため、
 * コールバックは通常クエリパラメータ `?code=...` で認可コードが返る。
 * 呼び出し側 (useGoogleAuth) は code を優先して exchangeCodeForSession を
 * 試み、無ければ implicit のフラグメント (#access_token=...) にフォールバックする。
 *
 * メール確認/パスワードリセットのディープリンクは app/_layout.tsx の
 * completeAuthDeepLink が token_hash + verifyOtp / 独自の code パースで
 * 別途処理しており、この関数はそちらに影響しない。
 */
export interface ExtractedTokens {
  accessToken: string | null;
  refreshToken: string | null;
  expiresIn: number | null;
  tokenType: string | null;
  /** PKCE フロー時にクエリパラメータで返る認可コード */
  code: string | null;
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
    const queryParams = urlObj.searchParams;

    // OAuth プロバイダ / Supabase 側のエラーは PKCE (query) と implicit (hash) の
    // どちらの形式で返ってくる可能性もあるため両方確認する
    const error =
      hashParams.get("error_description") ||
      hashParams.get("error") ||
      queryParams.get("error_description") ||
      queryParams.get("error");
    if (error) {
      return {
        accessToken: null,
        refreshToken: null,
        expiresIn: null,
        tokenType: null,
        code: null,
        recoveryType: null,
        error,
      };
    }

    return {
      accessToken: hashParams.get("access_token"),
      refreshToken: hashParams.get("refresh_token"),
      expiresIn: hashParams.get("expires_in") ? parseInt(hashParams.get("expires_in")!, 10) : null,
      tokenType: hashParams.get("token_type"),
      code: queryParams.get("code"),
      recoveryType: hashParams.get("type"),
      error: null,
    };
  } catch {
    return {
      accessToken: null,
      refreshToken: null,
      expiresIn: null,
      tokenType: null,
      code: null,
      recoveryType: null,
      error: "URLの解析に失敗しました",
    };
  }
};
