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

    // 2. Stripe Customer を取得（DB キャッシュ優先）
    const stripe = getStripe();

    const { data: subData } = await supabase
      .from("user_subscriptions")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .single();

    let customerId: string | null = subData?.stripe_customer_id ?? null;

    if (!customerId) {
      // user.id の UUID 形式を検証（Search API injection 防止）
      const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!UUID_REGEX.test(user.id)) {
        return NextResponse.json({ error: "不正なユーザーIDです" }, { status: 400 });
      }

      const existingCustomers = await stripe.customers.search({
        query: `metadata["supabase_user_id"]:"${user.id}"`,
      });

      if (existingCustomers.data.length === 0) {
        return NextResponse.json({ error: "Stripe の顧客情報が見つかりません" }, { status: 404 });
      }

      // The "not found" (length === 0) branch above already returned, so index 0 exists here.
      customerId = existingCustomers.data[0]!.id;

      await supabase
        .from("user_subscriptions")
        .update({ stripe_customer_id: customerId })
        .eq("id", user.id);
    }

    // 3. Customer Portal Session 作成
    const origin = new URL(request.url).origin;
    const referer = request.headers.get("referer") ?? "";
    const localeMatch = referer.match(/\/(ja|en)\//);
    const locale = localeMatch ? localeMatch[1] : "ja";

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/${locale}/settings`,
    });

    // 4. session.url を返却
    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Stripe Portal エラー:", error);
    return NextResponse.json({ error: "ポータルセッションの作成に失敗しました" }, { status: 500 });
  }
}
