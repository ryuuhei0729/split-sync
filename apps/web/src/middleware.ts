import { updateSession } from "@/lib/supabase/middleware";
import { NextRequest } from "next/server";

// NEXT_PUBLIC_SUPABASE_URL の origin を CSP connect-src に動的注入
// ローカル Supabase (http://127.0.0.1:54321) やセルフホストなど *.supabase.co に
// マッチしない URL でもブラウザからの fetch/WebSocket を許可する
const SUPABASE_ORIGIN = (() => {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    return url ? new URL(url).origin : "";
  } catch {
    return "";
  }
})();
const SUPABASE_WS_ORIGIN = SUPABASE_ORIGIN.replace(/^http/, "ws");

// FFmpeg WASM の配信元を CSP connect-src に動的注入
// apps/web/src/lib/video/ffmpeg-manager.ts と同じ優先順位で origin を決定し、
// env で R2 以外の CDN に切り替えたデプロイでも CSP が追従するようにする
const FFMPEG_R2_ORIGIN = "https://pub-22903ca2ced04f30b26d6f3838248897.r2.dev";
const FFMPEG_ORIGIN = (() => {
  const configured = process.env.NEXT_PUBLIC_FFMPEG_BASE_URL?.trim();
  if (!configured) return FFMPEG_R2_ORIGIN;
  try {
    return new URL(configured).origin;
  } catch {
    return FFMPEG_R2_ORIGIN;
  }
})();

// CSP nonce をリクエストごとに生成する (Edge Runtime 互換: Web Crypto API を使用)
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

// CSP (Issue #17) — timer は FFmpeg WASM 用に wasm-unsafe-eval / worker-src blob: / R2 を許可
function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    // blob: は FFmpeg WASM が core を blob URL のスクリプトとしてロードするため必須
    // static.cloudflareinsights.com は Cloudflare Web Analytics のビーコンスクリプト
    // JSON-LD の inline <script> はリクエストごとの nonce で許可する ('unsafe-inline' は使わない)
    `script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval' blob: https://static.cloudflareinsights.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.supabase.co",
    "media-src 'self' blob:",
    "font-src 'self'",
    [
      // blob: は FFmpeg WASM ワーカーが core/wasm を blob URL から Fetch でロードするため必須
      "connect-src 'self' blob:",
      SUPABASE_ORIGIN,
      SUPABASE_WS_ORIGIN,
      "https://*.supabase.co",
      "wss://*.supabase.co",
      "https://api.stripe.com",
      // Cloudflare Web Analytics のビーコン送信先
      "https://cloudflareinsights.com",
      FFMPEG_ORIGIN,
    ]
      .filter(Boolean)
      .join(" "),
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

export async function middleware(request: NextRequest) {
  const nonce = generateNonce();
  const csp = buildCsp(nonce);

  // Next.js は「リクエストヘッダーの Content-Security-Policy」から nonce を自前で
  // 正規表現抽出し (getScriptNonceFromHeader)、RSC ストリーミングの自動生成インライン
  // スクリプト (self.__next_f.push(...)) にその nonce を使う。x-nonce だけでは JSON-LD
  // 用の値しか伝わらず、Next.js 自身が生成するスクリプトには適用されないため、
  // Content-Security-Policy 自体もリクエストヘッダーに乗せる必要がある。
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  // input が Request インスタンスの場合、NextRequest は super(input, init) を呼ぶため
  // cookies / nextUrl も新しい headers から正しく再構築される。
  const requestWithNonce = new NextRequest(request, { headers: requestHeaders });

  // updateSession() 内部の NextResponse.next({ request }) が requestWithNonce.headers を
  // そのまま x-middleware-override-headers 経由でレンダリングに引き渡す (updateSession
  // 自体は無変更)。
  const response = await updateSession(requestWithNonce);

  // セキュリティヘッダー (Issue #27)
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  // CSP (Issue #17)
  response.headers.set("Content-Security-Policy", csp);

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest\\.webmanifest|sitemap\\.xml|robots\\.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
