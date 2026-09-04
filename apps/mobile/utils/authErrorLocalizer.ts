/**
 * Supabase 認証エラーメッセージを i18n 翻訳キーにマッピングするユーティリティ
 *
 * Scanner の authErrorLocalizer.ts と同等のカバレッジを i18n ベースで実現する。
 * Supabase が返す英語エラーメッセージを検査し、対応する auth.errors.* キーを返す。
 */

import type { TFunction } from "i18next";

/**
 * Supabase エラーメッセージ (小文字) → i18n キー のマッピング
 *
 * 順序に意味がある: 先にマッチしたものが優先される。
 * includes() で部分一致するため、より具体的なキーワードを先に配置すること。
 */
const errorKeyMap: readonly [pattern: string, i18nKey: string][] = [
  // 認証情報
  ["invalid login credentials", "auth.errors.invalidCredentials"],
  ["invalid credentials", "auth.errors.invalidCredentials"],
  ["email not confirmed", "auth.errors.emailNotConfirmed"],
  ["user not found", "auth.errors.userNotFound"],
  ["user already registered", "auth.errors.alreadyRegistered"],

  // パスワード
  ["password should be at least", "auth.errors.passwordTooShort"],
  ["weak password", "auth.errors.weakPassword"],
  ["password is too long", "auth.errors.passwordTooLong"],

  // メール・電話
  ["invalid email", "auth.errors.invalidEmail"],
  ["invalid phone", "auth.errors.invalidPhone"],
  ["phone not found", "auth.errors.phoneNotFound"],

  // OTP
  ["invalid otp", "auth.errors.invalidOtp"],
  ["otp expired", "auth.errors.expiredOtp"],
  ["expired otp", "auth.errors.expiredOtp"],

  // OAuth / プロバイダー
  ["provider not enabled", "auth.errors.providerNotEnabled"],
  ["oauth error", "auth.errors.oauthError"],
  ["access_denied", "auth.errors.accessDenied"],
  ["invalid_grant", "auth.errors.invalidGrant"],
  ["invalid_client", "auth.errors.invalidClient"],
  ["unauthorized_client", "auth.errors.unauthorizedClient"],
  ["unsupported_response_type", "auth.errors.unsupportedResponseType"],
  ["invalid_scope", "auth.errors.invalidScope"],

  // トークン / セッション
  ["invalid token", "auth.errors.invalidToken"],
  ["token expired", "auth.errors.tokenExpired"],
  ["invalid refresh token", "auth.errors.invalidRefreshToken"],
  ["session not found", "auth.errors.sessionNotFound"],
  ["session expired", "auth.errors.sessionExpired"],

  // レート制限
  ["too many requests", "auth.errors.tooManyRequests"],
  ["rate limit exceeded", "auth.errors.rateLimitExceeded"],

  // Captcha
  ["captcha", "auth.errors.captchaRequired"],

  // ネットワーク
  ["network error", "auth.errors.networkError"],
  ["timeout", "auth.errors.timeout"],

  // キャンセル
  ["cancel", "auth.errors.cancelled"],
];

/**
 * Supabase 認証エラーメッセージを i18n で翻訳されたメッセージに変換する
 *
 * @param message - Supabase が返すエラーメッセージ (英語)
 * @param t - i18next の翻訳関数
 * @returns ローカライズされたエラーメッセージ
 */
export function localizeAuthError(message: string, t: TFunction): string {
  if (!message) {
    return t("auth.errors.fallback");
  }

  const lowerMessage = message.toLowerCase();

  for (const [pattern, i18nKey] of errorKeyMap) {
    if (lowerMessage === pattern || lowerMessage.includes(pattern)) {
      // passwordTooShort の場合、minLength パラメータを抽出して渡す
      if (i18nKey === "auth.errors.passwordTooShort") {
        const match = message.match(/(\d+)/);
        const digits = match?.[1];
        const minLength = digits ? parseInt(digits, 10) : 6;
        return t(i18nKey, { minLength });
      }
      return t(i18nKey);
    }
  }

  // 既に日本語のメッセージはそのまま返す
  if (/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(message)) {
    return message;
  }

  return t("auth.errors.fallback");
}

/**
 * Supabase AuthError オブジェクトからローカライズされたメッセージを取得する
 *
 * @param error - Supabase の認証エラーオブジェクト
 * @param t - i18next の翻訳関数
 * @returns ローカライズされたエラーメッセージ
 */
export function localizeSupabaseAuthError(
  error: { message?: string; error_description?: string; error?: string } | null | undefined,
  t: TFunction,
): string {
  if (!error) {
    return t("auth.errors.fallback");
  }
  const message = error.message || error.error_description || error.error || "";
  return localizeAuthError(message, t);
}
