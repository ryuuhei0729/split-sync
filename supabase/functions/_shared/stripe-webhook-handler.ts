import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@17";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// --- Stripe Signature Verification (crypto.subtle for Deno) ---

function parseSignatureHeader(header: string): { timestamp: string; signatures: string[] } {
  const parts = header.split(",");
  let timestamp = "";
  const signatures: string[] = [];

  for (const part of parts) {
    const [key, value] = part.split("=");
    if (key.trim() === "t") {
      timestamp = value.trim();
    } else if (key.trim() === "v1") {
      signatures.push(value.trim());
    }
  }

  return { timestamp, signatures };
}

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyStripeSignature(
  payload: string,
  signatureHeader: string,
  secret: string,
): Promise<boolean> {
  const { timestamp, signatures } = parseSignatureHeader(signatureHeader);

  if (!timestamp || signatures.length === 0) {
    return false;
  }

  // Reject if timestamp is older than 5 minutes
  const timestampAge = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  if (timestampAge > 300) {
    return false;
  }

  const signedPayload = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signatureBuffer = await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload));
  const expectedSignature = uint8ArrayToHex(new Uint8Array(signatureBuffer));

  // Constant-time comparison via matching against all provided v1 signatures
  return signatures.some((sig) => {
    if (sig.length !== expectedSignature.length) return false;
    const a = hexToUint8Array(sig);
    const b = hexToUint8Array(expectedSignature);
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a[i] ^ b[i];
    }
    return result === 0;
  });
}

// --- Helpers ---

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

function unixToISO(ts: number | null | undefined): string | null {
  if (ts == null) return null;
  return new Date(ts * 1000).toISOString();
}

async function resolveUserId(
  stripe: Stripe,
  subscription: Stripe.Subscription,
  appName: string,
): Promise<string | null> {
  const subUserId = subscription.metadata?.supabase_user_id;
  if (subUserId) return subUserId;

  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;

  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (customer.deleted) return null;
    return (customer as Stripe.Customer).metadata?.supabase_user_id ?? null;
  } catch (err) {
    console.error(`[${appName}] Failed to retrieve Stripe customer:`, err);
    return null;
  }
}

// --- Idempotency ---
// at-most-once semantics: アトミックなINSERTで重複チェックと処理開始マークを同時に行う。
// 処理開始後にハンドラが失敗した場合、リトライは受け付けない（二重課金防止を優先）。
// 処理漏れが発生した場合はサポートで個別対応する想定。

type IdempotencyResult = "ok" | "duplicate" | "error";

async function tryMarkAsProcessed(
  supabase: SupabaseClient,
  eventId: string,
  appName: string,
): Promise<IdempotencyResult> {
  try {
    const { error } = await supabase
      .from("processed_webhook_events")
      .insert({ event_id: eventId, processed_at: new Date().toISOString() });

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

// --- Event Handlers ---

async function handleSubscriptionCreated(
  supabase: SupabaseClient,
  stripe: Stripe,
  subscription: Stripe.Subscription,
  appName: string,
): Promise<Response> {
  const userId = await resolveUserId(stripe, subscription, appName);
  if (!userId) {
    console.error(`[${appName}] No supabase_user_id found for subscription:`, subscription.id);
    return jsonResponse({ error: "User ID not found in subscription or customer metadata" }, 400);
  }

  const status = subscription.status === "trialing" ? "trialing" : "active";

  const now = new Date().toISOString();
  const upsertData = {
    id: userId,
    plan: "premium",
    status,
    provider: "stripe",
    provider_subscription_id: subscription.id,
    premium_expires_at: unixToISO(subscription.current_period_end),
    current_period_start: unixToISO(subscription.current_period_start),
    cancel_at_period_end: subscription.cancel_at_period_end,
    trial_start: unixToISO(subscription.trial_start),
    trial_end: unixToISO(subscription.trial_end),
    updated_at: now,
  };

  const { error } = await supabase
    .from("user_subscriptions")
    .upsert(upsertData, { onConflict: "id" });

  if (error) {
    console.error(`[${appName}] Supabase upsert error (subscription.created):`, error);
    return jsonResponse({ error: "Failed to update subscription" }, 500);
  }

  return jsonResponse({ received: true });
}

async function handleSubscriptionUpdated(
  supabase: SupabaseClient,
  stripe: Stripe,
  subscription: Stripe.Subscription,
  appName: string,
): Promise<Response> {
  const userId = await resolveUserId(stripe, subscription, appName);
  if (!userId) {
    console.error(`[${appName}] No supabase_user_id found for subscription:`, subscription.id);
    return jsonResponse({ error: "User ID not found in subscription or customer metadata" }, 400);
  }

  let plan = "premium";
  let status = subscription.status as string;

  if (subscription.status === "canceled") {
    plan = "free";
    status = "expired";
  } else if (subscription.status === "trialing") {
    status = "trialing";
  } else if (subscription.status === "active") {
    status = "active";
  } else if (subscription.status === "past_due") {
    status = "past_due";
  }

  const { error } = await supabase
    .from("user_subscriptions")
    .update({
      plan,
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
    console.error(`[${appName}] Supabase update error (subscription.updated):`, error);
    return jsonResponse({ error: "Failed to update subscription" }, 500);
  }

  return jsonResponse({ received: true });
}

async function handleSubscriptionDeleted(
  supabase: SupabaseClient,
  stripe: Stripe,
  subscription: Stripe.Subscription,
  appName: string,
): Promise<Response> {
  const userId = await resolveUserId(stripe, subscription, appName);
  if (!userId) {
    console.error(`[${appName}] No supabase_user_id found for subscription:`, subscription.id);
    return jsonResponse({ error: "User ID not found in subscription or customer metadata" }, 400);
  }

  const { error } = await supabase
    .from("user_subscriptions")
    .update({
      plan: "free",
      status: "expired",
      provider: null,
      provider_subscription_id: null,
      cancel_at_period_end: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (error) {
    console.error(`[${appName}] Supabase update error (subscription.deleted):`, error);
    return jsonResponse({ error: "Failed to update subscription" }, 500);
  }

  return jsonResponse({ received: true });
}

async function handleInvoicePaymentSucceeded(
  supabase: SupabaseClient,
  stripe: Stripe,
  invoice: Stripe.Invoice,
  appName: string,
): Promise<Response> {
  const subscriptionId =
    typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;

  if (!subscriptionId) {
    return jsonResponse({ received: true, message: "Non-subscription invoice, skipped" });
  }

  let subscription: Stripe.Subscription;
  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId);
  } catch (err) {
    console.error(`[${appName}] Failed to retrieve subscription for invoice:`, err);
    return jsonResponse({ error: "Failed to retrieve subscription" }, 500);
  }

  const userId = await resolveUserId(stripe, subscription, appName);
  if (!userId) {
    console.error(`[${appName}] No supabase_user_id found for invoice subscription:`, subscriptionId);
    return jsonResponse({ error: "User ID not found" }, 400);
  }

  const { error } = await supabase
    .from("user_subscriptions")
    .update({
      status: "active",
      current_period_start: unixToISO(subscription.current_period_start),
      premium_expires_at: unixToISO(subscription.current_period_end),
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (error) {
    console.error(`[${appName}] Supabase update error (invoice.payment_succeeded):`, error);
    return jsonResponse({ error: "Failed to update subscription" }, 500);
  }

  return jsonResponse({ received: true });
}

async function handleInvoicePaymentFailed(
  supabase: SupabaseClient,
  stripe: Stripe,
  invoice: Stripe.Invoice,
  appName: string,
): Promise<Response> {
  const subscriptionId =
    typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;

  if (!subscriptionId) {
    return jsonResponse({ received: true, message: "Non-subscription invoice, skipped" });
  }

  let subscription: Stripe.Subscription;
  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId);
  } catch (err) {
    console.error(`[${appName}] Failed to retrieve subscription for invoice:`, err);
    return jsonResponse({ error: "Failed to retrieve subscription" }, 500);
  }

  const userId = await resolveUserId(stripe, subscription, appName);
  if (!userId) {
    console.error(`[${appName}] No supabase_user_id found for invoice subscription:`, subscriptionId);
    return jsonResponse({ error: "User ID not found" }, 400);
  }

  const { error } = await supabase
    .from("user_subscriptions")
    .update({
      status: "past_due",
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (error) {
    console.error(`[${appName}] Supabase update error (invoice.payment_failed):`, error);
    return jsonResponse({ error: "Failed to update subscription" }, 500);
  }

  return jsonResponse({ received: true });
}

// --- Factory ---

// 複数の Webhook シークレットを収集する
// 同一 Supabase プロジェクトで複数 Stripe エンドポイントを受ける場合、
// エンドポイントごとに署名シークレットが異なるため、すべて試行する
function collectWebhookSecrets(): string[] {
  const secrets: string[] = [];
  const base = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (base) secrets.push(base);

  // STRIPE_WEBHOOK_SECRET_SCANNER, STRIPE_WEBHOOK_SECRET_TIMER 等
  for (const suffix of ["SCANNER", "TIMER"]) {
    const val = Deno.env.get(`STRIPE_WEBHOOK_SECRET_${suffix}`);
    if (val) secrets.push(val);
  }
  return secrets;
}

export function createStripeWebhookHandler(appName: string) {
  return async (req: Request): Promise<Response> => {
    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    try {
      if (req.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      const webhookSecrets = collectWebhookSecrets();
      const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

      if (webhookSecrets.length === 0 || !stripeSecretKey || !supabaseUrl || !supabaseServiceRoleKey) {
        console.error(`[${appName}] Missing required environment variables`);
        return jsonResponse({ error: "Server configuration error" }, 500);
      }

      const body = await req.text();

      const signatureHeader = req.headers.get("stripe-signature");
      if (!signatureHeader) {
        return jsonResponse({ error: "Missing stripe-signature header" }, 401);
      }

      // 複数シークレットを順番に試行（エンドポイントごとに署名が異なるため）
      let isValid = false;
      for (const secret of webhookSecrets) {
        if (await verifyStripeSignature(body, signatureHeader, secret)) {
          isValid = true;
          break;
        }
      }
      if (!isValid) {
        console.error(`[${appName}] Invalid Stripe webhook signature (tried ${webhookSecrets.length} secrets)`);
        return jsonResponse({ error: "Invalid signature" }, 401);
      }

      const event: Stripe.Event = JSON.parse(body);

      const stripe = new Stripe(stripeSecretKey, {
        apiVersion: "2025-02-24.acacia",
      });

      const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

      // アトミックなINSERTで重複チェックと処理済みマークを同時に行う
      // at-most-once: 処理開始後に失敗してもリトライは受け付けない（二重処理防止優先）
      const idempotencyResult = await tryMarkAsProcessed(supabase, event.id, appName);
      if (idempotencyResult === "duplicate") {
        console.log(`[${appName}] イベント ${event.id} は処理済みのためスキップ`);
        return jsonResponse({ received: true, message: "Already processed" });
      }
      if (idempotencyResult === "error") {
        console.error(`[${appName}] 冪等性チェックに失敗。イベント ${event.id} の処理を中断`);
        return jsonResponse({ error: "Idempotency check failed" }, 500);
      }

      switch (event.type) {
        case "customer.subscription.created": {
          const subscription = event.data.object as Stripe.Subscription;
          return await handleSubscriptionCreated(supabase, stripe, subscription, appName);
        }

        case "customer.subscription.updated": {
          const subscription = event.data.object as Stripe.Subscription;
          return await handleSubscriptionUpdated(supabase, stripe, subscription, appName);
        }

        case "customer.subscription.deleted": {
          const subscription = event.data.object as Stripe.Subscription;
          return await handleSubscriptionDeleted(supabase, stripe, subscription, appName);
        }

        case "invoice.payment_succeeded": {
          const invoice = event.data.object as Stripe.Invoice;
          return await handleInvoicePaymentSucceeded(supabase, stripe, invoice, appName);
        }

        case "invoice.payment_failed": {
          const invoice = event.data.object as Stripe.Invoice;
          return await handleInvoicePaymentFailed(supabase, stripe, invoice, appName);
        }

        default:
          console.log(`[${appName}] Unhandled event type:`, event.type);
          return jsonResponse({ received: true, message: "Event not handled" });
      }
    } catch (err) {
      console.error(`[${appName}] Unexpected error in stripe-webhook:`, err);
      await notifySlack(appName, `Stripe Webhook error: ${err}`);
      return jsonResponse({ error: "Internal server error" }, 500);
    }
  };
}
