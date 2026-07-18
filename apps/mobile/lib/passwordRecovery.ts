import { useEffect, useState } from "react";

/**
 * パスワードリセットのディープリンク (swimhubtimer://auth/callback?...type=recovery)
 * を検知したかどうかを、root layout の completeAuthDeepLink と AuthGate の間で
 * 橋渡しするための最小限のシグナル。
 *
 * リカバリーリンクでセッションが確立すると useAuthState の onAuthStateChange が
 * ほぼ同時に user を更新し、AuthGate が通常ログインと同じ扱いで /(app) へ
 * リダイレクトしてしまう。completeAuthDeepLink は setSession/exchangeCodeForSession
 * より前にこのフラグを立てることで、AuthGate が代わりに /(auth)/reset-password へ
 * 誘導できるようにする。
 */
let pendingRecovery = false;
const listeners = new Set<(value: boolean) => void>();

export function setPasswordRecoveryPending(value: boolean): void {
  pendingRecovery = value;
  listeners.forEach((listener) => listener(value));
}

export function isPasswordRecoveryPending(): boolean {
  return pendingRecovery;
}

export function usePasswordRecoveryPending(): boolean {
  const [value, setValue] = useState(pendingRecovery);

  useEffect(() => {
    setValue(pendingRecovery);
    listeners.add(setValue);
    return () => {
      listeners.delete(setValue);
    };
  }, []);

  return value;
}
