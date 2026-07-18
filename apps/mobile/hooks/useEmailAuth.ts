import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { localizeAuthError } from "../utils/authErrorLocalizer";
import { getRedirectUri, getPasswordRecoveryRedirectUri } from "../lib/google-auth";
import { setPasswordRecoveryPending } from "../lib/passwordRecovery";

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
            // Open the confirmation link back in the app (swimhubtimer://) so the
            // root Linking handler can complete the session — otherwise the link
            // opens the web LP and the sign-up happy path dead-ends. The Supabase
            // project's Redirect URLs must include this scheme.
            emailRedirectTo: getRedirectUri(),
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

  // メールアドレス列挙攻撃を避けるため、成功/失敗を問わず常に true を返す
  // (Supabase 自体もアカウントの有無を resetPasswordForEmail のレスポンスで
  // 露呈しないが、念のためクライアント側でも例外を握りつぶす)。
  const sendPasswordResetEmail = useCallback(
    async (email: string): Promise<boolean> => {
      if (!supabase) {
        setError(t("auth.errors.notInitialized"));
        return false;
      }
      try {
        setLoading(true);
        setError(null);
        await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: getPasswordRecoveryRedirectUri(),
        });
      } catch {
        // 意図的に握りつぶす: エラー内容によってアカウントの存在有無が
        // 推測できてしまうため、成功時と同じ画面を表示する。
      } finally {
        setLoading(false);
      }
      return true;
    },
    [t],
  );

  const updatePassword = useCallback(
    async (newPassword: string): Promise<boolean> => {
      if (!supabase) {
        setError(t("auth.errors.notInitialized"));
        return false;
      }
      try {
        setLoading(true);
        setError(null);
        const { error: authError } = await supabase.auth.updateUser({ password: newPassword });
        if (authError) {
          setError(localizeAuthError(authError.message, t));
          return false;
        }
        // 更新が完了したらリカバリーセッション扱いを解除し、通常ログイン
        // 済みユーザーとして AuthGate がメイン画面へ遷移できるようにする。
        setPasswordRecoveryPending(false);
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
    sendPasswordResetEmail,
    updatePassword,
    loading,
    error,
    clearError,
  };
}
