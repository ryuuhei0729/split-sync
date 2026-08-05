import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/api-helpers";
import { getStripe } from "@/lib/stripe";

const DELETE_STORAGE_MAX_ATTEMPTS = 3;
const DELETE_STORAGE_RETRY_BASE_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * auth.admin.deleteUser() が「ユーザーが既に存在しない」ことを理由に失敗したかを判定する。
 *
 * GoTrue (Supabase Auth) はこの場合 HTTP 404 + code "user_not_found" を返す
 * (@supabase/auth-js の AuthApiError#status / #code)。同一ユーザーへの2重送信
 * (二重クリック・複数アプリからのほぼ同時退会) で2回目以降のリクエストがこれに該当する。
 * 削除の目的は「ユーザーが存在しないこと」であり、既に存在しないなら目的は達成済みのため、
 * これは失敗ではなく成功として扱う。メッセージの部分一致ではなく status/code で判定する
 * (メッセージ文言はローカライズ・バージョンで変わり得るため)。
 */
function isUserAlreadyDeletedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { status, code } = error as { status?: unknown; code?: unknown };
  return status === 404 && code === "user_not_found";
}

/**
 * delete-user-storage Edge Function を呼び出す (指数バックオフで最大3回試行)。
 *
 * swim-hub / swimhub-scanner と同じ Supabase プロジェクトを共有しており、
 * どのアプリから退会しても画像・動画ストレージを確実に削除する必要がある。
 * Stripe 解約と同じ思想で、最終的に失敗した場合は auth.admin.deleteUser() を呼ばせず、
 * 「アカウントは消えたのにファイルが残る」孤児ストレージを防ぐ。
 * リトライ間隔は 500ms → 1000ms → 2000ms (3回試行)。
 */
async function invokeDeleteUserStorageWithRetry(
  adminClient: SupabaseClient,
  userId: string,
): Promise<{ success: boolean; errors?: string[] }> {
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= DELETE_STORAGE_MAX_ATTEMPTS; attempt++) {
    try {
      const { data, error } = await adminClient.functions.invoke<{
        success: boolean;
        errors?: string[];
      }>("delete-user-storage", { body: { userId } });

      if (!error && data?.success) {
        return { success: true };
      }

      lastError = error ? error.message : JSON.stringify(data?.errors ?? data ?? "unknown error");
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }

    if (attempt < DELETE_STORAGE_MAX_ATTEMPTS) {
      await sleep(DELETE_STORAGE_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }

  return { success: false, errors: lastError ? [lastError] : ["unknown error"] };
}

export async function DELETE(request: NextRequest) {
  // Bearer token (mobile) と cookie セッション (web) の両方に対応
  const authResult = await verifyAuth(request);
  if ("error" in authResult) {
    return authResult.error;
  }
  const { uid } = authResult.result;

  try {
    const adminClient = createAdminClient();

    const { data: sub } = (await adminClient
      .from("user_subscriptions")
      .select("stripe_customer_id")
      .eq("id", uid)
      .single()) as { data: { stripe_customer_id: string | null } | null };

    const customerId = sub?.stripe_customer_id ?? null;

    if (customerId) {
      try {
        const stripe = getStripe();
        const activeSubscriptions = await stripe.subscriptions.list({
          customer: customerId,
          status: "active",
        });
        await Promise.all(
          activeSubscriptions.data.map((subscription) =>
            stripe.subscriptions.cancel(subscription.id),
          ),
        );
        // サブスクリプションを解約した上で顧客自体も削除し、課金情報を残さない
        await stripe.customers.del(customerId);
      } catch (stripeError) {
        // Stripe 解約に失敗した場合はアカウント削除自体を中断し、
        // 「削除されたのに課金が続く」孤児サブスクリプションを防ぐ
        console.error("Stripe subscription cancellation error:", stripeError);
        return NextResponse.json(
          { error: "サブスクリプションの解約に失敗しました。時間をおいて再度お試しください" },
          { status: 500 },
        );
      }
    }

    // ストレージ（画像・動画）削除。失敗したら中断し、孤児ストレージを防ぐ
    const storageResult = await invokeDeleteUserStorageWithRetry(adminClient, uid);
    if (!storageResult.success) {
      console.error("Storage deletion error (failed after retries):", storageResult.errors);
      return NextResponse.json(
        { error: "ストレージの削除に失敗しました。時間をおいて再度お試しください" },
        { status: 500 },
      );
    }

    // Stripe / ストレージ側の後片付けが完了してから auth user を削除する。
    // user_subscriptions 行は ON DELETE CASCADE で自動的に削除される。
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(uid);

    if (deleteError && !isUserAlreadyDeletedError(deleteError)) {
      console.error("User deletion error:", deleteError);
      return NextResponse.json({ error: "アカウントの削除に失敗しました" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Account deletion error:", error);
    return NextResponse.json({ error: "サーバーエラーが発生しました" }, { status: 500 });
  }
}
