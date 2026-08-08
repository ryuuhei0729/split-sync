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
 *     - script-src は 'nonce-<random>' を持ち 'unsafe-inline' を含まない (M-1)
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

// updateSession をモック。
// 実際の updateSession は内部で `NextResponse.next({ request })` を呼び、request
// ヘッダーをそのまま x-middleware-override-headers 経由でレンダリングに引き渡す。
// x-nonce 伝播 (attachNonceRequestHeaderOverride) の検証にはこの挙動の再現が必須。
vi.mock("@/lib/supabase/middleware", () => ({
  updateSession: vi.fn().mockImplementation((req: NextRequest) => {
    return Promise.resolve(
      NextResponse.next({ request: { headers: new Headers(req.headers) } }),
    );
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

    // M-1 (Sprint Contract V22): 'unsafe-inline' は script-src から除去され、
    // リクエストごとの nonce に置き換わっている。
    it("script-src に 'unsafe-inline' が含まれない (M-1)", async () => {
      const { middleware } = await import("../middleware");
      const res = await middleware(makeGetRequest("/ja"));
      const csp = res.headers.get("Content-Security-Policy") ?? "";
      const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src")) ?? "";
      expect(scriptSrc).not.toContain("'unsafe-inline'");
    });

    it("script-src に 'self' とリクエストごとの nonce-<random> が含まれる (M-1)", async () => {
      const { middleware } = await import("../middleware");
      const res1 = await middleware(makeGetRequest("/ja"));
      const res2 = await middleware(makeGetRequest("/ja"));
      const csp1 = res1.headers.get("Content-Security-Policy") ?? "";
      const csp2 = res2.headers.get("Content-Security-Policy") ?? "";
      const nonceMatch1 = csp1.match(/'nonce-([^']+)'/);
      const nonceMatch2 = csp2.match(/'nonce-([^']+)'/);
      expect(csp1).toContain("script-src 'self' 'nonce-");
      expect(nonceMatch1?.[1]).toBeTruthy();
      expect(nonceMatch2?.[1]).toBeTruthy();
      expect(nonceMatch1?.[1]).not.toBe(nonceMatch2?.[1]);
    });

    it("CSP ヘッダーの nonce と x-middleware-request-x-nonce が一致する (M-1)", async () => {
      const { middleware } = await import("../middleware");
      const res = await middleware(makeGetRequest("/ja"));
      const csp = res.headers.get("Content-Security-Policy") ?? "";
      const nonceInCsp = csp.match(/'nonce-([^']+)'/)?.[1];
      expect(nonceInCsp).toBeTruthy();
      expect(res.headers.get("x-middleware-request-x-nonce")).toBe(nonceInCsp);
    });

    // C-1 (再検証): Next.js は「リクエストヘッダーの Content-Security-Policy」から
    // 自前で nonce を正規表現抽出し、RSC の自動生成インラインスクリプト
    // (self.__next_f.push(...)) にその nonce を適用する (app-render.js の
    // getScriptNonceFromHeader)。x-nonce だけでは JSON-LD 用の値しか伝わらず、
    // Next.js 自身が生成するスクリプトには届かない。この経路が意図通り機能しているかを
    // 「リクエストヘッダーに Content-Security-Policy がオーバーライドされ、
    // レスポンスヘッダーの CSP と同一の nonce を含む」ことで検証する
    // (Playwright 不在のため、これが HTTP レベルで到達できる最大限の証拠)。
    it("C-1: リクエストヘッダーの Content-Security-Policy が override され、レスポンスの CSP と同じ nonce を含む", async () => {
      const { middleware } = await import("../middleware");
      const res = await middleware(makeGetRequest("/ja"));
      const responseCsp = res.headers.get("Content-Security-Policy") ?? "";
      const nonceInResponseCsp = responseCsp.match(/'nonce-([^']+)'/)?.[1];
      expect(nonceInResponseCsp).toBeTruthy();

      const overrideKeys = (res.headers.get("x-middleware-override-headers") ?? "")
        .split(",")
        .map((k) => k.trim());
      expect(overrideKeys).toContain("content-security-policy");

      const requestCsp = res.headers.get("x-middleware-request-content-security-policy") ?? "";
      const nonceInRequestCsp = requestCsp.match(/'nonce-([^']+)'/)?.[1];
      expect(nonceInRequestCsp).toBe(nonceInResponseCsp);
    });

    it("C-1: 自作の x-nonce override ヘルパーが撤去され、公式の NextRequest 差し替えパターンに置換されている", async () => {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const source = fs.readFileSync(
        path.resolve(__dirname, "../middleware.ts"),
        "utf-8",
      );
      expect(source).not.toContain("attachNonceRequestHeaderOverride");
      expect(source).toContain("new NextRequest(request");
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

    it("connect-src に blob: が含まれる (FFmpeg WASM ワーカーが blob から Fetch)", async () => {
      const { middleware } = await import("../middleware");
      const res = await middleware(makeGetRequest("/ja"));
      const csp = res.headers.get("Content-Security-Policy") ?? "";
      const connectSrc = csp.split(";").find((d) => d.trim().startsWith("connect-src")) ?? "";
      expect(connectSrc).toContain("blob:");
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
