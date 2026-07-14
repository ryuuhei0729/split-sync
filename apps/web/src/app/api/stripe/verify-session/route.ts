import { NextRequest, NextResponse } from "next/server";
import { createServerComponentClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerComponentClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const body = await request.json();
    const { sessionId } = body as { sessionId: string };
    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json(
        { error: "sessionId は必須です" },
        { status: 400 },
      );
    }

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription"],
    });

    if (session.payment_status !== "paid" && session.status !== "complete") {
      return NextResponse.json(
        { error: "支払いが完了していません" },
        { status: 400 },
      );
    }

    const subscription = session.subscription;
    if (!subscription || typeof subscription === "string") {
      const subId = typeof subscription === "string" ? subscription : null;
      if (!subId) {
        return NextResponse.json(
          { error: "サブスクリプションが見つかりません" },
          { status: 400 },
        );
      }
      const sub = await stripe.subscriptions.retrieve(subId);
      // Session 所有者の検証
      if (sub.metadata?.supabase_user_id !== user.id) {
        return NextResponse.json({ error: "不正なセッションです" }, { status: 403 });
      }
      return await updateSubscription(supabase, user.id, sub);
    }

    // Session 所有者の検証
    if (subscription.metadata?.supabase_user_id !== user.id) {
      return NextResponse.json({ error: "不正なセッションです" }, { status: 403 });
    }
    return await updateSubscription(supabase, user.id, subscription);
  } catch (error) {
    console.error("Stripe Session 検証エラー:", error);
    return NextResponse.json(
      { error: "セッションの検証に失敗しました" },
      { status: 500 },
    );
  }
}

function unixToISO(ts: number | null | undefined): string | null {
  if (!ts) return null;
  return new Date(ts * 1000).toISOString();
}

async function updateSubscription(
  supabase: SupabaseClient,
  userId: string,
  subscription: {
    id: string;
    status: string;
    current_period_start: number;
    current_period_end: number;
    cancel_at_period_end: boolean;
    trial_start: number | null;
    trial_end: number | null;
  },
) {
  // Only grant premium for a genuinely active/trialing subscription. A session
  // can be "paid/complete" while the subscription is still incomplete, past_due,
  // unpaid, etc.; forcing those to "active" premium (the old behaviour) granted
  // access the customer hadn't actually paid for. Fail closed and let the
  // webhook (handleSubscriptionUpdated) reconcile once the real status settles.
  const ACTIVE_STATUSES = ["active", "trialing"];
  if (!ACTIVE_STATUSES.includes(subscription.status)) {
    return NextResponse.json(
      {
        error: "サブスクリプションがまだ有効化されていません",
        subscriptionStatus: subscription.status,
      },
      { status: 409 },
    );
  }
  const status = subscription.status === "trialing" ? "trialing" : "active";
  const { error } = await supabase
    .from("user_subscriptions")
    .update({
      plan: "premium",
      status,
      provider: "stripe",
      provider_subscription_id: subscription.id,
      premium_expires_at: unixToISO(subscription.current_period_end),
      current_period_start: unixToISO(subscription.current_period_start),
      cancel_at_period_end: subscription.cancel_at_period_end,
      trial_start: unixToISO(subscription.trial_start),
      trial_end: unixToISO(subscription.trial_end),
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (error) {
    console.error("Supabase update error:", error);
    return NextResponse.json(
      { error: "サブスクリプションの更新に失敗しました" },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, plan: "premium", status });
}
