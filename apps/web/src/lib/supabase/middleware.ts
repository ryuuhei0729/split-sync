import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Supabase セッションを更新し、レンダリングへ引き渡すレスポンスを返す。
 *
 * @param request 受信リクエスト (Cookie 更新のため直接 mutate される)
 * @param extraRequestHeaders レンダリング側のリクエストヘッダーに追加する値
 *   (middleware.ts が CSP nonce / Content-Security-Policy を渡す)。
 *   NextRequest を再構築せずに済むよう、`NextResponse.next({ request: { headers } })`
 *   の公式パターンでオーバーライドする。
 */
export async function updateSession(
  request: NextRequest,
  extraRequestHeaders?: Record<string, string>,
) {
  // request.cookies.set() の結果 (Supabase のトークンリフレッシュ) を取り込むため、
  // 呼び出しのたびに request.headers を読み直してから追加ヘッダーを重ねる。
  const nextWithHeaders = () => {
    const headers = new Headers(request.headers);
    for (const [key, value] of Object.entries(extraRequestHeaders ?? {})) {
      headers.set(key, value);
    }
    return NextResponse.next({ request: { headers } });
  };

  let response = nextWithHeaders();
  const pathname = request.nextUrl.pathname;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = nextWithHeaders();
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Redirect locale-less public paths to default locale
  const publicPaths = ["/terms", "/privacy", "/support"];
  if (publicPaths.includes(pathname)) {
    return NextResponse.redirect(new URL(`/ja${pathname}`, request.url));
  }

  // Locale prefix detection: /ja, /en, etc.
  const localeMatch = pathname.match(/^\/([a-z]{2})(\/|$)/);
  const locale = localeMatch ? localeMatch[1] : "ja";
  const rawPathWithoutLocale = localeMatch
    ? pathname.slice(localeMatch[0].length - (localeMatch[2] === "/" ? 1 : 0))
    : pathname;
  const pathWithoutLocale = rawPathWithoutLocale === "" ? "/" : rawPathWithoutLocale;

  // Logged in + accessing login → redirect to home
  if (user && pathWithoutLocale === "/login") {
    return NextResponse.redirect(new URL(`/${locale}`, request.url));
  }

  return response;
}
