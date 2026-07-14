import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/api-helpers";
import { getStripe } from "@/lib/stripe";

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

    // Stripe 側の後片付けが完了してから auth user を削除する。
    // user_subscriptions 行は ON DELETE CASCADE で自動的に削除される。
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(uid);

    if (deleteError) {
      console.error("User deletion error:", deleteError);
      return NextResponse.json({ error: "アカウントの削除に失敗しました" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Account deletion error:", error);
    return NextResponse.json({ error: "サーバーエラーが発生しました" }, { status: 500 });
  }
}
