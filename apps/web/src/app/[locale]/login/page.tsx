"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { useRouter, useSearchParams, useParams } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useAuth } from "@/hooks/useAuth";
import { SwimHubTimerIcon } from "@/components/icons/SwimHubTimerIcon";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import {
  validatePassword,
  type PasswordChecks,
} from "@/lib/passwordValidator";

const PASSWORD_MIN_LENGTH = 6;

// エラーコードを安全なメッセージに変換（swim-hub の errorMap に準拠）
const ERROR_CODE_KEYS: Record<string, string> = {
  access_denied: "auth.errors.accessDenied",
  invalid_request: "auth.errors.invalidRequest",
  server_error: "auth.errors.serverError",
  temporarily_unavailable: "auth.errors.temporarilyUnavailable",
  invalid_grant: "auth.errors.invalidGrant",
  invalid_client: "auth.errors.invalidClient",
  unauthorized_client: "auth.errors.unauthorizedClient",
  unsupported_response_type: "auth.errors.unsupportedResponseType",
  invalid_scope: "auth.errors.invalidScope",
  session_not_found: "auth.errors.sessionNotFound",
  email_not_confirmed: "auth.errors.emailNotConfirmed",
  invalid_credentials: "auth.errors.invalidCredentials",
  user_not_found: "auth.errors.userNotFound",
  email_already_exists: "auth.errors.alreadyRegistered",
  weak_password: "auth.errors.weakPassword",
  password_too_short: "auth.errors.passwordTooShort",
  password_too_long: "auth.errors.passwordTooLong",
  invalid_email: "auth.errors.invalidEmail",
  invalid_phone: "auth.errors.invalidPhone",
  phone_not_found: "auth.errors.phoneNotFound",
  invalid_otp: "auth.errors.invalidOtp",
  expired_otp: "auth.errors.expiredOtp",
  // Supabase実エラーコード（verifyOtp失敗時）。expired_otp は語順が実コードと逆のため追加
  otp_expired: "auth.errors.expiredOtp",
  otp_disabled: "auth.errors.invalidOtp",
  too_many_requests: "auth.errors.tooManyRequests",
  rate_limit_exceeded: "auth.errors.rateLimitExceeded",
};

function getErrorFromCode(code: string, t: TFunction): string {
  const key = ERROR_CODE_KEYS[code];
  if (key) {
    return t(key);
  }
  return t("auth.errors.generic");
}

// エラーメッセージ文字列からOWASP準拠のi18nキーを返す（swim-hub の formatAuthError に準拠）
function formatAuthError(err: unknown, action: "signin" | "signup", t: TFunction): string {
  const errMsg = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const msg = errMsg.toLowerCase();

  // ログイン認証エラー（OWASP準拠: アカウント列挙攻撃を防止）
  if (action === "signin") {
    if (
      (msg.includes("invalid") && (msg.includes("credentials") || msg.includes("email"))) ||
      msg.includes("email not confirmed")
    ) {
      return t("auth.errors.invalidCredentials");
    }
    if (msg.includes("too many requests")) {
      return t("auth.errors.tooManyRequests");
    }
  }

  // サインアップエラー（OWASP準拠）
  if (action === "signup") {
    if (msg.includes("already registered") || msg.includes("already exists")) {
      return t("auth.errors.alreadyRegistered");
    }
    if (
      (msg.includes("password") && msg.includes("weak")) ||
      msg.includes("too short") ||
      (msg.includes("at least") && msg.includes("characters")) ||
      (msg.includes("minimum") && msg.includes("characters"))
    ) {
      return t("auth.errors.weakPassword");
    }
  }

  // 共通エラー
  if (msg.includes("captcha")) {
    return t("auth.errors.captchaRequired");
  }
  if (msg.includes("rate limit")) {
    return t("auth.errors.rateLimitExceeded");
  }
  if (msg.includes("network") || msg.includes("connection")) {
    return t("auth.errors.networkError");
  }

  return t("auth.errors.generic");
}

function LoginPageContent() {
  const { t } = useTranslation();
  const { user, loading, signInWithGoogle, signInWithApple, signInWithEmail, signUpWithEmail } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams();
  const locale = (params.locale as string) || "ja";

  const rawError = searchParams.get("error");
  const [error, setError] = useState<string | null>(
    rawError ? getErrorFromCode(rawError, t) : null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmationSent, setConfirmationSent] = useState(false);

  const passwordValidation = useMemo(() => validatePassword(password), [password]);

  useEffect(() => {
    if (!loading && user) {
      router.replace(`/${locale}`);
    }
  }, [user, loading, router, locale]);

  const handleGoogleSignIn = async () => {
    try {
      setSubmitting(true);
      setError(null);
      await signInWithGoogle();
    } catch {
      setError(t("auth.errors.generic"));
      setSubmitting(false);
    }
  };

  const handleAppleSignIn = async () => {
    try {
      setSubmitting(true);
      setError(null);
      await signInWithApple();
    } catch {
      setError(t("auth.errors.appleLoginFailed"));
      setSubmitting(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSignUp) {
      if (!name.trim()) {
        setError(t("auth.errors.nameRequired"));
        return;
      }
      const checks = passwordValidation.checks;
      if (!checks.minLength) {
        setError(t("auth.errors.passwordTooShort", { minLength: PASSWORD_MIN_LENGTH }));
        return;
      }
      if (!checks.lowercase) {
        setError(t("auth.errors.passwordMissingLowercase"));
        return;
      }
      if (!checks.uppercase) {
        setError(t("auth.errors.passwordMissingUppercase"));
        return;
      }
      if (!checks.digit) {
        setError(t("auth.errors.passwordMissingDigit"));
        return;
      }
      if (!checks.symbol) {
        setError(t("auth.errors.passwordMissingSymbol"));
        return;
      }
    } else if (password.length < PASSWORD_MIN_LENGTH) {
      setError(t("auth.errors.passwordTooShort", { minLength: PASSWORD_MIN_LENGTH }));
      return;
    }
    try {
      setSubmitting(true);
      setError(null);
      setConfirmationSent(false);
      if (isSignUp) {
        const success = await signUpWithEmail(email, password, name.trim());
        if (success) {
          setConfirmationSent(true);
        }
      } else {
        await signInWithEmail(email, password);
      }
    } catch (err: unknown) {
      setError(formatAuthError(err, isSignUp ? "signup" : "signin", t));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <LoadingSpinner size="lg" message={t("import.loading")} />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md w-full space-y-6 bg-card p-6 sm:p-8 md:p-10 rounded-2xl shadow-xl">
        <div className="text-center flex flex-col items-center">
          <SwimHubTimerIcon className="w-28 h-28 mx-auto mb-4" />
          <h2 className="text-xl sm:text-2xl font-extrabold text-foreground mb-2">
            {isSignUp ? t("auth.signUp") : t("common.appName")}
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground">
            {isSignUp ? t("auth.createAccount") : t("import.subtitle")}
          </p>
        </div>

        {error && !confirmationSent && (
          <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg">
            <div className="flex items-start">
              <svg
                className="w-5 h-5 text-red-400 mt-0.5 mr-3 shrink-0"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
              <div className="text-sm leading-relaxed">{error}</div>
            </div>
          </div>
        )}

        {confirmationSent ? (
          <div className="p-4 bg-green-50 border border-green-200 text-green-700 rounded-lg">
            <div className="flex items-start">
              <svg
                className="w-5 h-5 text-green-400 mt-0.5 mr-3 shrink-0"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              <div>
                <p className="font-medium">{t("auth.confirmEmailSent")}</p>
                <p className="mt-1 text-sm">{t("auth.confirmEmailDesc")}</p>
              </div>
            </div>
            <button
              type="button"
              className="mt-3 text-sm text-primary underline hover:text-primary/80"
              onClick={() => {
                setConfirmationSent(false);
                setIsSignUp(false);
                setError(null);
                setName("");
                setEmail("");
                setPassword("");
              }}
            >
              {t("auth.backToLogin")}
            </button>
          </div>
        ) : (
        <>
        <div className="space-y-3">
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={submitting}
            className="w-full flex items-center justify-center gap-3 py-3 px-4 border border-border rounded-lg text-sm font-medium text-foreground bg-card hover:bg-muted focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            {t("auth.loginMethod.withGoogle")}
          </button>
          <button
            type="button"
            onClick={handleAppleSignIn}
            disabled={submitting}
            className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-lg text-sm font-medium text-white bg-black hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
            </svg>
            {t("auth.loginMethod.withApple")}
          </button>
        </div>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-card px-3 text-muted-foreground">{t("auth.or")}</span>
          </div>
        </div>

        <form onSubmit={handleEmailSubmit} className="space-y-3">
          {isSignUp && (
            <input
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("auth.namePlaceholder")}
              required
              disabled={submitting}
              className="w-full py-3 px-4 border border-border rounded-lg text-sm bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50"
            />
          )}
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("auth.emailPlaceholder")}
            required
            disabled={submitting}
            className="w-full py-3 px-4 border border-border rounded-lg text-sm bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50"
          />
          <input
            type="password"
            autoComplete={isSignUp ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("auth.passwordPlaceholder")}
            required
            disabled={submitting}
            className="w-full py-3 px-4 border border-border rounded-lg text-sm bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50"
          />
          {isSignUp && <PasswordRequirementsList checks={passwordValidation.checks} t={t} />}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 px-4 rounded-lg text-sm font-medium text-white bg-primary hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out"
          >
            {isSignUp ? t("auth.signUp") : t("auth.signIn")}
          </button>
          <button
            type="button"
            onClick={() => {
              setIsSignUp(!isSignUp);
              setError(null);
              setConfirmationSent(false);
            }}
            className="w-full text-xs text-muted-foreground hover:text-foreground transition"
          >
            {isSignUp ? t("auth.switchToSignIn") : t("auth.switchToSignUp")}
          </button>
        </form>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-card px-3 text-muted-foreground">{t("auth.or")}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => router.replace(`/${locale}`)}
          className="w-full py-3 px-4 rounded-lg text-sm font-medium text-muted-foreground border border-border hover:bg-muted focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out"
        >
          {t("auth.continueAsGuest")}
        </button>
        </>
        )}

        <p className="text-center text-xs text-muted-foreground">
          {(() => {
            const full = t("auth.termsAgree");
            const terms = t("auth.terms");
            const privacy = t("privacy.title");
            const parts = full.split(new RegExp(`(${terms}|${privacy})`));
            return parts.map((part, i) => {
              if (part === terms) {
                return (
                  <Link
                    key={i}
                    href={`/${locale}/terms`}
                    className="text-primary underline hover:text-primary/80"
                  >
                    {terms}
                  </Link>
                );
              }
              if (part === privacy) {
                return (
                  <Link
                    key={i}
                    href={`/${locale}/privacy`}
                    className="text-primary underline hover:text-primary/80"
                  >
                    {privacy}
                  </Link>
                );
              }
              return part;
            });
          })()}
        </p>
      </div>
    </div>
  );
}

// useSearchParams はプリレンダー時に Suspense 境界が必須
// (I18nProvider が SSR でも children を描画するようになり顕在化)
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <LoadingSpinner size="lg" />
        </div>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}

function PasswordRequirementsList({
  checks,
  t,
}: {
  checks: PasswordChecks;
  t: TFunction;
}) {
  const items: { key: keyof PasswordChecks; label: string }[] = [
    { key: "minLength", label: t("auth.passwordRequirements.minLength") },
    { key: "lowercase", label: t("auth.passwordRequirements.lowercase") },
    { key: "uppercase", label: t("auth.passwordRequirements.uppercase") },
    { key: "digit", label: t("auth.passwordRequirements.digit") },
    { key: "symbol", label: t("auth.passwordRequirements.symbol") },
  ];
  return (
    <div className="space-y-1 rounded-lg border border-border bg-muted/30 p-3">
      <p className="text-xs font-medium text-muted-foreground">
        {t("auth.passwordRequirements.title")}
      </p>
      <ul className="space-y-1">
        {items.map(({ key, label }) => {
          const met = checks[key];
          return (
            <li
              key={key}
              className={`flex items-center gap-2 text-xs ${
                met ? "text-emerald-600" : "text-muted-foreground"
              }`}
            >
              {met ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              ) : (
                <span
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 rounded-full border border-border"
                />
              )}
              <span>{label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
