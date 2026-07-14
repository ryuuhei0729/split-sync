import { View, Text, Pressable, StyleSheet, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../contexts/AuthProvider";
import { colors, spacing, radius, fontSize } from "../../lib/theme";

export default function WelcomeScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { continueAsGuest } = useAuth();

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right", "bottom"]}>
      <View style={styles.content}>
        <View style={styles.logoContainer}>
          <Image source={require("../../assets/splash-icon.png")} style={styles.appIcon} />
          <Text style={styles.appName}>{t("common.appName")}</Text>
          <Text style={styles.tagline}>{t("import.subtitle")}</Text>
        </View>
      </View>

      <View style={styles.bottomContainer}>
        <Pressable
          style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
          onPress={() => router.push("/(auth)/get-started")}
        >
          <Text style={styles.primaryButtonText}>{t("auth.welcome.getStarted")}</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.secondaryButton,
            pressed && styles.secondaryButtonPressed,
          ]}
          onPress={() => router.push("/(auth)/login-method")}
        >
          <Text style={styles.secondaryButtonText}>{t("auth.welcome.login")}</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.guestButton, pressed && styles.guestButtonPressed]}
          onPress={continueAsGuest}
        >
          <Text style={styles.guestButtonText}>{t("auth.continueAsGuest")}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  logoContainer: {
    alignItems: "center",
    gap: spacing.lg,
  },
  appIcon: {
    width: 160,
    height: 160,
  },
  appName: {
    fontSize: 32,
    fontFamily: "ChakraPetch_700Bold",
    color: "#1E3A8A",
  },
  tagline: {
    fontSize: 15,
    color: colors.muted,
    textAlign: "center",
    lineHeight: 22,
  },
  bottomContainer: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonPressed: {
    backgroundColor: "#1D4ED8",
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "600",
  },
  secondaryButton: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  secondaryButtonPressed: {
    backgroundColor: colors.surfaceRaised,
  },
  secondaryButtonText: {
    color: colors.textSecondary,
    fontSize: 17,
    fontWeight: "600",
  },
  guestButton: {
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  guestButtonPressed: {
    opacity: 0.6,
  },
  guestButtonText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "500",
  },
});
