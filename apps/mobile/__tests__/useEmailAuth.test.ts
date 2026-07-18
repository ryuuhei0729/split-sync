/**
 * Sprint Contract: swimhub-timer パスワードリセット
 *
 * Covers useEmailAuth's sendPasswordResetEmail / updatePassword and the
 * passwordRecovery signal they coordinate with. sendPasswordResetEmail must
 * always resolve to true (email enumeration protection) regardless of
 * whether the account exists or the Supabase call throws.
 */
import { renderHook, act } from "@testing-library/react-native";
import { useEmailAuth } from "../hooks/useEmailAuth";
import { setPasswordRecoveryPending, isPasswordRecoveryPending } from "../lib/passwordRecovery";
import { supabase } from "../lib/supabase";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: jest.fn(),
      updateUser: jest.fn(),
      signInWithPassword: jest.fn(),
      signUp: jest.fn(),
    },
  },
}));

jest.mock("../lib/google-auth", () => ({
  getRedirectUri: () => "swimhubtimer://auth/callback",
  getPasswordRecoveryRedirectUri: () => "swimhubtimer://auth/callback?flow=password-recovery",
}));

const mockResetPasswordForEmail = supabase?.auth.resetPasswordForEmail as jest.Mock;
const mockUpdateUser = supabase?.auth.updateUser as jest.Mock;

describe("useEmailAuth - sendPasswordResetEmail", () => {
  beforeEach(() => {
    mockResetPasswordForEmail.mockReset();
    mockUpdateUser.mockReset();
  });

  it("returns true when the reset email is sent successfully", async () => {
    mockResetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    const { result } = await renderHook(() => useEmailAuth());

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.sendPasswordResetEmail("user@example.com");
    });

    expect(success).toBe(true);
    expect(mockResetPasswordForEmail).toHaveBeenCalledWith("user@example.com", {
      redirectTo: "swimhubtimer://auth/callback?flow=password-recovery",
    });
  });

  it("still returns true when the account does not exist (Supabase reports no error either way)", async () => {
    // Supabase's own API never reveals account existence via this call, but we
    // assert the client doesn't add a distinguishing branch for this response shape.
    mockResetPasswordForEmail.mockResolvedValue({ data: null, error: null });
    const { result } = await renderHook(() => useEmailAuth());

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.sendPasswordResetEmail("nonexistent@example.com");
    });

    expect(success).toBe(true);
  });

  it("returns true even when the Supabase call throws (enumeration protection)", async () => {
    mockResetPasswordForEmail.mockRejectedValue(new Error("network error"));
    const { result } = await renderHook(() => useEmailAuth());

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.sendPasswordResetEmail("user@example.com");
    });

    expect(success).toBe(true);
  });

  it("does not surface an error message even when the underlying call fails", async () => {
    mockResetPasswordForEmail.mockRejectedValue(new Error("network error"));
    const { result } = await renderHook(() => useEmailAuth());

    await act(async () => {
      await result.current.sendPasswordResetEmail("user@example.com");
    });

    expect(result.current.error).toBeNull();
  });
});

describe("useEmailAuth - updatePassword", () => {
  beforeEach(() => {
    mockResetPasswordForEmail.mockReset();
    mockUpdateUser.mockReset();
    setPasswordRecoveryPending(false);
  });

  it("returns true and clears the recovery-pending flag on success", async () => {
    mockUpdateUser.mockResolvedValue({ data: {}, error: null });
    setPasswordRecoveryPending(true);
    const { result } = await renderHook(() => useEmailAuth());

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.updatePassword("NewPassw0rd!");
    });

    expect(success).toBe(true);
    expect(mockUpdateUser).toHaveBeenCalledWith({ password: "NewPassw0rd!" });
    expect(isPasswordRecoveryPending()).toBe(false);
  });

  it("returns false and surfaces an error when Supabase rejects the update", async () => {
    mockUpdateUser.mockResolvedValue({ data: null, error: { message: "Auth session missing" } });
    setPasswordRecoveryPending(true);
    const { result } = await renderHook(() => useEmailAuth());

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.updatePassword("NewPassw0rd!");
    });

    expect(success).toBe(false);
    expect(result.current.error).not.toBeNull();
    // Recovery-pending stays true on failure so the user isn't bounced out of
    // the reset-password screen before actually changing their password.
    expect(isPasswordRecoveryPending()).toBe(true);
  });

  it("returns false when the underlying call throws", async () => {
    mockUpdateUser.mockRejectedValue(new Error("network error"));
    const { result } = await renderHook(() => useEmailAuth());

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.updatePassword("NewPassw0rd!");
    });

    expect(success).toBe(false);
  });
});
