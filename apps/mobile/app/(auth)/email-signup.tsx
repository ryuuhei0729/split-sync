import { useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  Linking,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useEmailAuth } from "../../hooks/useEmailAuth";
import { colors, spacing, radius, fontSize } from "../../lib/theme";
import { validatePassword, type PasswordChecks } from "../../utils/validatePassword";

const PASSWORD_MIN_LENGTH = 6;

export default function EmailSignupScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { signUpWithEmail, loading, error: authError, clearError } = useEmailAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);

  const passwordValidation = useMemo(() => validatePassword(password), [password]);
  const error = localError || authError;

  const handleSubmit = async () => {
    setLocalError(null);
    clearError();
    setConfirmationSent(false);

    if (!name.trim()) {
      setLocalError(t("auth.errors.nameRequired"));
      return;
    }
    if (!email.trim()) {
      setLocalError(t("auth.emailPlaceholder"));
      return;
    }
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

    const success = await signUpWithEmail(email, password, name.trim());
    if (success) {
      setConfirmationSent(true);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
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

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.formContainer}>
            <Text style={styles.title}>{t("auth.emailSignup")}</Text>

            {error && (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {confirmationSent && (
              <View style={styles.confirmationContainer}>
                <Text style={styles.confirmationText}>{t("auth.confirmationSent")}</Text>
              </View>
            )}

            <View style={styles.form}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>{t("auth.nameLabel")}</Text>
                <TextInput
                  style={styles.input}
                  placeholder={t("auth.namePlaceholder")}
                  placeholderTextColor="#9CA3AF"
                  value={name}
                  onChangeText={setName}
                  autoCapitalize="words"
                  textContentType="name"
                  editable={!loading}
                  accessibilityLabel={t("auth.nameLabel")}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>{t("auth.email")}</Text>
                <TextInput
                  style={styles.input}
                  placeholder="your@email.com"
                  placeholderTextColor="#9CA3AF"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  editable={!loading}
                  accessibilityLabel={t("auth.email")}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>{t("auth.passwordPlaceholder")}</Text>
                <TextInput
                  style={styles.input}
                  placeholder={t("auth.passwordPlaceholder")}
                  placeholderTextColor="#9CA3AF"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="password"
                  textContentType="newPassword"
                  editable={!loading}
                  accessibilityLabel={t("auth.passwordPlaceholder")}
                />
                <PasswordRequirementsList checks={passwordValidation.checks} />
              </View>

              <Pressable
                style={({ pressed }) => [
                  styles.submitButton,
                  loading && styles.submitButtonDisabled,
                  pressed && !loading && styles.submitButtonPressed,
                ]}
                onPress={handleSubmit}
                disabled={loading || !name || !email || !password}
                accessibilityRole="button"
                accessibilityLabel={t("auth.signUp")}
                accessibilityState={{ busy: loading }}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.submitButtonText}>{t("auth.signUp")}</Text>
                )}
              </Pressable>
            </View>
          </View>

          <View style={styles.legalContainer}>
            <Text style={styles.legalText}>
              {(() => {
                const full = t("auth.termsAgree");
                const terms = t("auth.terms");
                const privacy = t("privacy.title");
                const parts = full.split(new RegExp(`(${terms}|${privacy})`));
                return parts.map((part, i) => {
                  if (part === terms) {
                    return (
                      <Text
                        key={i}
                        style={styles.legalLink}
                        onPress={() => Linking.openURL("https://timer.swim-hub.app/terms")}
                      >
                        {terms}
                      </Text>
                    );
                  }
                  if (part === privacy) {
                    return (
                      <Text
                        key={i}
                        style={styles.legalLink}
                        onPress={() => Linking.openURL("https://timer.swim-hub.app/privacy")}
                      >
                        {privacy}
                      </Text>
                    );
                  }
                  return part;
                });
              })()}
            </Text>
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
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
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
    marginBottom: spacing.xl,
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
  confirmationContainer: {
    backgroundColor: "#EFF6FF",
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  confirmationText: {
    color: colors.primary,
    fontSize: fontSize.sm,
    textAlign: "center",
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
  legalContainer: {
    paddingVertical: spacing.xl,
  },
  legalText: {
    fontSize: fontSize.xs,
    color: "#9CA3AF",
    textAlign: "center",
    lineHeight: 18,
  },
  legalLink: {
    color: colors.primary,
    fontWeight: "500",
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
