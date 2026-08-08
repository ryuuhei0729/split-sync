/**
 * Sprint Contract V19 (M-9) — swimhub-timer
 *
 * 検証観点:
 *   - stripe_customer_id が DB 未キャッシュのとき、user.id の UUID 形式を検証する
 *   - 不正形式 ID は 400 "不正なユーザーIDです" を返し、
 *     stripe.customers.search が一度も呼ばれないこと
 *   - 正常 UUID は search に到達する (400 にならない)
 *
 * timer の認証パターン: createServerComponentClient → supabase.auth.getUser()
 */

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/stripe", () => ({
  getStripe: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerComponentClient: vi.fn(),
}));

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/stripe/portal", {
    method: "POST",
    headers: { "Content-Type": "application/json", referer: "http://localhost/ja/settings" },
  });
}

function makeMockSupabase(uid: string, authError: Error | null = null) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: authError ? { user: null } : { user: { id: uid, email: "test@example.com" } },
        error: authError,
      }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          // stripe_customer_id 未キャッシュ → UUID 検証経路に入る
          single: vi.fn().mockResolvedValue({ data: { stripe_customer_id: null }, error: null }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    }),
  };
}

describe("POST /api/stripe/portal (timer) — UUID 検証 (V19)", () => {
  let mockGetStripe: ReturnType<typeof vi.fn>;
  let mockCreateServerComponentClient: ReturnType<typeof vi.fn>;
  let customersSearchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetAllMocks();

    const stripeModule = await import("@/lib/stripe");
    mockGetStripe = vi.mocked(stripeModule.getStripe);
    customersSearchMock = vi.fn().mockResolvedValue({ data: [{ id: "cus_test123" }] });
    mockGetStripe.mockReturnValue({
      customers: { search: customersSearchMock },
      billingPortal: {
        sessions: { create: vi.fn().mockResolvedValue({ url: "https://billing.stripe.com/x" }) },
      },
    });

    const supabaseModule = await import("@/lib/supabase/server");
    mockCreateServerComponentClient = vi.mocked(supabaseModule.createServerComponentClient);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("不正 user.id は 400 を返し stripe.customers.search を呼ばない", () => {
    const invalidIds = [
      { label: '"invalid" 文字列', id: "invalid" },
      { label: "空文字", id: "" },
      { label: "SQL インジェクション断片", id: "' OR '1'='1" },
      { label: "ハイフンなし 32 桁 hex", id: "550e8400e29b41d4a716446655440000" },
    ];

    for (const { label, id } of invalidIds) {
      it(`${label} → 400 "不正なユーザーIDです"`, async () => {
        mockCreateServerComponentClient.mockResolvedValue(makeMockSupabase(id));
        const { POST } = await import("./route");
        const res = await POST(makeRequest());
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toBe("不正なユーザーIDです");
        expect(customersSearchMock).not.toHaveBeenCalled();
      });
    }
  });

  it("有効 UUID は UUID 検証を通過し stripe.customers.search に到達する", async () => {
    mockCreateServerComponentClient.mockResolvedValue(
      makeMockSupabase("550e8400-e29b-41d4-a716-446655440000"),
    );
    const { POST } = await import("./route");
    const res = await POST(makeRequest());
    expect(customersSearchMock).toHaveBeenCalledTimes(1);
    expect(res.status).not.toBe(400);
  });

  it("未認証リクエストは 401 を返す", async () => {
    mockCreateServerComponentClient.mockResolvedValue(
      makeMockSupabase("", new Error("not authenticated")),
    );
    const { POST } = await import("./route");
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(customersSearchMock).not.toHaveBeenCalled();
  });
});
