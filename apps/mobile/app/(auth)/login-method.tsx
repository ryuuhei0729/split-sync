import { useState } from "react";
import { View, Text, Pressable, StyleSheet, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useGoogleAuth } from "../../hooks/useGoogleAuth";
import { useAppleAuth } from "../../hooks/useAppleAuth";
import { GoogleLoginButton } from "../../components/auth/GoogleLoginButton";
import { AppleLoginButton } from "../../components/auth/AppleLoginButton";
import { colors, spacing, radius, fontSize } from "../../lib/theme";

export default function LoginMethodScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const {
    signInWithGoogle,
    loading: googleLoading,
    error: googleError,
    clearError: clearGoogleError,
  } = useGoogleAuth();
  const {
    signInWithApple,
    loading: appleLoading,
    error: appleError,
    clearError: clearAppleError,
    isAvailable: isAppleAvailable,
  } = useAppleAuth();
  const [error, setError] = useState<string | null>(null);

  const isLoading = googleLoading || appleLoading;
  const displayError = error || googleError || appleError;

  const handleGoogleLogin = async () => {
    setError(null);
    clearGoogleError();
    clearAppleError();
    await signInWithGoogle();
  };

  const handleAppleLogin = async () => {
    setError(null);
    clearGoogleError();
    clearAppleError();
    await signInWithApple();
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right", "bottom"]}>
      <View style={styles.header}>
        <Pressable
          style={styles.backButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t("common.back")}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
      </View>

      <View style={styles.content}>
        <View style={styles.titleContainer}>
          <Image
            source={require("../../assets/icon.png")}
            style={styles.appIcon}
            accessibilityRole="image"
            accessibilityLabel="SwimHub Timer"
          />
          <Text style={styles.title}>{t("auth.loginMethod.title")}</Text>
          <Text style={styles.subtitle}>{t("auth.loginMethod.subtitle")}</Text>
        </View>

        {displayError && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{displayError}</Text>
          </View>
        )}

        <View style={styles.buttonGroup}>
          {isAppleAvailable && (
            <AppleLoginButton
              onPress={handleAppleLogin}
              loading={appleLoading}
              disabled={isLoading}
              label={t("auth.loginMethod.withApple")}
            />
          )}

          <GoogleLoginButton
            onPress={handleGoogleLogin}
            loading={googleLoading}
            disabled={isLoading}
            label={t("auth.loginMethod.withGoogle")}
          />

          <Pressable
            style={({ pressed }) => [
              styles.emailButton,
              isLoading && styles.buttonDisabled,
              pressed && !isLoading && styles.emailButtonPressed,
            ]}
            onPress={() => router.push("/(auth)/email-login")}
            disabled={isLoading}
            accessibilityRole="button"
            accessibilityLabel={t("auth.loginMethod.withEmail")}
          >
            <View style={styles.buttonContent}>
              <Ionicons name="mail-outline" size={20} color={colors.textSecondary} />
              <Text style={styles.emailButtonText}>{t("auth.loginMethod.withEmail")}</Text>
            </View>
          </Pressable>
        </View>

        <Pressable
          style={styles.signupLink}
          onPress={() => router.push("/(auth)/get-started")}
          accessibilityRole="button"
          accessibilityLabel={t("auth.loginMethod.signup")}
        >
          <Text style={styles.signupLinkText}>
            {t("auth.loginMethod.noAccount")}<Text style={styles.signupLinkBold}>{t("auth.loginMethod.signup")}</Text>
          </Text>
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  backButton: {
    padding: 8,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    justifyContent: "center",
  },
  titleContainer: {
    alignItems: "center",
    marginBottom: spacing.xxl,
  },
  appIcon: {
    width: 180,
    height: 180,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: colors.text,
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: 15,
    color: colors.muted,
  },
  errorContainer: {
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  errorText: {
    color: colors.destructive,
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  buttonGroup: {
    gap: spacing.md,
  },
  buttonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  emailButton: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  emailButtonPressed: {
    backgroundColor: colors.surfaceRaised,
  },
  emailButtonText: {
    color: colors.textSecondary,
    fontSize: 16,
    fontWeight: "500",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  signupLink: {
    marginTop: 24,
    alignItems: "center",
  },
  signupLinkText: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },
  signupLinkBold: {
    color: colors.primary,
    fontWeight: "600",
  },
});
