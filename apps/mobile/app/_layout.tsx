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
import { colors } from "../lib/theme";

/**
 * Completes auth deep links (email confirmation / password reset). The
 * confirmation link opens `swimhubtimer://auth/callback?code=…` (PKCE); we
 * exchange the code for a session so onAuthStateChange logs the user in. Falls
 * back to fragment tokens (implicit flow). Without this the link opened the web
 * LP and the sign-up happy path dead-ended.
 */
async function completeAuthDeepLink(url: string | null): Promise<void> {
  if (!url || !supabase || !url.includes("auth/callback")) return;
  try {
    // Use expo-linking's parser: React Native's URL.searchParams is unreliable
    // (google-auth builds URLSearchParams from the hash by hand for the same
    // reason), so parse queryParams the RN-safe way.
    const codeParam = Linking.parse(url).queryParams?.code;
    const code = typeof codeParam === "string" ? codeParam : null;
    if (code) {
      await supabase.auth.exchangeCodeForSession(code);
      return;
    }
    const tokens = extractTokensFromUrl(url);
    if (tokens.accessToken && tokens.refreshToken) {
      await supabase.auth.setSession({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
      });
    }
  } catch {
    // Invalid/expired link — leave the user on the auth screen to retry.
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

  useEffect(() => {
    if (loading) return;

    // 認証状態が変化したときだけリダイレクトフラグをリセット
    const prevUser = prevAuthStateRef.current.user;
    const prevGuestMode = prevAuthStateRef.current.guestMode;
    if (prevUser !== !!user || prevGuestMode !== guestMode) {
      redirectDone.current = false;
      prevAuthStateRef.current = { user: !!user, guestMode };
    }

    if (redirectDone.current) return;

    const inAuthGroup = segments[0] === "(auth)";

    if (!isAuthenticated && !guestMode && !inAuthGroup) {
      // 未認証・非ゲスト・非authグループ → get-started へリダイレクト
      redirectDone.current = true;
      router.replace("/(auth)/get-started");
    } else if (!!user && inAuthGroup) {
      // ログイン済みユーザーのみauthグループからリダイレクト
      redirectDone.current = true;
      router.replace("/(app)");
    }
  }, [user, isAuthenticated, guestMode, loading, segments, router]);

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
