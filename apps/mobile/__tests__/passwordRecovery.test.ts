/**
 * Sprint Contract: swimhub-timer パスワードリセット
 *
 * The recovery-pending signal is the bridge between completeAuthDeepLink
 * (root layout, fires before setSession/exchangeCodeForSession) and AuthGate
 * (which reads it to route to /(auth)/reset-password instead of /(app)).
 */
import { renderHook, act } from "@testing-library/react-native";
import {
  setPasswordRecoveryPending,
  isPasswordRecoveryPending,
  usePasswordRecoveryPending,
} from "../lib/passwordRecovery";

describe("passwordRecovery signal", () => {
  afterEach(() => {
    setPasswordRecoveryPending(false);
  });

  it("defaults to false", () => {
    expect(isPasswordRecoveryPending()).toBe(false);
  });

  it("reflects the value passed to setPasswordRecoveryPending", () => {
    setPasswordRecoveryPending(true);
    expect(isPasswordRecoveryPending()).toBe(true);

    setPasswordRecoveryPending(false);
    expect(isPasswordRecoveryPending()).toBe(false);
  });

  it("usePasswordRecoveryPending mirrors the module-level flag on mount", async () => {
    setPasswordRecoveryPending(true);
    const { result, unmount } = await renderHook(() => usePasswordRecoveryPending());
    expect(result.current).toBe(true);
    unmount();
  });

  it("usePasswordRecoveryPending updates subscribed consumers when the flag changes", async () => {
    const { result, unmount } = await renderHook(() => usePasswordRecoveryPending());
    expect(result.current).toBe(false);

    await act(async () => {
      setPasswordRecoveryPending(true);
    });
    expect(result.current).toBe(true);
    unmount();
  });

  it("stops notifying a consumer after it unmounts", async () => {
    const { result, unmount } = await renderHook(() => usePasswordRecoveryPending());
    unmount();
    // Should not throw even though no listeners remain registered for this hook.
    await expect(act(async () => setPasswordRecoveryPending(true))).resolves.not.toThrow();
    expect(result.current).toBe(false);
  });
});
