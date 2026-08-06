import { useState, useCallback } from "react";
import * as WebBrowser from "expo-web-browser";
import { useTranslation } from "react-i18next";
import { signInWithGoogle as sharedSignInWithGoogle, APP_SCHEME } from "../lib/google-auth";
import { supabase } from "../lib/supabase";
import { localizeAuthError } from "../utils/authErrorLocalizer";

WebBrowser.maybeCompleteAuthSession();

export interface GoogleAuthResult {
  success: boolean;
  error?: Error | null;
}

export interface UseGoogleAuthReturn {
  signInWithGoogle: () => Promise<GoogleAuthResult>;
  loading: boolean;
  error: string | null;
  clearError: () => void;
}

/**
 * 共有パッケージ (@ryuuhei0729/swimhub-oauth) はローカライズ済み文字列を返さず、
 * 機械可読な固定コードを Error.message に入れて返す。まずこの表で完全一致を
 * 試み、一致しない場合 (Supabase の生エラーメッセージ等、部分一致ベースの
 * localizeAuthError の対象) のみフォールバックする。
 */
const ERROR_CODE_I18N_KEY: Readonly<Record<string, string>> = {
  url_not_received: "auth.errors.oauthError",
  auth_cancelled: "auth.errors.cancelled",
  auth_dismissed: "auth.errors.cancelled",
  auth_failed: "auth.errors.generic",
  invalid_url: "auth.errors.generic",
  code_exchange_failed: "auth.errors.oauthError",
  session_not_received: "auth.errors.sessionNotFound",
  tokens_not_received: "auth.errors.invalidToken",
};

export const useGoogleAuth = (): UseGoogleAuthReturn => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signInWithGoogle = useCallback(async (): Promise<GoogleAuthResult> => {
    if (!supabase) {
      const msg = t("auth.errors.notInitialized");
      setError(msg);
      return { success: false, error: new Error(msg) };
    }

    setLoading(true);
    setError(null);

    try {
      // loading 状態管理と i18n ローカライズ以外のロジック (PKCE 交換・
      // claimOAuthCode による二重処理ガード・implicit フォールバック等) は
      // 全て共有パッケージ側の責務。signInWithGoogle は内部で例外を投げず、
      // 常に {success, error?} で解決する契約になっている。
      const result = await sharedSignInWithGoogle({
        supabase,
        scheme: APP_SCHEME,
      });

      if (!result.success) {
        const code = result.error?.message ?? "";
        const i18nKey = ERROR_CODE_I18N_KEY[code];
        const localizedError = i18nKey ? t(i18nKey) : localizeAuthError(code, t);
        setError(localizedError);
        return { success: false, error: result.error ?? new Error(localizedError) };
      }

      return { success: true };
    } catch (unexpectedException) {
      // 保険 (Reviewer 指摘): signInWithGoogle は「内部で例外を投げず常に
      // {success, error?} で解決する」契約 (上のコメント参照) だが、呼び出し元
      // (app/(auth)/login-method.tsx, app/(auth)/get-started.tsx) にも catch が
      // 無いため、将来 "^0.1.0" のマイナーバージョン更新でこの契約が破られた
      // 場合に唯一の防御層になる。契約を信頼する設計自体は変えず、既存のエラー
      // 表示経路 (setError + i18n) に乗せるだけの薄い保険に留める。
      const msg = t("auth.errors.generic");
      setError(msg);
      return {
        success: false,
        error: unexpectedException instanceof Error ? unexpectedException : new Error(msg),
      };
    } finally {
      setLoading(false);
    }
  }, [t]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    signInWithGoogle,
    loading,
    error,
    clearError,
  };
};
