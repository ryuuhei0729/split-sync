import "server-only";
// =============================================================================
// Stripe SDK 初期化 (Server-side only)
// =============================================================================

import Stripe from "stripe";

let stripeInstance: Stripe | null = null;

/**
 * Stripe クライアントを取得（シングルトン）
 * 環境変数が未設定の場合はランタイムエラーをスロー
 */
export function getStripe(): Stripe {
  if (stripeInstance) return stripeInstance;

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY が設定されていません");
  }

  stripeInstance = new Stripe(secretKey, {
    apiVersion: "2025-02-24.acacia",
    typescript: true,
  });

  return stripeInstance;
}
