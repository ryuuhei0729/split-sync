import { useEffect, useRef } from "react";
import { I18nProvider } from "../providers/I18nProvider";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import * as Linking from "expo-linking";
import { Slot, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Font from "expo-font";
import { ChakraPetch_700Bold } from "@expo-google-fonts/chakra-petch";
import { AuthProvider, useAuth } from "../contexts/AuthProvider";
import { supabase } from "../lib/supabase";
import { extractTokensFromUrl } from "../lib/google-auth";
import { setPasswordRecoveryPending, usePasswordRecoveryPending } from "../lib/passwordRecovery";
import { colors } from "../lib/theme";

/**
 * Completes auth deep links (email confirmation / password reset). The
 * confirmation link opens `swimhubtimer://auth/callback?code=…` (PKCE); we
 * exchange the code for a session so onAuthStateChange logs the user in. Falls
 * back to fragment tokens (implicit flow, the default flowType here). Without
 * this the link opened the web LP and the sign-up happy path dead-ended.
 *
 * Password recovery links use the same callback URL, so we flag them via
 * setPasswordRecoveryPending *before* establishing the session — AuthGate
 * reads that flag to route to /(auth)/reset-password instead of /(app).
 *
 * If session establishment then fails (expired/reused link, thrown error),
 * the flag is cleared again — otherwise a stale "recovery pending" flag would
 * hijack the user's *next*, unrelated normal sign-in and bounce them to
 * reset-password. Only cleared when *this* call set it, so an unrelated
 * confirmation-link failure never wipes out a real pending recovery.
 */
async function completeAuthDeepLink(url: string | null): Promise<void> {
  if (!url || !supabase || !url.includes("auth/callback")) return;
  let flaggedRecoveryInThisCall = false;
  try {
    // Use expo-linking's parser: React Native's URL.searchParams is unreliable
    // (google-auth builds URLSearchParams from the hash by hand for the same
    // reason), so parse queryParams the RN-safe way.
    const queryParams = Linking.parse(url).queryParams;
    const codeParam = queryParams?.code;
    const code = typeof codeParam === "string" ? codeParam : null;

    // getPasswordRecoveryRedirectUri() appends this marker so we can tell a
    // recovery link apart from a normal sign-in/confirmation link — the code
    // exchange itself doesn't expose that distinction via public types.
    const isRecoveryLink = queryParams?.flow === "password-recovery";

    if (code) {
      if (isRecoveryLink) {
        setPasswordRecoveryPending(true);
        flaggedRecoveryInThisCall = true;
      }
      // exchangeCodeForSession doesn't throw for an expired/reused code — it
      // resolves with `error` set — so we must check it explicitly, not just catch.
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error && flaggedRecoveryInThisCall) {
        setPasswordRecoveryPending(false);
      }
      return;
    }
    const tokens = extractTokensFromUrl(url);
    if (tokens.accessToken && tokens.refreshToken) {
      if (isRecoveryLink || tokens.recoveryType === "recovery") {
        setPasswordRecoveryPending(true);
        flaggedRecoveryInThisCall = true;
      }
      const { error } = await supabase.auth.setSession({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
      });
      if (error && flaggedRecoveryInThisCall) {
        setPasswordRecoveryPending(false);
      }
    }
  } catch {
    // Invalid/expired link — leave the user on the auth screen to retry.
    if (flaggedRecoveryInThisCall) {
      setPasswordRecoveryPending(false);
    }
  }
}

// Load the same fonts used by the FFmpeg exporter so the preview matches the
// rendered video. NotoSansJP-Bold is the sans-serif default — its glyph set
// covers Japanese as well as Latin, which the timer's memo overlay needs.
// NotoSansMono-Bold is used when the user picks monospace (Latin only).
// ChakraPetch_700Bold is used for the brand wordmark on the welcome screen.
// Best-effort: failures fall back to the system font.
Font.loadAsync({
  "NotoSansJP-Bold": require("../assets/fonts/NotoSansJP-Bold.ttf"),
  "NotoSansMono-Bold": require("../assets/fonts/NotoSansMono-Bold.ttf"),
  ChakraPetch_700Bold,
}).catch(() => {});

function AuthGate() {
  const { user, isAuthenticated, guestMode, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const redirectDone = useRef(false);
  const prevAuthStateRef = useRef({ user: !!user, guestMode });
  const passwordRecoveryPending = usePasswordRecoveryPending();

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === "(auth)";
    // segments is a typed tuple keyed to the app's route structure, so its
    // length/shape varies per route — widen to a plain array before indexing
    // an arbitrary position to avoid a "no element at index" type error.
    const segmentList: readonly string[] = segments;
    const isOnResetPasswordScreen = inAuthGroup && segmentList[1] === "reset-password";

    // 常時ガード (redirectDone の one-shot ゲートより前に評価する): リカバリー
    // セッションが有効な間は reset-password 以外のどの画面に居ても押し戻す。
    // redirectDone は認証状態が変わるまで再チェックしないため、スワイプバック
    // や他コンポーネントの router.replace で reset-password から離脱されると
    // パスワード未変更のまま素通りできてしまう — この分岐はそれを防ぐため
    // redirectDone に依存させず、segments が変わるたびに毎回評価する。
    if (passwordRecoveryPending && !!user && !isOnResetPasswordScreen) {
      router.replace("/(auth)/reset-password");
      return;
    }

    // 認証状態が変化したときだけリダイレクトフラグをリセット
    const prevUser = prevAuthStateRef.current.user;
    const prevGuestMode = prevAuthStateRef.current.guestMode;
    if (prevUser !== !!user || prevGuestMode !== guestMode) {
      redirectDone.current = false;
      prevAuthStateRef.current = { user: !!user, guestMode };
    }

    if (redirectDone.current) return;

    if (!isAuthenticated && !guestMode && !inAuthGroup) {
      // 未認証・非ゲスト・非authグループ → get-started へリダイレクト
      redirectDone.current = true;
      router.replace("/(auth)/get-started");
    } else if (!!user && inAuthGroup) {
      // パスワードリセットリンクで確立したセッションは、通常ログインと違い
      // reset-password 画面へ誘導する (completeAuthDeepLink が事前にフラグを立てる)。
      // 通常はこの分岐に到達する前に上の常時ガードが処理するが、念のため残す。
      redirectDone.current = true;
      router.replace(passwordRecoveryPending ? "/(auth)/reset-password" : "/(app)");
    }
  }, [user, isAuthenticated, guestMode, loading, segments, router, passwordRecoveryPending]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return <Slot />;
}

export default function RootLayout() {
  useEffect(() => {
    try {
      const mobileAds = require("react-native-google-mobile-ads").default;
      mobileAds().initialize();
    } catch {
      // Ad module not available (e.g., running in Expo Go)
    }
  }, []);

  // Complete auth deep links (email confirmation / password reset): the cold-
  // start URL plus any received while the app is open.
  useEffect(() => {
    Linking.getInitialURL().then(completeAuthDeepLink);
    const sub = Linking.addEventListener("url", (e) => completeAuthDeepLink(e.url));
    return () => sub.remove();
  }, []);

  return (
    <I18nProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <AuthGate />
      </AuthProvider>
    </I18nProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.background,
  },
});
