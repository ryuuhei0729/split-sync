import { updateSession } from "@/lib/supabase/middleware";
import type { NextRequest } from "next/server";

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

// CSP (Issue #17) — timer は FFmpeg WASM 用に wasm-unsafe-eval / worker-src blob: / R2 を許可
const CSP = [
  "default-src 'self'",
  // blob: は FFmpeg WASM (マルチスレッド版) が core/worker を blob URL のスクリプトとしてロードするため必須
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co",
  "media-src 'self' blob:",
  "font-src 'self'",
  [
    "connect-src 'self'",
    SUPABASE_ORIGIN,
    SUPABASE_WS_ORIGIN,
    "https://*.supabase.co",
    "wss://*.supabase.co",
    "https://api.stripe.com",
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

export async function middleware(request: NextRequest) {
  const response = await updateSession(request);

  // セキュリティヘッダー (Issue #27)
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  // CSP (Issue #17)
  response.headers.set("Content-Security-Policy", CSP);

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest\\.webmanifest|sitemap\\.xml|robots\\.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
