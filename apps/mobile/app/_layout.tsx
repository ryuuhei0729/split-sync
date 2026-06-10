import { useEffect, useRef } from "react";
import { I18nProvider } from "../providers/I18nProvider";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { Slot, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Font from "expo-font";
import { AuthProvider, useAuth } from "../contexts/AuthProvider";
import { colors } from "../lib/theme";

// Load the same fonts used by the FFmpeg exporter so the preview matches the
// rendered video. NotoSansJP-Bold is the sans-serif default — its glyph set
// covers Japanese as well as Latin, which the timer's memo overlay needs.
// NotoSansMono-Bold is used when the user picks monospace (Latin only).
// Best-effort: failures fall back to the system font.
Font.loadAsync({
  "NotoSansJP-Bold": require("../assets/fonts/NotoSansJP-Bold.ttf"),
  "NotoSansMono-Bold": require("../assets/fonts/NotoSansMono-Bold.ttf"),
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
