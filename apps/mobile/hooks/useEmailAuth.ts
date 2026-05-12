import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { localizeAuthError } from "../utils/authErrorLocalizer";

export function useEmailAuth() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      if (!supabase) {
        setError(t("auth.errors.notInitialized"));
        return;
      }
      try {
        setLoading(true);
        setError(null);
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) {
          setError(localizeAuthError(authError.message, t));
        }
      } catch {
        setError(t("auth.errors.generic"));
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  const signUpWithEmail = useCallback(
    async (email: string, password: string, name: string): Promise<boolean> => {
      if (!supabase) {
        setError(t("auth.errors.notInitialized"));
        return false;
      }
      try {
        setLoading(true);
        setError(null);
        const { data, error: authError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { name },
          },
        });
        if (authError) {
          setError(localizeAuthError(authError.message, t));
          return false;
        }
        // Supabase は Confirm Email 有効時、登録済みメールでも error を返さず
        // identities が空配列の user を返す（メール列挙対策のデフォルト挙動）。
        // 確認メールも実際には送信されないため、明示的にエラーへ変換する。
        if (data?.user && (data.user.identities?.length ?? 0) === 0) {
          setError(localizeAuthError("User already registered", t));
          return false;
        }
        return true;
      } catch {
        setError(t("auth.errors.generic"));
        return false;
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    signInWithEmail,
    signUpWithEmail,
    loading,
    error,
    clearError,
  };
}
