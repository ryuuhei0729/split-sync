import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  StyleSheet,
  Linking,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../contexts/AuthProvider";
import { restorePurchases } from "../../lib/revenucat";
import { deleteAccount, ApiError } from "../../lib/api-client";
import { colors, spacing, radius, fontSize } from "../../lib/theme";
import { PlanFeatureList } from "../../components/plan/PlanFeatureList";

export default function AccountScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user, subscription, signOut, refreshSubscription, guestMode } = useAuth();
  const plan = subscription?.plan ?? "free";
  const [deleting, setDeleting] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const handleSignOut = () => {
    Alert.alert(t("auth.logout"), t("auth.logoutConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("auth.logout"),
        style: "destructive",
        onPress: async () => {
          const { error } = await signOut();
          if (error) {
            Alert.alert(t("common.error"), t("auth.errors.logoutFailed"));
          } else {
            router.replace("/(app)");
          }
        },
      },
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      t("auth.deleteAccount"),
      t("auth.deleteAccountStep1"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("auth.deleteAccountNext"),
          style: "destructive",
          onPress: () => {
            Alert.alert(
              t("auth.deleteAccountFinal"),
              t("auth.deleteAccountStep2"),
              [
                { text: t("common.cancel"), style: "cancel" },
                {
                  text: t("auth.deleteAccount"),
                  style: "destructive",
                  onPress: async () => {
                    setDeleting(true);
                    try {
                      await deleteAccount();

                      await signOut();
                      router.replace("/(app)");
                    } catch (err) {
                      const message =
                        err instanceof ApiError
                          ? err.message
                          : err instanceof Error
                            ? err.message
                            : t("auth.errors.deleteAccountFailed");
                      Alert.alert(t("common.error"), message);
                    } finally {
                      setDeleting(false);
                    }
                  },
                },
              ],
            );
          },
        },
      ],
    );
  };

  // リストア購入処理
  const handleRestore = async () => {
    if (guestMode) {
      router.push("/(auth)/get-started");
      return;
    }
    setRestoring(true);
    try {
      const customerInfo = await restorePurchases();
      if (customerInfo) {
        await refreshSubscription();
        Alert.alert(t("paywall.restoreSuccess"), t("paywall.restoreSuccessMessage"));
      } else {
        Alert.alert(t("paywall.restoreEmpty"), t("paywall.restoreEmptyMessage"));
      }
    } catch {
      Alert.alert(t("common.error"), t("paywall.restoreFailed"));
    } finally {
      setRestoring(false);
    }
  };

  // トライアル残日数を計算
  const trialDaysRemaining = (() => {
    if (!subscription?.trialEnd) return null;
    const end = new Date(subscription.trialEnd);
    const now = new Date();
    const diff = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return diff > 0 ? diff : null;
  })();

  // 次回更新日のフォーマット
  const renewalDateFormatted = (() => {
    if (!subscription?.premiumExpiresAt) return null;
    const date = new Date(subscription.premiumExpiresAt);
    return date.toLocaleDateString();
  })();

  const appVersion = Constants.expoConfig?.version || "1.0.0";

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <View style={styles.content}>
        {/* User info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("auth.accountInfo")}</Text>
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>{t("auth.email")}</Text>
              <Text style={styles.infoValue}>{user?.email || "—"}</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>{t("auth.plan")}</Text>
              <View
                style={[styles.badge, plan === "premium" ? styles.premiumBadge : styles.freeBadge]}
              >
                <Text
                  style={[
                    styles.badgeText,
                    plan === "premium" ? styles.premiumBadgeText : styles.freeBadgeText,
                  ]}
                >
                  {plan === "premium"
                    ? t("auth.planPremium")
                    : plan === "free"
                      ? t("auth.planFree")
                      : t("auth.planGuest")}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* サブスクリプション詳細 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("account.subscriptionSection")}</Text>
          <View style={styles.infoCard}>
            {!guestMode && plan === "premium" ? (
              <>
                {/* トライアル中 */}
                {subscription?.status === "trialing" && trialDaysRemaining && (
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>{t("account.trialRemaining")}</Text>
                    <Text style={styles.trialText}>
                      {t("account.trialDays", { days: trialDaysRemaining })}
                    </Text>
                  </View>
                )}

                {/* 次回更新日 */}
                {renewalDateFormatted && (
                  <>
                    {subscription?.status === "trialing" && trialDaysRemaining && (
                      <View style={styles.divider} />
                    )}
                    <View style={styles.infoRow}>
                      <Text style={styles.infoLabel}>
                        {subscription?.cancelAtPeriodEnd
                          ? t("account.expiresAt")
                          : t("account.renewsAt")}
                      </Text>
                      <Text style={styles.infoValue}>{renewalDateFormatted}</Text>
                    </View>
                  </>
                )}

                {/* 解約状態の表示 */}
                {subscription?.cancelAtPeriodEnd && (
                  <>
                    <View style={styles.divider} />
                    <Text style={styles.canceledNote}>{t("account.canceledNote")}</Text>
                  </>
                )}
              </>
            ) : (
              <>
                <PlanFeatureList currentPlan={guestMode ? "guest" : plan} />
                <Text style={styles.upgradePrompt}>{t("account.upgradePrompt")}</Text>
                {guestMode ? (
                  <TouchableOpacity
                    style={styles.upgradeButton}
                    onPress={() => router.push("/(auth)/get-started")}
                    accessibilityRole="button"
                    accessibilityLabel={t("paywall.loginToUpgrade")}
                  >
                    <Text style={styles.upgradeButtonText}>{t("paywall.loginToUpgrade")}</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={styles.upgradeButton}
                    onPress={() => router.push("/(app)/paywall")}
                    accessibilityRole="button"
                    accessibilityLabel={t("account.upgradeToPremium")}
                  >
                    <Text style={styles.upgradeButtonText}>{t("account.upgradeToPremium")}</Text>
                  </TouchableOpacity>
                )}
              </>
            )}

            {/* リストア購入ボタン */}
            {!guestMode && (
              <>
                <View style={styles.divider} />
                <TouchableOpacity
                  style={styles.restoreRow}
                  onPress={handleRestore}
                  disabled={restoring}
                  accessibilityRole="button"
                  accessibilityLabel={t("paywall.restore")}
                  accessibilityState={{ busy: restoring }}
                >
                  {restoring ? (
                    <ActivityIndicator color={colors.primary} size="small" />
                  ) : (
                    <Text style={styles.restoreText}>{t("paywall.restore")}</Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

        {/* Sign out */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.signOutButton}
            onPress={handleSignOut}
            accessibilityRole="button"
            accessibilityLabel={t("auth.logout")}
          >
            <Text style={styles.signOutButtonText}>{t("auth.logout")}</Text>
          </TouchableOpacity>
        </View>

        {/* Delete account */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={handleDeleteAccount}
            disabled={deleting}
            accessibilityRole="button"
            accessibilityLabel={t("auth.deleteAccount")}
            accessibilityState={{ busy: deleting }}
          >
            {deleting ? (
              <ActivityIndicator color={colors.destructive} />
            ) : (
              <Text style={styles.deleteButtonText}>{t("auth.deleteAccount")}</Text>
            )}
          </TouchableOpacity>
          <Text style={styles.deleteWarning}>{t("auth.deleteAccountWarning")}</Text>
        </View>

        {/* サブスクリプション管理 */}
        <TouchableOpacity
          style={styles.manageSubButton}
          onPress={() =>
            Linking.openURL(
              Platform.select({
                ios: "https://apps.apple.com/account/subscriptions",
                android: "https://play.google.com/store/account/subscriptions",
                default: "https://apps.apple.com/account/subscriptions",
              }),
            )
          }
        >
          <Text style={styles.manageSubText}>{t("account.manageSubscription")}</Text>
        </TouchableOpacity>

        {/* 利用規約・プライバシーポリシー */}
        <View style={styles.legalLinks}>
          <Text
            style={styles.legalLink}
            onPress={() => Linking.openURL("https://timer.swim-hub.app/terms")}
          >
            {t("account.termsLink")}
          </Text>
          <Text style={styles.legalDivider}> | </Text>
          <Text
            style={styles.legalLink}
            onPress={() => Linking.openURL("https://timer.swim-hub.app/privacy")}
          >
            {t("account.privacyLink")}
          </Text>
        </View>

        {/* App info */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            {t("common.appName")} v{appVersion}
          </Text>
        </View>
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
    padding: spacing.lg,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: fontSize.xs,
    fontWeight: "600",
    color: colors.muted,
    marginBottom: spacing.sm,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  infoLabel: {
    fontSize: fontSize.md,
    color: colors.muted,
  },
  infoValue: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    fontWeight: "500",
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  badge: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  freeBadge: {
    backgroundColor: colors.surfaceRaised,
  },
  premiumBadge: {
    backgroundColor: "#FEF3C7",
  },
  badgeText: {
    fontSize: 13,
    fontWeight: "600",
  },
  freeBadgeText: {
    color: colors.muted,
  },
  premiumBadgeText: {
    color: "#92400E",
  },
  trialText: {
    fontSize: fontSize.md,
    color: colors.primary,
    fontWeight: "600",
  },
  canceledNote: {
    fontSize: fontSize.sm,
    color: colors.destructive,
    textAlign: "center",
  },
  upgradePrompt: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  upgradeButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: 14,
    alignItems: "center",
  },
  upgradeButtonText: {
    color: colors.white,
    fontSize: fontSize.md,
    fontWeight: "700",
  },
  restoreRow: {
    alignItems: "center",
    paddingVertical: 4,
  },
  restoreText: {
    color: colors.primary,
    fontSize: fontSize.md,
    fontWeight: "500",
  },
  signOutButton: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#FCA5A5",
  },
  signOutButtonText: {
    color: colors.destructive,
    fontSize: fontSize.md,
    fontWeight: "600",
  },
  deleteButton: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.destructive,
  },
  deleteButtonText: {
    color: colors.destructive,
    fontSize: fontSize.md,
    fontWeight: "600",
  },
  deleteWarning: {
    fontSize: fontSize.xs,
    color: colors.muted,
    textAlign: "center",
    marginTop: spacing.sm,
  },
  manageSubButton: {
    alignItems: "center",
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
  },
  manageSubText: {
    color: colors.primary,
    fontSize: fontSize.sm,
    fontWeight: "500",
  },
  legalLinks: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: spacing.xl,
  },
  legalLink: {
    fontSize: fontSize.xs,
    color: colors.primary,
    fontWeight: "500",
  },
  legalDivider: {
    fontSize: fontSize.xs,
    color: colors.muted,
  },
  footer: {
    alignItems: "center",
    marginTop: "auto",
    paddingBottom: spacing.lg,
  },
  footerText: {
    fontSize: fontSize.xs,
    color: colors.muted,
  },
});
