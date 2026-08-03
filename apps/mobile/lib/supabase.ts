import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// Encrypted auth store id. Distinct from the legacy plaintext "supabase-auth"
// so switching on encryption never hits a key-mismatch on old data (which could
// crash MMKV); the legacy store is wiped on first run instead (users re-login
// once). See getAuthEncryptionKey.
const AUTH_STORE_ID = "supabase-auth-enc";
const AUTH_ENCRYPTION_KEY_NAME = "supabase-auth-mmkv-key";

/**
 * Fetch (or lazily create) the MMKV encryption key from the device Keychain /
 * Keystore via expo-secure-store, so Supabase refresh/access tokens are never
 * written to disk in plaintext. Returns undefined when SecureStore isn't
 * available (e.g. Expo Go) — the caller then falls back to an unencrypted store.
 */
function getAuthEncryptionKey(): string | undefined {
  try {
    const SecureStore = require("expo-secure-store");
    const existing = SecureStore.getItem(AUTH_ENCRYPTION_KEY_NAME);
    if (typeof existing === "string" && existing.length > 0) return existing;

    const Crypto = require("expo-crypto");
    const bytes: Uint8Array = Crypto.getRandomBytes(32);
    const key = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    SecureStore.setItem(AUTH_ENCRYPTION_KEY_NAME, key);
    return key;
  } catch {
    return undefined;
  }
}

// MMKV-based storage adapter for Supabase auth (encrypted at rest)
function createMmkvStorage() {
  try {
    const { createMMKV } = require("react-native-mmkv");
    const encryptionKey = getAuthEncryptionKey();

    if (encryptionKey) {
      // One-time migration: wipe the old plaintext auth store so leftover
      // refresh tokens don't linger unencrypted on disk. Best-effort.
      try {
        createMMKV({ id: "supabase-auth" }).clearAll();
      } catch {
        // ignore
      }
    }

    const mmkv = encryptionKey
      ? createMMKV({ id: AUTH_STORE_ID, encryptionKey })
      : createMMKV({ id: "supabase-auth" }); // SecureStore unavailable → plaintext fallback
    return {
      getItem: (key: string): string | null => {
        return mmkv.getString(key) ?? null;
      },
      setItem: (key: string, value: string): void => {
        mmkv.set(key, value);
      },
      removeItem: (key: string): void => {
        mmkv.remove(key);
      },
    };
  } catch {
    // Fallback for Expo Go: in-memory storage
    const store = new Map<string, string>();
    return {
      getItem: (key: string): string | null => store.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        store.set(key, value);
      },
      removeItem: (key: string): void => {
        store.delete(key);
      },
    };
  }
}

const mmkvStorage = createMmkvStorage();

export function clearMmkvCaches(): void {
  try {
    const { createMMKV } = require("react-native-mmkv");
    // NOTE: do NOT clear the "swimhub-timer-settings" store here — it holds the
    // user's stopwatch design and the guest daily-export counter. Wiping it on
    // sign-out lost the saved design and let a guest reset the 1/day limit via a
    // login→logout cycle. Sign-out must clear only the auth session below.
    // Clear the encrypted auth store (needs the key to open), and the legacy
    // plaintext one for good measure.
    const encryptionKey = getAuthEncryptionKey();
    const authStorage = encryptionKey
      ? createMMKV({ id: AUTH_STORE_ID, encryptionKey })
      : createMMKV({ id: "supabase-auth" });
    authStorage.clearAll();
    try {
      createMMKV({ id: "supabase-auth" }).clearAll();
    } catch {
      // ignore
    }
  } catch {
    // Expo Go fallback: no MMKV available
  }
}

let supabase: ReturnType<typeof createClient> | null = null;

if (supabaseUrl && supabaseAnonKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage: mmkvStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        // Google OAuth の deep link を PKCE の `code` クエリで受け取り、
        // exchangeCodeForSession で交換する（アクセストークンを URL 直渡ししない）。
        // 既定の "implicit" のままだと同一スキームを主張する悪意あるアプリに
        // コールバックを横取りされ、code_verifier 不要でセッションを奪取されうる。
        // メール確認/パスワードリセットは token_hash + verifyOtp 方式のため
        // flowType には依存しない (app/_layout.tsx の completeAuthDeepLink 参照)。
        flowType: "pkce",
      },
    });
  } catch (error) {
    console.error("Supabaseクライアントの初期化に失敗しました:", error);
  }
} else {
  console.error(
    "Supabase環境変数が設定されていません。\n" +
      `EXPO_PUBLIC_SUPABASE_URL: ${supabaseUrl ? "OK" : "未設定"}\n` +
      `EXPO_PUBLIC_SUPABASE_ANON_KEY: ${supabaseAnonKey ? "OK" : "未設定"}\n` +
      "EAS Secrets または .env ファイルに設定してください。",
  );
}

export { supabase };
