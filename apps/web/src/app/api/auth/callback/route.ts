import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { defaultLocale } from "@swimhub-timer/i18n";

/**
 * redirectToパラメータを検証・サニタイズする
 * - '/'で始まる相対パスのみ許可（スキーム付きURLは拒否）
 * - プロトコル相対URL（//evil.com）を拒否
 * - CR/LFや制御文字を含まないことを確認
 * - 無効な値の場合はデフォルトパスにフォールバック
 * - デコード後の値に対してバリデーションを実行（二重エンコード攻撃を防止）
 * - URLコンストラクタで同一オリジン確認（オープンリダイレクト対策）
 */
function validateRedirectPath(redirectTo: string | null, origin?: string, locale?: string): string {
  const defaultPath = `/${locale || "en"}`;

  if (!redirectTo) {
    return defaultPath;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(redirectTo);
  } catch {
    return defaultPath;
  }

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(decoded)) {
    return defaultPath;
  }

  if (decoded.startsWith("//") || /^\/\//.test(decoded)) {
    return defaultPath;
  }

  if (!decoded.startsWith("/")) {
    return defaultPath;
  }

  for (let i = 0; i < decoded.length; i++) {
    const charCode = decoded.charCodeAt(i);
    if (
      (charCode >= 0x00 && charCode <= 0x1f) ||
      charCode === 0x7f ||
      (charCode >= 0x80 && charCode <= 0x9f)
    ) {
      return defaultPath;
    }
  }

  if (decoded.includes("..")) {
    return defaultPath;
  }

  if (origin) {
    try {
      const resolvedUrl = new URL(decoded, origin);
      if (resolvedUrl.origin !== origin) {
        return defaultPath;
      }
    } catch {
      return defaultPath;
    }
  }

  return decoded;
}

/**
 * メール確認 (signup / recovery / email_change 等) の token_hash + type で
 * 使用可能な OTP 種別。Supabase の EmailOtpType のサブセット（invite は対象外）。
 */
type OtpType = "signup" | "recovery" | "email_change" | "email" | "magiclink";

const OTP_TYPES: readonly OtpType[] = ["signup", "recovery", "email_change", "email", "magiclink"];

function isOtpType(value: string | null): value is OtpType {
  return value !== null && (OTP_TYPES as readonly string[]).includes(value);
}

/**
 * OTP種別からデフォルトの遷移先パスを導出する。
 * timer web には現状 recovery/email_change 専用画面が存在しないため、
 * いずれの種別も既存の signup 確認後遷移先（ロケールルート）を維持する。
 */
function getDefaultRedirectForOtpType(_type: OtpType, locale: string): string {
  return `/${locale}`;
}

type CookieToSet = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};

function createCallbackSupabaseClient(request: NextRequest, cookieStore: Awaited<ReturnType<typeof cookies>>) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  const cookiesToSet: CookieToSet[] = [];
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        const storeCookies = cookieStore.getAll();
        const requestCookies = request.cookies.getAll().map((c) => ({
          name: c.name,
          value: c.value || "",
        }));

        const cookieMap = new Map(storeCookies.map((c) => [c.name, c.value]));
        requestCookies.forEach((c) => {
          if (!cookieMap.has(c.name)) {
            cookieMap.set(c.name, c.value);
          }
        });

        return Array.from(cookieMap.entries()).map(([name, value]) => ({
          name,
          value,
        }));
      },
      setAll(cookies: CookieToSet[]) {
        cookiesToSet.push(...cookies);
      },
    },
  });

  return { supabase, cookiesToSet };
}

/**
 * token_hash + type を使ったメール確認フロー（PKCEを使わない）
 * signup / recovery / email_change のメールリンクはこちらで処理する
 */
async function handleVerifyOtpFlow(
  request: NextRequest,
  requestUrl: URL,
  tokenHash: string,
  typeParam: string | null,
  locale: string,
): Promise<NextResponse> {
  if (!isOtpType(typeParam)) {
    console.error("メール確認コールバックエラー: 不明なtypeパラメータ", { typeParam });
    return NextResponse.redirect(requestUrl.origin + `/${locale}/login?error=invalid_request`);
  }

  const redirectToParam = requestUrl.searchParams.get("redirect_to");
  const redirectTo = redirectToParam
    ? validateRedirectPath(redirectToParam, requestUrl.origin, locale)
    : getDefaultRedirectForOtpType(typeParam, locale);

  // try の外で宣言し、catch でも Cookie 反映(applyCookies)できるようにする
  let cookiesToSet: CookieToSet[] = [];

  try {
    const cookieStore = await cookies();
    const clientResult = createCallbackSupabaseClient(request, cookieStore);
    if (!clientResult) {
      return NextResponse.redirect(requestUrl.origin + `/${locale}/login?error=config_error`);
    }
    const { supabase } = clientResult;
    cookiesToSet = clientResult.cookiesToSet;

    const { data, error } = await supabase.auth.verifyOtp({
      type: typeParam,
      token_hash: tokenHash,
    });

    if (error) {
      console.error("メール確認コールバックエラー:", error);
      const errorCode = error.code ?? "auth_failed";
      const errorResponse = NextResponse.redirect(
        requestUrl.origin + `/${locale}/login?error=${encodeURIComponent(errorCode)}`,
      );
      applyCookies(errorResponse, cookiesToSet);
      return errorResponse;
    }

    if (!data.session) {
      console.error("メール確認コールバックエラー: セッションが作成されませんでした");
      const errorResponse = NextResponse.redirect(
        requestUrl.origin + `/${locale}/login?error=session_creation_failed`,
      );
      applyCookies(errorResponse, cookiesToSet);
      return errorResponse;
    }

    const successResponse = NextResponse.redirect(requestUrl.origin + redirectTo);
    applyCookies(successResponse, cookiesToSet);
    return successResponse;
  } catch (error) {
    console.error("メール確認コールバックエラー:", error);
    const errorResponse = NextResponse.redirect(
      requestUrl.origin + `/${locale}/login?error=auth_failed`,
    );
    applyCookies(errorResponse, cookiesToSet);
    return errorResponse;
  }
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  // ブラウザ言語検出 / cookie 永続化は行わず、scanner・swim-hub と同様にデフォルトロケールへ。
  const locale = defaultLocale;

  // token_hash + type がある場合は verifyOtp フローを優先する（PM裁定: codeより優先）
  const tokenHash = requestUrl.searchParams.get("token_hash");
  if (tokenHash) {
    return handleVerifyOtpFlow(
      request,
      requestUrl,
      tokenHash,
      requestUrl.searchParams.get("type"),
      locale,
    );
  }

  const code = requestUrl.searchParams.get("code");
  const redirectTo = validateRedirectPath(
    requestUrl.searchParams.get("redirect_to"),
    requestUrl.origin,
    locale,
  );

  if (!code) {
    return NextResponse.redirect(requestUrl.origin + `/${locale}/login?error=missing_code`);
  }

  // try の外で宣言し、catch でも Cookie 反映(applyCookies)できるようにする
  let cookiesToSet: CookieToSet[] = [];

  try {
    const cookieStore = await cookies();
    const clientResult = createCallbackSupabaseClient(request, cookieStore);
    if (!clientResult) {
      return NextResponse.redirect(requestUrl.origin + `/${locale}/login?error=config_error`);
    }
    const { supabase } = clientResult;
    cookiesToSet = clientResult.cookiesToSet;

    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      console.error("OAuth callback error:", error);
      const errorResponse = NextResponse.redirect(
        requestUrl.origin + `/${locale}/login?error=auth_failed`,
      );
      applyCookies(errorResponse, cookiesToSet);
      return errorResponse;
    }

    const successResponse = NextResponse.redirect(requestUrl.origin + redirectTo);
    applyCookies(successResponse, cookiesToSet);
    return successResponse;
  } catch (error) {
    console.error("OAuth callback error:", error);
    const catchResponse = NextResponse.redirect(
      requestUrl.origin + `/${locale}/login?error=auth_failed`,
    );
    applyCookies(catchResponse, cookiesToSet);
    return catchResponse;
  }
}

function applyCookies(
  response: NextResponse,
  cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[],
) {
  cookiesToSet.forEach((cookie) => {
    response.cookies.set(cookie.name, cookie.value, {
      ...(cookie.options as Record<string, string | boolean | number | Date>),
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
  });
}
