import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, Alert, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useTranslation } from "react-i18next";
import { useEditorStore } from "../../stores/editor-store";
import { useAuth } from "../../contexts/AuthProvider";
import { colors, spacing, radius, fontSize } from "../../lib/theme";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

export default function ImportScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { setVideoUri, setVideoMetadata, reset } = useEditorStore();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);

  const pickVideo = async () => {
    try {
      setLoading(true);
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["videos"],
        quality: 1,
        videoMaxDuration: 600,
      });

      if (result.canceled || !result.assets?.[0]) {
        setLoading(false);
        return;
      }

      const asset = result.assets[0];
      reset();
      setVideoUri(asset.uri);
      setVideoMetadata({
        width: asset.width ?? 0,
        height: asset.height ?? 0,
        duration: (asset.duration ?? 0) / 1000,
        name: asset.fileName ?? "video",
      });
      router.push("/editor");
    } catch (error) {
      Alert.alert(
        t("common.error"),
        error instanceof Error ? error.message : t("import.failedToPick"),
      );
    } finally {
      setLoading(false);
    }
  };

  const stepFlow: Array<{ icon: IoniconName; label: string }> = [
    { icon: "videocam-outline", label: t("import.step1Short") },
    { icon: "pulse-outline", label: t("import.step2Short") },
    { icon: "download-outline", label: t("import.step3Short") },
  ];

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Top bar: auth chip */}
        <View style={styles.topBar}>
          {user ? (
            <Pressable style={styles.accountChip} onPress={() => router.push("/account")}>
              <Ionicons name="person-circle" size={18} color={colors.primary} />
              <Text style={styles.accountChipText} numberOfLines={1}>
                {user?.user_metadata?.name || user?.email || t("auth.account")}
              </Text>
            </Pressable>
          ) : (
            <View style={styles.guestBar}>
              <Text style={styles.guestLabel}>{t("auth.guestMode")}</Text>
              <Pressable
                style={styles.loginChip}
                onPress={() => router.push("/(auth)/login-method")}
              >
                <Text style={styles.loginChipText}>{t("auth.login")}</Text>
                <Ionicons name="arrow-forward" size={14} color={colors.white} />
              </Pressable>
            </View>
          )}
        </View>

        {/* Hero message */}
        <View style={styles.heroSection}>
          <Text style={styles.heroMessage}>{t("import.heroMessage")}</Text>
        </View>

        {/* Visual step flow */}
        <View style={styles.stepFlow}>
          {stepFlow.map((item, i) => (
            <React.Fragment key={item.label}>
              <View style={styles.stepCard}>
                <View style={styles.stepCardIcon}>
                  <Ionicons name={item.icon} size={20} color={colors.primary} />
                </View>
                <Text style={styles.stepCardLabel}>{item.label}</Text>
              </View>
              {i < stepFlow.length - 1 && (
                <Ionicons
                  name="chevron-forward"
                  size={14}
                  color={colors.muted}
                  style={styles.stepArrow}
                />
              )}
            </React.Fragment>
          ))}
        </View>

        {/* Main CTA card */}
        <View style={styles.ctaCard}>
          <Pressable
            style={({ pressed }) => [
              styles.ctaTouchTarget,
              pressed && styles.ctaTouchTargetPressed,
              loading && styles.buttonDisabled,
            ]}
            onPress={pickVideo}
            disabled={loading}
          >
            <View style={styles.ctaIconCircle}>
              <Ionicons name="videocam-outline" size={36} color={colors.primary} />
            </View>
            <Text style={styles.ctaTitle}>
              {loading ? t("import.loading") : t("import.selectVideo")}
            </Text>
            <Text style={styles.ctaDescription}>{t("import.selectVideoDesc")}</Text>
          </Pressable>
        </View>

        {/* Guest hint */}
        {!user && (
          <View style={styles.guestHintRow}>
            <Text style={styles.guestHintText}>{t("auth.guestLimitHint")}</Text>
            <Text style={styles.guestHintSub}>{t("auth.guestRegisterHint")}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    marginBottom: spacing.xl,
  },
  accountChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.background,
    borderRadius: radius.xl,
    paddingVertical: spacing.sm,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
  },
  accountChipText: {
    fontSize: fontSize.md,
    fontWeight: "600",
    color: colors.primary,
    flexShrink: 1,
  },
  guestBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  guestLabel: {
    fontSize: fontSize.sm,
    color: colors.muted,
    fontWeight: "500",
  },
  loginChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: radius.xl,
    paddingVertical: spacing.sm,
    paddingHorizontal: 14,
  },
  loginChipText: {
    fontSize: fontSize.md,
    fontWeight: "600",
    color: colors.white,
  },
  heroSection: {
    marginBottom: spacing.xl,
  },
  heroMessage: {
    fontSize: 24,
    fontWeight: "800",
    color: colors.text,
    lineHeight: 34,
    letterSpacing: -0.3,
  },
  stepFlow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xl,
    gap: spacing.xs,
  },
  stepCard: {
    alignItems: "center",
    gap: spacing.xs,
    flex: 1,
  },
  stepCardIcon: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: colors.primaryMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  stepCardLabel: {
    fontSize: fontSize.xs,
    fontWeight: "600",
    color: colors.textSecondary,
    textAlign: "center",
  },
  stepArrow: {
    marginBottom: 20,
  },
  ctaCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    width: "100%",
    alignItems: "center",
    gap: spacing.md,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    marginBottom: spacing.md,
  },
  ctaTouchTarget: {
    width: "100%",
    alignItems: "center",
    paddingVertical: spacing.xl,
    gap: spacing.md,
    borderWidth: 2,
    borderColor: colors.primaryBorder,
    borderStyle: "dashed",
    borderRadius: radius.lg,
  },
  ctaTouchTargetPressed: {
    backgroundColor: colors.primaryMuted,
    borderColor: colors.primary,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  ctaIconCircle: {
    width: 72,
    height: 72,
    borderRadius: radius.xl,
    backgroundColor: colors.primaryMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaTitle: {
    fontSize: fontSize.lg,
    fontWeight: "700",
    color: colors.text,
  },
  ctaDescription: {
    fontSize: fontSize.sm,
    color: colors.muted,
    textAlign: "center",
    lineHeight: 18,
  },
  guestHintRow: {
    alignItems: "center",
    gap: 2,
    marginBottom: spacing.md,
  },
  guestHintText: {
    fontSize: fontSize.xs,
    color: colors.muted,
    textAlign: "center",
  },
  guestHintSub: {
    fontSize: fontSize.xs,
    color: colors.primary,
    fontWeight: "500",
  },
});
