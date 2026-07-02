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

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  // ブラウザ言語検出 / cookie 永続化は行わず、scanner・swim-hub と同様にデフォルトロケールへ。
  const locale = defaultLocale;
  const redirectTo = validateRedirectPath(
    requestUrl.searchParams.get("redirect_to"),
    requestUrl.origin,
    locale,
  );

  if (!code) {
    return NextResponse.redirect(requestUrl.origin + `/${locale}/login?error=missing_code`);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.redirect(requestUrl.origin + `/${locale}/login?error=config_error`);
  }

  type CookieToSet = {
    name: string;
    value: string;
    options?: Record<string, unknown>;
  };
  const cookiesToSet: CookieToSet[] = [];

  try {
    const cookieStore = await cookies();

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
