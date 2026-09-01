import { NextRequest, NextResponse } from "next/server";
import { createServerComponentClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";

export async function POST(request: NextRequest) {
  try {
    // 1. 認証チェック
    const supabase = await createServerComponentClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    // 2. リクエストボディから priceId を取得
    const body = await request.json();
    const { priceId } = body as { priceId: string };

    if (!priceId || typeof priceId !== "string") {
      return NextResponse.json({ error: "priceId は必須です" }, { status: 400 });
    }

    // 許可された Price ID のホワイトリスト検証
    const allowedPriceIds = [
      process.env.NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID,
      process.env.NEXT_PUBLIC_STRIPE_YEARLY_PRICE_ID,
    ].filter(Boolean);

    if (allowedPriceIds.length === 0) {
      return NextResponse.json({ error: "サーバー設定エラーが発生しました" }, { status: 500 });
    }
    if (!allowedPriceIds.includes(priceId)) {
      return NextResponse.json({ error: "無効な priceId です" }, { status: 400 });
    }

    // UUID 形式検証 (Issue #2) — user.id を外部呼び出し / DB クエリに渡す前にガード
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(user.id)) {
      return NextResponse.json({ error: "不正なユーザーIDです" }, { status: 400 });
    }

    // 3. user_subscriptions テーブルから現在のプラン・trial_start を確認
    const { data: subscription } = (await supabase
      .from("user_subscriptions")
      .select("plan, status, trial_start, stripe_customer_id")
      .eq("id", user.id)
      .single()) as {
      data: { plan: string; status: string | null; trial_start: string | null; stripe_customer_id: string | null } | null;
      error: unknown;
    };

    // 既にアクティブなサブスクリプションがある場合は重複購入を防止
    const activeStatuses = ["active", "trialing"];
    if (
      subscription?.plan === "premium" &&
      subscription?.status &&
      activeStatuses.includes(subscription.status)
    ) {
      return NextResponse.json(
        { error: "すでにプレミアムプランに加入しています" },
        { status: 409 },
      );
    }

    const hasUsedTrial = subscription?.trial_start != null;

    // 4. Stripe Customer を取得または作成（DB キャッシュ優先で Search API の遅延を回避）
    const stripe = getStripe();

    let customerId: string;

    if (subscription?.stripe_customer_id) {
      customerId = subscription.stripe_customer_id;
    } else {
      const existingCustomers = await stripe.customers.search({
        query: `metadata["supabase_user_id"]:"${user.id}"`,
      });

      if (existingCustomers.data.length > 0) {
        // existingCustomers.data.length > 0 is checked in this same if-block, same array/scope.
        customerId = existingCustomers.data[0]!.id;
      } else {
        const newCustomer = await stripe.customers.create({
          email: user.email,
          metadata: {
            supabase_user_id: user.id,
          },
        });
        customerId = newCustomer.id;
      }

      await supabase
        .from("user_subscriptions")
        .update({ stripe_customer_id: customerId })
        .eq("id", user.id);
    }

    // 5. Checkout Session 作成
    // timer はロケール対応 ([locale]) のため、設定画面パスにロケールプレフィックスを含める
    const origin = new URL(request.url).origin;
    const referer = request.headers.get("referer") ?? "";
    const localeMatch = referer.match(/\/(ja|en)\//);
    const locale = localeMatch ? localeMatch[1] : "ja";

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/${locale}/settings?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/${locale}/settings`,
      subscription_data: {
        trial_period_days: hasUsedTrial ? undefined : 7,
        metadata: {
          supabase_user_id: user.id,
        },
      },
    });

    // 6. session.url を返却
    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Stripe Checkout エラー:", error);
    return NextResponse.json({ error: "Checkout セッションの作成に失敗しました" }, { status: 500 });
  }
}
