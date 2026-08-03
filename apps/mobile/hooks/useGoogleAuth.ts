import { useState, useCallback } from "react";
import * as WebBrowser from "expo-web-browser";
import { useTranslation } from "react-i18next";
import { getRedirectUri, extractTokensFromUrl, claimOAuthCode } from "../lib/google-auth";
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
      const redirectUri = getRedirectUri();

      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: redirectUri,
          scopes: "openid email profile",
          skipBrowserRedirect: true,
        },
      });

      if (oauthError || !data.url) {
        const errorMessage = oauthError
          ? localizeAuthError(oauthError.message, t)
          : t("auth.errors.oauthError");
        setError(errorMessage);
        return {
          success: false,
          error: oauthError || new Error(errorMessage),
        };
      }

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUri);

      if (result.type === "success" && result.url) {
        const tokens = extractTokensFromUrl(result.url);

        if (tokens.error) {
          const localizedError = localizeAuthError(tokens.error, t);
          setError(localizedError);
          return { success: false, error: new Error(tokens.error) };
        }

        // Supabase クライアントは flowType: "pkce" で構成されているため、
        // コールバックは通常クエリパラメータ `?code=...` で返る。
        // まずこちらを優先して exchangeCodeForSession でセッションを確立する。
        // code_verifier が端末ストレージから読めなかった/既に消費済みの場合も
        // exchangeCodeForSession は例外を投げず error を返すため、ここで捕捉できる。
        //
        // 同一 code は app/_layout.tsx のグローバル Linking ハンドラにも届きうる
        // (Android で Custom Tabs 復帰が新規 Intent になった場合)。claimOAuthCode
        // で先に処理を claim できた場合のみ交換する。既に他方が処理済みの場合は、
        // 無条件で成功扱いにはせず、他方の実際の交換結果 (claim.result) を待って
        // 同期する — 他方が実は失敗していたのに、ここだけ success:true を返すと
        // 呼び出し側が誤ってログイン成立と判断してしまう (CodeRabbit 指摘)。
        if (tokens.code) {
          const claim = claimOAuthCode(tokens.code);

          if (!claim.claimed) {
            const otherResult = await claim.result;
            if (!otherResult.success) {
              const msg = t("auth.errors.oauthError");
              setError(msg);
              return { success: false, error: new Error(msg) };
            }
            return { success: true };
          }

          try {
            const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(
              tokens.code,
            );

            if (exchangeError) {
              claim.resolve({ success: false });
              setError(localizeAuthError(exchangeError.message, t));
              return { success: false, error: exchangeError };
            }

            claim.resolve({ success: true });
            return { success: true };
          } catch (exchangeException) {
            claim.resolve({ success: false });
            throw exchangeException;
          }
        }

        // フォールバック: implicit flow (#access_token=...) で返ってきた場合
        if (tokens.accessToken && tokens.refreshToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: tokens.accessToken,
            refresh_token: tokens.refreshToken,
          });

          if (sessionError) {
            setError(localizeAuthError(sessionError.message, t));
            return { success: false, error: sessionError };
          }

          return { success: true };
        }

        const msg = t("auth.errors.invalidToken");
        setError(msg);
        return { success: false, error: new Error(msg) };
      }

      if (result.type === "cancel" || result.type === "dismiss") {
        const msg = t("auth.errors.cancelled");
        setError(msg);
        return { success: false, error: new Error(msg) };
      }

      const msg = t("auth.errors.generic");
      setError(msg);
      return { success: false, error: new Error(msg) };
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : "";
      const localizedMessage = localizeAuthError(rawMessage, t);
      setError(localizedMessage);
      return {
        success: false,
        error: err instanceof Error ? err : new Error(rawMessage),
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
