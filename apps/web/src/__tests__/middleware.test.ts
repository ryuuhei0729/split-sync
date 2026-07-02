/**
 * Issue #27 + #17: middleware セキュリティヘッダーテスト — swimhub-timer
 *
 * Sprint Contract 検証観点:
 *   [Issue #27] 4 種のセキュリティヘッダーが全ルートのレスポンスに付与される
 *     - X-Frame-Options: DENY
 *     - X-Content-Type-Options: nosniff
 *     - Referrer-Policy: strict-origin-when-cross-origin
 *     - Permissions-Policy: camera=(), microphone=(), geolocation=()
 *
 *   [Issue #17] CSP ヘッダー (強制モード, timer 固有) が付与される
 *     - script-src に 'wasm-unsafe-eval' が含まれる (FFmpeg WASM 必須)
 *     - worker-src 'self' blob: が含まれる (FFmpeg WASM 必須)
 *     - connect-src に https://pub-22903ca2ced04f30b26d6f3838248897.r2.dev が含まれる
 *     - frame-ancestors 'none'
 *     - object-src 'none'
 *     ※ Report-Only ではなく Content-Security-Policy ヘッダーを使用すること
 *
 * テスト対象: src/middleware.ts
 */

import { NextRequest, NextResponse } from "next/server";
import { describe, expect, it, vi } from "vitest";

// updateSession をモック
vi.mock("@/lib/supabase/middleware", () => ({
  updateSession: vi.fn().mockImplementation(() => {
    return Promise.resolve(NextResponse.next());
  }),
}));

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------
function makeGetRequest(path: string = "/ja"): NextRequest {
  return new NextRequest(`http://localhost${path}`, { method: "GET" });
}

// ---------------------------------------------------------------------------
// テスト本体
// ---------------------------------------------------------------------------
describe("timer middleware — セキュリティヘッダー", () => {
  // -------------------------------------------------------------------------
  // Issue #27: セキュリティヘッダー 4 種
  // -------------------------------------------------------------------------
  describe("[Issue #27] X-Frame-Options / X-Content-Type-Options / Referrer-Policy / Permissions-Policy", () => {
    it("X-Frame-Options: DENY が設定される", async () => {
      const { middleware } = await import("../middleware");
      const res = await middleware(makeGetRequest("/ja"));
      expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    });

    it("X-Content-Type-Options: nosniff が設定される", async () => {
      const { middleware } = await import("../middleware");
      const res = await middleware(makeGetRequest("/ja"));
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    });

    it("Referrer-Policy: strict-origin-when-cross-origin が設定される", async () => {
      const { middleware } = await import("../middleware");
      const res = await middleware(makeGetRequest("/ja"));
      expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    });

    it("Permissions-Policy: camera=(), microphone=(), geolocation=() が設定される", async () => {
      const { middleware } = await import("../middleware");
      const res = await middleware(makeGetRequest("/ja"));
      expect(res.headers.get("Permissions-Policy")).toBe(
        "camera=(), microphone=(), geolocation=()",
      );
    });

    it("ルート '/' でもヘッダーが付与される", async () => {
      const { middleware } = await import("../middleware");
      const res = await middleware(makeGetRequest("/"));
      expect(res.headers.get("X-Frame-Options")).toBe("DENY");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    });
  });

  // -------------------------------------------------------------------------
  // Issue #17: CSP ヘッダー (timer 固有)
  // -------------------------------------------------------------------------
  describe("[Issue #17] Content-Security-Policy", () => {
    it("Content-Security-Policy ヘッダーが存在する (Report-Only ではない)", async () => {
      const { middleware } = await import("../middleware");
      const res = await middleware(makeGetRequest("/ja"));
      expect(res.headers.get("Content-Security-Policy")).not.toBeNull();
      expect(res.headers.get("Content-Security-Policy-Report-Only")).toBeNull();
    });

    it("default-src 'self' が含まれる", async () => {
      const { middleware } = await import("../middleware");
      const res = await middleware(makeGetRequest("/ja"));
      const csp = res.headers.get("Content-Security-Policy") ?? "";
      expect(csp).toContain("default-src 'self'");
    });

    it("script-src に 'wasm-unsafe-eval' が含まれる (FFmpeg WASM 必須)", async () => {
      const { middleware } = await import("../middleware");
      const res = await middleware(makeGetRequest("/ja"));
      const csp = res.headers.get("Content-Security-Policy") ?? "";
      expect(csp).toContain("'wasm-unsafe-eval'");
    });

    it("script-src に 'unsafe-inline' が含まれる", async () => {
      const { middleware } = await import("../middleware");
      const res = await middleware(makeGetRequest("/ja"));
      const csp = res.headers.get("Content-Security-Policy") ?? "";
      expect(csp).toContain("script-src");
      expect(csp).toContain("'unsafe-inline'");
    });

    it("script-src に blob: が含まれる (FFmpeg WASM core/worker を blob スクリプトでロード)", async () => {
      const { middleware } = await import("../middleware");
      const res = await middleware(makeGetRequest("/ja"));
      const csp = res.headers.get("Content-Security-Policy") ?? "";
      const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src")) ?? "";
      expect(scriptSrc).toContain("blob:");
    });

    it("worker-src 'self' blob: が含まれる (FFmpeg WASM 必須)", async () => {
      const { middleware } = await import("../middleware");
      const res = await middleware(makeGetRequest("/ja"));
      const csp = res.headers.get("Content-Security-Policy") ?? "";
      expect(csp).toContain("worker-src");
      expect(csp).toContain("blob:");
    });

    it("connect-src に R2 CDN URL が含まれる (FFmpeg WASM アセット)", async () => {
      const { middleware } = await import("../middleware");
      const res = await middleware(makeGetRequest("/ja"));
      const csp = res.headers.get("Content-Security-Policy") ?? "";
      expect(csp).toContain("https://pub-22903ca2ced04f30b26d6f3838248897.r2.dev");
    });

    it("connect-src に Supabase と Stripe が含まれる", async () => {
      const { middleware } = await import("../middleware");
      const res = await middleware(makeGetRequest("/ja"));
      const csp = res.headers.get("Content-Security-Policy") ?? "";
      expect(csp).toContain("https://*.supabase.co");
      expect(csp).toContain("wss://*.supabase.co");
      expect(csp).toContain("https://api.stripe.com");
    });

    it("frame-ancestors 'none' が含まれる", async () => {
      const { middleware } = await import("../middleware");
      const res = await middleware(makeGetRequest("/ja"));
      const csp = res.headers.get("Content-Security-Policy") ?? "";
      expect(csp).toContain("frame-ancestors 'none'");
    });

    it("object-src 'none' が含まれる", async () => {
      const { middleware } = await import("../middleware");
      const res = await middleware(makeGetRequest("/ja"));
      const csp = res.headers.get("Content-Security-Policy") ?? "";
      expect(csp).toContain("object-src 'none'");
    });

    it("style-src 'self' 'unsafe-inline' が含まれる", async () => {
      const { middleware } = await import("../middleware");
      const res = await middleware(makeGetRequest("/ja"));
      const csp = res.headers.get("Content-Security-Policy") ?? "";
      expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    });
  });
});
