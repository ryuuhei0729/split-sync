import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// --- Types ---

interface RevenueCatEvent {
  type: string;
  app_user_id: string;
  product_id: string;
  entitlement_ids: string[];
  period_type: "TRIAL" | "NORMAL" | "INTRO";
  purchased_at_ms: number;
  expiration_at_ms: number | null;
  store: "APP_STORE" | "PLAY_STORE" | "STRIPE" | "PROMOTIONAL";
  environment: "PRODUCTION" | "SANDBOX";
  original_transaction_id: string;
  transaction_id: string;
}

interface RevenueCatWebhookBody {
  api_version: string;
  event: RevenueCatEvent;
}

// --- Helpers ---

type SupabaseClient = ReturnType<typeof createClient>;

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function notifySlack(appName: string, message: string): Promise<void> {
  const url = Deno.env.get("SLACK_WEBHOOK_URL");
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `[${appName}] ${message}` }),
    });
  } catch {
    // Slack 通知失敗はサイレントに無視
  }
}

function msToISO(ms: number | null | undefined): string | null {
  if (!ms) return null;
  return new Date(ms).toISOString();
}

// --- Auth ---

function verifyAuthorization(req: Request, expectedToken: string): boolean {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return false;

  const expected = `Bearer ${expectedToken}`;
  if (authHeader.length !== expected.length) return false;

  const encoder = new TextEncoder();
  const a = encoder.encode(authHeader);
  const b = encoder.encode(expected);
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

// --- Idempotency ---

type IdempotencyResult = "ok" | "duplicate" | "error";

async function tryMarkAsProcessed(
  supabase: SupabaseClient,
  transactionId: string,
  appName: string,
): Promise<IdempotencyResult> {
  try {
    const { error } = await supabase
      .from("processed_webhook_events")
      .insert({
        event_id: `rc_${transactionId}`,
        processed_at: new Date().toISOString(),
      });

    if (error) {
      // 23505 = unique_violation → 既に処理済み
      if (error.code === "23505") return "duplicate";
      // その他のエラー（テーブル未存在含む）は処理を中断
      console.error(`[${appName}] tryMarkAsProcessed error:`, error);
      return "error";
    }
    return "ok";
  } catch (err) {
    console.error(`[${appName}] tryMarkAsProcessed unexpected error:`, err);
    return "error";
  }
}

// --- Duplicate Subscription Check ---

async function hasActiveStripeSubscription(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("user_subscriptions")
    .select("provider, status")
    .eq("id", userId)
    .single();

  if (
    data?.provider === "stripe" &&
    (data.status === "active" || data.status === "trialing")
  ) {
    return true;
  }
  return false;
}

// --- Event Mapping ---

function mapEventToUpdate(event: RevenueCatEvent): Record<string, unknown> | null {
  const base = {
    provider: "revenucat",
    provider_subscription_id: event.original_transaction_id,
    // サンドボックス由来でも Premium 付与ロジックは変えない(App Store 審査員の購入は
    // SANDBOX として届くため)。ただし監査・失効判断のため取引環境は常に記録する。
    provider_environment: event.environment === "SANDBOX" ? "sandbox" : "production",
    premium_expires_at: msToISO(event.expiration_at_ms),
    current_period_start: msToISO(event.purchased_at_ms),
    updated_at: new Date().toISOString(),
  };

  switch (event.type) {
    case "INITIAL_PURCHASE":
    case "RENEWAL":
    case "PRODUCT_CHANGE":
    case "UNCANCELLATION":
      return {
        ...base,
        plan: "premium",
        status: event.period_type === "TRIAL" ? "trialing" : "active",
        trial_start: event.period_type === "TRIAL" ? msToISO(event.purchased_at_ms) : null,
        trial_end: event.period_type === "TRIAL" ? msToISO(event.expiration_at_ms) : null,
        cancel_at_period_end: false,
      };

    case "CANCELLATION":
      return {
        ...base,
        plan: "premium",
        status: "canceled",
        cancel_at_period_end: true,
      };

    case "EXPIRATION":
      return {
        ...base,
        plan: "free",
        status: "expired",
        cancel_at_period_end: false,
      };

    case "BILLING_ISSUE":
      return {
        ...base,
        plan: "premium",
        status: "past_due",
      };

    default:
      return null;
  }
}

// --- Factory ---

export function createRevenueCatWebhookHandler(appName: string) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    try {
      if (req.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      const webhookAuth = Deno.env.get("REVENUCAT_WEBHOOK_AUTH");
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

      if (!webhookAuth || !supabaseUrl || !supabaseServiceRoleKey) {
        console.error(`[${appName}] Missing required environment variables`);
        return jsonResponse({ error: "Server configuration error" }, 500);
      }

      if (!verifyAuthorization(req, webhookAuth)) {
        console.error(`[${appName}] Invalid webhook authorization`);
        return jsonResponse({ error: "Unauthorized" }, 401);
      }

      const body: RevenueCatWebhookBody = await req.json();
      const event = body.event;

      if (!event || !event.type) {
        return jsonResponse({ error: "Invalid webhook payload" }, 400);
      }

      console.log(`[${appName}] RevenueCat event: ${event.type} | user: ${event.app_user_id} | product: ${event.product_id} | env: ${event.environment}`);

      const userId = event.app_user_id;
      if (!userId || userId.startsWith("$RCAnonymousID:")) {
        console.error(`[${appName}] No valid user ID. app_user_id:`, userId);
        return jsonResponse(
          { error: "app_user_id is anonymous. Ensure Purchases.logIn(supabaseUserId) is called." },
          400,
        );
      }

      // event.environment はランタイムで検証されていない未知の値も届き得る。ここを
      // 通さずに mapEventToUpdate() へ渡すと、欠落・未知値がすべて "production" として
      // 記録され、監査・失効判断に使う provider_environment が汚染される。
      if (event.environment !== "PRODUCTION" && event.environment !== "SANDBOX") {
        console.error(`[${appName}] Invalid or missing event.environment:`, event.environment);
        return jsonResponse({ error: "Invalid or missing event.environment" }, 400);
      }

      const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

      // Idempotency check: at-most-once processing using transaction_id
      const idempotencyResult = await tryMarkAsProcessed(supabase, event.transaction_id, appName);
      if (idempotencyResult === "duplicate") {
        console.log(`[${appName}] Already processed transaction: ${event.transaction_id}`);
        return jsonResponse({ received: true, message: "Already processed" });
      }
      if (idempotencyResult === "error") {
        console.error(`[${appName}] Idempotency check failed for transaction: ${event.transaction_id}`);
        return jsonResponse({ error: "Idempotency check failed" }, 500);
      }

      if (event.type === "INITIAL_PURCHASE") {
        const hasStripe = await hasActiveStripeSubscription(supabase, userId);
        if (hasStripe) {
          console.error(`[${appName}] User already has active Stripe subscription:`, userId);
          return jsonResponse(
            { error: "User already has an active subscription via Stripe" },
            409,
          );
        }
      }

      const update = mapEventToUpdate(event);
      if (!update) {
        console.log(`[${appName}] Unhandled event type:`, event.type);
        return jsonResponse({ received: true, message: "Event not handled" });
      }

      const { error } = await supabase
        .from("user_subscriptions")
        .update(update)
        .eq("id", userId);

      if (error) {
        console.error(`[${appName}] Supabase update error (${event.type}):`, error);
        return jsonResponse({ error: "Failed to update subscription" }, 500);
      }

      console.log(`[${appName}] Successfully processed ${event.type} for user ${userId}`);
      return jsonResponse({ received: true });
    } catch (err) {
      console.error(`[${appName}] Unexpected error in revenucat-webhook:`, err);
      await notifySlack(appName, `RevenueCat Webhook error: ${err}`);
      return jsonResponse({ error: "Internal server error" }, 500);
    }
  };
}
