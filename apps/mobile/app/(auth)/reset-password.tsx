import { useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../contexts/AuthProvider";
import { useEmailAuth } from "../../hooks/useEmailAuth";
import { colors, spacing, radius, fontSize } from "../../lib/theme";
import { validatePassword, type PasswordChecks } from "../../utils/validatePassword";

const PASSWORD_MIN_LENGTH = 6;

export default function ResetPasswordScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { updatePassword, loading, error: authError, clearError } = useEmailAuth();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const passwordValidation = useMemo(() => validatePassword(password), [password]);
  const error = localError || authError;

  const handleSubmit = async () => {
    setLocalError(null);
    clearError();

    const checks = passwordValidation.checks;
    if (!checks.minLength) {
      setLocalError(t("auth.errors.passwordTooShort", { minLength: PASSWORD_MIN_LENGTH }));
      return;
    }
    if (!checks.lowercase) {
      setLocalError(t("auth.errors.passwordMissingLowercase"));
      return;
    }
    if (!checks.uppercase) {
      setLocalError(t("auth.errors.passwordMissingUppercase"));
      return;
    }
    if (!checks.digit) {
      setLocalError(t("auth.errors.passwordMissingDigit"));
      return;
    }
    if (!checks.symbol) {
      setLocalError(t("auth.errors.passwordMissingSymbol"));
      return;
    }
    if (password !== confirmPassword) {
      setLocalError(t("auth.errors.passwordMismatch"));
      return;
    }

    const success = await updatePassword(password);
    if (success) {
      router.replace("/(app)");
    }
  };

  // completeAuthDeepLink (root layout) がまだセッションを確立していない、または
  // リンクの有効期限切れ/再利用でセッションが確立できなかった場合。
  if (!authLoading && !isAuthenticated) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.scrollContent}>
          <View style={styles.formContainer}>
            <Text style={styles.title}>{t("auth.resetPassword.invalidTitle")}</Text>
            <Text style={styles.subtitle}>{t("auth.resetPassword.invalidMessage")}</Text>
            <Pressable
              style={({ pressed }) => [styles.submitButton, pressed && styles.submitButtonPressed]}
              onPress={() => router.replace("/(auth)/forgot-password")}
              accessibilityRole="button"
              accessibilityLabel={t("auth.resetPassword.invalidCta")}
            >
              <Text style={styles.submitButtonText}>{t("auth.resetPassword.invalidCta")}</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.formContainer}>
            <Text style={styles.title}>{t("auth.resetPassword.title")}</Text>
            <Text style={styles.subtitle}>{t("auth.resetPassword.subtitle")}</Text>

            {error && (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <View style={styles.form}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>{t("auth.resetPassword.newPasswordLabel")}</Text>
                <TextInput
                  style={styles.input}
                  placeholder={t("auth.passwordPlaceholder")}
                  placeholderTextColor="#9CA3AF"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="password-new"
                  textContentType="newPassword"
                  editable={!loading}
                  accessibilityLabel={t("auth.resetPassword.newPasswordLabel")}
                />
                <PasswordRequirementsList checks={passwordValidation.checks} />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>{t("auth.resetPassword.confirmPasswordLabel")}</Text>
                <TextInput
                  style={styles.input}
                  placeholder={t("auth.passwordPlaceholder")}
                  placeholderTextColor="#9CA3AF"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="password-new"
                  textContentType="newPassword"
                  editable={!loading}
                  accessibilityLabel={t("auth.resetPassword.confirmPasswordLabel")}
                />
              </View>

              <Pressable
                style={({ pressed }) => [
                  styles.submitButton,
                  loading && styles.submitButtonDisabled,
                  pressed && !loading && styles.submitButtonPressed,
                ]}
                onPress={handleSubmit}
                disabled={loading || !password || !confirmPassword}
                accessibilityRole="button"
                accessibilityLabel={t("auth.resetPassword.submit")}
                accessibilityState={{ busy: loading }}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.submitButtonText}>{t("auth.resetPassword.submit")}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function PasswordRequirementsList({ checks }: { checks: PasswordChecks }) {
  const { t } = useTranslation();
  const items: { key: keyof PasswordChecks; label: string }[] = [
    { key: "minLength", label: t("auth.passwordRequirements.minLength") },
    { key: "lowercase", label: t("auth.passwordRequirements.lowercase") },
    { key: "uppercase", label: t("auth.passwordRequirements.uppercase") },
    { key: "digit", label: t("auth.passwordRequirements.digit") },
    { key: "symbol", label: t("auth.passwordRequirements.symbol") },
  ];
  return (
    <View style={styles.requirements}>
      <Text style={styles.requirementsTitle}>{t("auth.passwordRequirements.title")}</Text>
      {items.map(({ key, label }) => {
        const met = checks[key];
        return (
          <View key={key} style={styles.requirementRow}>
            <Ionicons
              name={met ? "checkmark-circle" : "ellipse-outline"}
              size={14}
              color={met ? "#10B981" : "#9CA3AF"}
            />
            <Text style={[styles.requirementText, met && styles.requirementTextMet]}>{label}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    justifyContent: "center",
  },
  formContainer: {
    width: "100%",
    maxWidth: 400,
    alignSelf: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: "bold",
    color: colors.text,
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginBottom: spacing.xl,
    lineHeight: 20,
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
  form: {
    gap: spacing.lg,
  },
  inputGroup: {
    gap: spacing.xs,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: "500",
    color: colors.textSecondary,
  },
  input: {
    height: 52,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    fontSize: fontSize.md,
    color: colors.text,
  },
  submitButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonPressed: {
    backgroundColor: "#1D4ED8",
  },
  submitButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  requirements: {
    marginTop: spacing.xs,
    gap: 4,
  },
  requirementsTitle: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    fontWeight: "500",
    marginBottom: 2,
  },
  requirementRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  requirementText: {
    fontSize: fontSize.xs,
    color: "#9CA3AF",
  },
  requirementTextMet: {
    color: "#10B981",
  },
});
