// QA (Sprint Contract V-03): DELETE /api/user/delete のストレージ削除失敗時の
// フェイルクローズ動作を検証する。
//
// 観点:
//   1. delete-user-storage Edge Function 呼び出しがリトライしても失敗し続けた場合、
//      auth.admin.deleteUser() が一切呼ばれないこと。
//   2. 呼び出し元は 500 を返すこと。
//   3. リトライは最大3回まで試行されること。
//   4. Stripe 解約が成功した後でもストレージ削除が失敗すれば deleteUser は呼ばれない
//      (Stripe → ストレージ → deleteUser の順序どおり後段で止まること)。
//   5. 認証が無効な場合、ストレージ削除にもdeleteUserにも到達しないこと。
//
// トートロジー回避: 実ルートハンドラ (DELETE) を import し、依存
// (@/lib/api-helpers の verifyAuth, @/lib/supabase/server の createAdminClient,
// @/lib/stripe の getStripe) のみを vi.mock で差し替える。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const verifyAuthMock = vi.fn();
vi.mock("@/lib/api-helpers", () => ({
  verifyAuth: (...args: unknown[]) => verifyAuthMock(...args),
}));

const stripeSubscriptionsListMock = vi.fn();
const stripeSubscriptionsCancelMock = vi.fn();
const stripeCustomersDelMock = vi.fn();

vi.mock("@/lib/stripe", () => ({
  getStripe: vi.fn(() => ({
    subscriptions: {
      list: (...args: unknown[]) => stripeSubscriptionsListMock(...args),
      cancel: (...args: unknown[]) => stripeSubscriptionsCancelMock(...args),
    },
    customers: { del: (...args: unknown[]) => stripeCustomersDelMock(...args) },
  })),
}));

const subscriptionSelectMock = vi.fn();
const functionsInvokeMock = vi.fn();
const deleteUserMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === "user_subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              single: () => subscriptionSelectMock(),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    functions: { invoke: (...args: unknown[]) => functionsInvokeMock(...args) },
    auth: { admin: { deleteUser: (...args: unknown[]) => deleteUserMock(...args) } },
  })),
}));

import { DELETE } from "@/app/api/user/delete/route";

const VALID_UID = "timer-user-under-test";

function makeAuthedRequest(): NextRequest {
  return new NextRequest("http://localhost/api/user/delete", {
    method: "DELETE",
    headers: { Authorization: "Bearer valid-access-token" },
  });
}

describe("DELETE /api/user/delete (timer) - ストレージ削除失敗時のフェイルクローズ", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    verifyAuthMock.mockReset();
    subscriptionSelectMock.mockReset().mockResolvedValue({ data: { stripe_customer_id: null } });
    functionsInvokeMock.mockReset();
    deleteUserMock.mockReset().mockResolvedValue({ error: null });
    stripeSubscriptionsListMock.mockReset().mockResolvedValue({ data: [] });
    stripeSubscriptionsCancelMock.mockReset().mockResolvedValue({});
    stripeCustomersDelMock.mockReset().mockResolvedValue({});
    verifyAuthMock.mockResolvedValue({ result: { uid: VALID_UID, email: "a@example.com" } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("Stripe顧客が無いユーザーで、ストレージ削除が3回とも失敗したら deleteUser を呼ばず500を返す", async () => {
    functionsInvokeMock.mockResolvedValue({
      data: null,
      error: { message: "edge function down" },
    });

    const promise = DELETE(makeAuthedRequest());
    await vi.runAllTimersAsync();
    const response = await promise;

    expect(response.status).toBe(500);
    expect(functionsInvokeMock).toHaveBeenCalledTimes(3);
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it("Stripe顧客ありでStripe解約に成功しても、ストレージ削除が失敗すれば deleteUser は呼ばれない", async () => {
    subscriptionSelectMock.mockResolvedValue({ data: { stripe_customer_id: "cus_test_123" } });
    functionsInvokeMock.mockResolvedValue({ data: null, error: { message: "edge function down" } });

    const promise = DELETE(makeAuthedRequest());
    await vi.runAllTimersAsync();
    const response = await promise;

    expect(response.status).toBe(500);
    expect(stripeCustomersDelMock).toHaveBeenCalledWith("cus_test_123");
    expect(functionsInvokeMock).toHaveBeenCalledTimes(3);
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it("3回目のリトライで成功したら deleteUser が呼ばれ200が返る", async () => {
    functionsInvokeMock
      .mockResolvedValueOnce({ data: null, error: { message: "cold start" } })
      .mockResolvedValueOnce({ data: null, error: { message: "cold start" } })
      .mockResolvedValueOnce({ data: { success: true }, error: null });

    const promise = DELETE(makeAuthedRequest());
    await vi.runAllTimersAsync();
    const response = await promise;
    const body = await response.json();

    expect(functionsInvokeMock).toHaveBeenCalledTimes(3);
    expect(deleteUserMock).toHaveBeenCalledTimes(1);
    expect(deleteUserMock).toHaveBeenCalledWith(VALID_UID);
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("認証が無効な場合、ストレージ削除にもdeleteUserにも到達しない", async () => {
    const { NextResponse } = await import("next/server");
    verifyAuthMock.mockResolvedValue({
      error: NextResponse.json({ error: "認証が必要です" }, { status: 401 }),
    });

    const response = await DELETE(makeAuthedRequest());

    expect(response.status).toBe(401);
    expect(functionsInvokeMock).not.toHaveBeenCalled();
    expect(deleteUserMock).not.toHaveBeenCalled();
  });
});

// QA追記 (PM依頼): isUserAlreadyDeletedError による deleteUser 冪等性の固定。
// ローカル GoTrue で実測した実物の AuthApiError の形
// ({ __isAuthError: true, name: "AuthApiError", status: 404, code: "user_not_found" })
// に基づく。判定が広すぎないことも併せて固定する (swim-hub/scanner と同一の観点)。
describe("DELETE /api/user/delete (timer) - deleteUser 冪等性 (already-deleted は成功扱い)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    verifyAuthMock.mockReset();
    subscriptionSelectMock.mockReset().mockResolvedValue({ data: { stripe_customer_id: null } });
    functionsInvokeMock.mockReset().mockResolvedValue({ data: { success: true }, error: null });
    deleteUserMock.mockReset();
    verifyAuthMock.mockResolvedValue({ result: { uid: VALID_UID, email: "a@example.com" } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("実測したGoTrueの形 (status:404, code:user_not_found) では200になり退会成功扱いになる", async () => {
    deleteUserMock.mockResolvedValue({
      error: {
        __isAuthError: true,
        name: "AuthApiError",
        status: 404,
        code: "user_not_found",
        message: "User not found",
      },
    });

    const promise = DELETE(makeAuthedRequest());
    await vi.runAllTimersAsync();
    const response = await promise;
    const body = (await response.json()) as { success: boolean };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("status:500 (無関係なエラー) では従来通り500になる", async () => {
    deleteUserMock.mockResolvedValue({
      error: { status: 500, code: "unexpected_failure", message: "boom" },
    });

    const response = await DELETE(makeAuthedRequest());

    expect(response.status).toBe(500);
  });

  it("status:404だがcodeがuser_not_found以外なら500になる (codeも見ていることの証明)", async () => {
    deleteUserMock.mockResolvedValue({
      error: { status: 404, code: "some_other_not_found", message: "not found but different" },
    });

    const response = await DELETE(makeAuthedRequest());

    expect(response.status).toBe(500);
  });

  it("code:user_not_foundだがstatusが404以外なら500になる (statusも見ていることの証明)", async () => {
    deleteUserMock.mockResolvedValue({
      error: { status: 400, code: "user_not_found", message: "malformed" },
    });

    const response = await DELETE(makeAuthedRequest());

    expect(response.status).toBe(500);
  });

  it("status/codeを持たない汎用エラーでは500になる (すべてのエラーを成功扱いにしていないことの証明)", async () => {
    deleteUserMock.mockResolvedValue({ error: { message: "generic network error" } });

    const response = await DELETE(makeAuthedRequest());

    expect(response.status).toBe(500);
  });
});
