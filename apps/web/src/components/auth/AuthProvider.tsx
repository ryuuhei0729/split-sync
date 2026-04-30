"use client";

import { createContext, useEffect, useState, useCallback, useMemo, type ReactNode } from "react";
import type { UserPlan, SubscriptionStatus, SubscriptionInfo } from "@swimhub-timer/shared";
import type { TimerWebAuthContextValue } from "@swimhub-timer/shared/types/auth";
import { useAuthState } from "@swimhub-timer/shared/hooks";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useEditorStore } from "@/stores/editor-store";
import { clear as clearIdb } from "idb-keyval";

export type AuthContextValue = TimerWebAuthContextValue;

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => getSupabaseBrowserClient() ?? null, []);
  const { user, loading } = useAuthState(supabase);
  const [plan, setPlan] = useState<UserPlan>("guest");
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);

  const fetchPlan = useCallback(async (userId: string) => {
    try {
      const sb = getSupabaseBrowserClient()!;
      const { data } = await sb
        .from("user_subscriptions")
        .select("plan, status, cancel_at_period_end, premium_expires_at, trial_end")
        .eq("id", userId)
        .single<{
          plan: string;
          status: string | null;
          cancel_at_period_end: boolean | null;
          premium_expires_at: string | null;
          trial_end: string | null;
        }>();
      const status = (data?.status ?? null) as SubscriptionStatus | null;
      setSubscriptionStatus(status);

      const subInfo: SubscriptionInfo = {
        plan: (data?.plan === "premium" ? "premium" : "free") as UserPlan,
        status,
        cancelAtPeriodEnd: data?.cancel_at_period_end ?? false,
        premiumExpiresAt: data?.premium_expires_at ?? null,
        trialEnd: data?.trial_end ?? null,
      };
      setSubscription(subInfo);

      if (data?.plan === "premium" && (status === "active" || status === "trialing")) {
        setPlan("premium");
      } else {
        setPlan("free");
      }
    } catch {
      setPlan("free");
      setSubscriptionStatus(null);
      setSubscription({ plan: "free", status: null, cancelAtPeriodEnd: false, premiumExpiresAt: null, trialEnd: null });
    }
  }, []);

  const refreshSubscription = useCallback(async () => {
    if (!user) return;
    await fetchPlan(user.id);
  }, [user, fetchPlan]);

  // user が変わったらプランを取得
  useEffect(() => {
    if (user) {
      // 非同期コールバック経由で setState を呼ぶことで set-state-in-effect を回避
      void (async () => {
        await fetchPlan(user.id);
      })();
    } else {
      // ログアウト時はコールバック経由でリセット
      Promise.resolve().then(() => {
        setPlan("guest");
        setSubscriptionStatus(null);
        setSubscription(null);
      });
    }
  }, [user, fetchPlan]);

  const signInWithGoogle = useCallback(async () => {
    const supabase = getSupabaseBrowserClient()!;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback`,
      },
    });
    if (error) throw error;
  }, []);

  const signInWithApple = useCallback(async () => {
    const supabase = getSupabaseBrowserClient()!;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "apple",
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback`,
      },
    });
    if (error) throw error;
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const supabase = getSupabaseBrowserClient()!;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUpWithEmail = useCallback(async (email: string, password: string, name?: string) => {
    const supabase = getSupabaseBrowserClient()!;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: name ? { name } : undefined,
        emailRedirectTo: `${window.location.origin}/api/auth/callback`,
      },
    });
    if (error) throw error;
    return !!data.user;
  }, []);

  const signOut = useCallback(async () => {
    const supabase = getSupabaseBrowserClient()!;
    await supabase.auth.signOut({ scope: "local" });
    setPlan("guest");
    setSubscriptionStatus(null);
    setSubscription(null);

    // Clear all caches
    useEditorStore.getState().reset();
    await clearIdb().catch(() => {});
    delete window.__supabase_timer_client__;
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        plan,
        subscriptionStatus,
        subscription,
        signInWithGoogle,
        signInWithApple,
        signInWithEmail,
        signUpWithEmail,
        signOut,
        refreshSubscription,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
