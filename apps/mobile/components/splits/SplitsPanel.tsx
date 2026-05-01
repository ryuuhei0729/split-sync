import { View, Text, TextInput, StyleSheet, Pressable, FlatList, Keyboard, ScrollView } from "react-native";
import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { useEditorStore } from "../../stores/editor-store";
import { useAuth } from "../../contexts/AuthProvider";
import { formatTime, getMaxSplitCount, COMMON_RACE_DISTANCES } from "@swimhub-timer/shared";
import { colors, spacing, radius, fontSize } from "../../lib/theme";

interface SplitsPanelProps {
  onFinish?: () => void;
}

export function SplitsPanel({ onFinish }: SplitsPanelProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { subscription, guestMode } = useAuth();
  const effectivePlan = guestMode ? "guest" : (subscription?.plan ?? "free");
  const maxSplits = getMaxSplitCount(effectivePlan);
  const {
    splitTimes,
    isFinished,
    finishTime,
    finishMemo,
    startTime,
    currentVideoTime,
    currentDistanceInput,
    currentMemoInput,
    raceDistance,
    setCurrentDistanceInput,
    setCurrentMemoInput,
    setRaceDistance,
    recordSplit,
    finishRecording,
    removeSplit,
    revertFinish,
    seekVideo,
  } = useEditorStore();

  const elapsed = startTime !== null ? Math.max(0, currentVideoTime - startTime) : 0;
  const splitLimitReached = splitTimes.length >= maxSplits;
  const canFinish = raceDistance !== null && raceDistance > 0;

  // Per-row immediate lap = current splitTime − previous splitTime (sorted by distance).
  const sortedByDistance = [...splitTimes].sort((a, b) => a.distance - b.distance);
  const lapByDistance = new Map<number, number>();
  for (let i = 0; i < sortedByDistance.length; i++) {
    const prevTime = i === 0 ? 0 : sortedByDistance[i - 1].time;
    lapByDistance.set(sortedByDistance[i].distance, sortedByDistance[i].time - prevTime);
  }

  const handleRecord = () => {
    if (splitLimitReached) return;
    Keyboard.dismiss();
    recordSplit(elapsed);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const handleFinish = () => {
    if (!canFinish) return;
    Keyboard.dismiss();
    finishRecording(elapsed, currentMemoInput);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onFinish?.();
  };

  const handleEdit = () => {
    // Revert isFinished to go back to editing mode, keeping split times
    revertFinish();
  };

  const adjustVideo = (delta: number) => {
    const newTime = Math.max(0, currentVideoTime + delta);
    seekVideo(newTime);
  };

  return (
    <View style={styles.container}>
      {/* Race distance picker — required before Finish */}
      {startTime !== null && !isFinished && (
        <View style={styles.raceDistanceCard}>
          <Text style={styles.raceDistanceLabel}>{t("splits.raceDistanceLabel")}</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.raceDistanceRow}
          >
            {COMMON_RACE_DISTANCES.map((d) => {
              const active = raceDistance === d;
              return (
                <Pressable
                  key={d}
                  style={[styles.raceDistanceChip, active && styles.raceDistanceChipActive]}
                  onPress={() => setRaceDistance(active ? null : d)}
                >
                  <Text
                    style={[
                      styles.raceDistanceChipText,
                      active && styles.raceDistanceChipTextActive,
                    ]}
                  >
                    {d}m
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Recording controls */}
      {startTime !== null && !isFinished && (
        <View style={styles.recordingCard}>
          {/* Current time */}
          <Text style={styles.elapsedTime}>{formatTime(elapsed)}</Text>

          {/* Fine-tune buttons */}
          <View style={styles.tuneRow}>
            {[
              { label: "-100ms", delta: -0.1 },
              { label: "-10ms", delta: -0.01 },
              { label: "+10ms", delta: 0.01 },
              { label: "+100ms", delta: 0.1 },
            ].map(({ label, delta }) => (
              <Pressable key={label} style={styles.tuneBtn} onPress={() => adjustVideo(delta)}>
                <Text style={styles.tuneBtnText}>{label}</Text>
              </Pressable>
            ))}
          </View>

          {/* Distance + Record + Memo (single row) */}
          <View style={styles.inputRow}>
            <TextInput
              style={styles.distanceInput}
              placeholder={t("splits.distancePlaceholder")}
              placeholderTextColor={colors.muted}
              value={currentDistanceInput}
              onChangeText={setCurrentDistanceInput}
              keyboardType="decimal-pad"
            />
            <Pressable
              style={[
                styles.recordBtn,
                (!currentDistanceInput || splitLimitReached) && styles.btnDisabled,
              ]}
              onPress={handleRecord}
              disabled={!currentDistanceInput || splitLimitReached}
            >
              <Text style={styles.recordBtnText}>{t("splits.record")}</Text>
            </Pressable>
            <TextInput
              style={styles.memoInput}
              placeholder={t("splits.memoPlaceholder")}
              placeholderTextColor={colors.muted}
              value={currentMemoInput}
              onChangeText={setCurrentMemoInput}
            />
          </View>

          {/* Split limit message */}
          {splitLimitReached && (
            <Pressable
              style={styles.limitBanner}
              onPress={() =>
                effectivePlan === "guest"
                  ? router.push("/(auth)/get-started")
                  : router.push("/(app)/paywall")
              }
            >
              <Text style={styles.limitBannerText}>
                {t("splits.limitReached", { max: maxSplits })}
              </Text>
              <Text style={styles.limitBannerLink}>
                {effectivePlan === "guest"
                  ? t("splits.loginToRecordMore")
                  : t("splits.upgradeToPremium")}
              </Text>
            </Pressable>
          )}

          {/* Finish */}
          <Pressable
            style={[styles.finishBtn, !canFinish && styles.btnDisabled]}
            onPress={handleFinish}
            disabled={!canFinish}
          >
            <Text style={styles.finishBtnText}>
              {canFinish
                ? t("splits.finishAtDistance", { distance: raceDistance })
                : t("splits.finishNeedRaceDistance")}
            </Text>
          </Pressable>
        </View>
      )}

      {/* Finish summary */}
      {isFinished && finishTime !== null && (
        <>
          <Pressable
            style={styles.finishCard}
            onPress={() => startTime !== null && seekVideo(startTime + finishTime)}
          >
            <Text style={styles.finishLabel}>{t("splits.finalTime")}</Text>
            <Text style={styles.finishTimeText}>{formatTime(finishTime)}</Text>
            {finishMemo ? <Text style={styles.finishMemoText}>{finishMemo}</Text> : null}
          </Pressable>
          <Pressable style={styles.editBtn} onPress={handleEdit}>
            <Text style={styles.editBtnText}>{t("splits.edit")}</Text>
          </Pressable>
        </>
      )}

      {/* Split list */}
      {splitTimes.length === 0 && !isFinished ? (
        <Text style={styles.emptyText}>{t("splits.emptyHint")}</Text>
      ) : (
        <FlatList
          data={splitTimes}
          keyExtractor={(item) => String(item.distance)}
          scrollEnabled={false}
          renderItem={({ item, index }) => (
            <Pressable
              style={styles.splitRow}
              onPress={() => startTime !== null && seekVideo(startTime + item.time)}
            >
              <View style={styles.distanceBadge}>
                <Text style={styles.distanceBadgeText}>{item.distance}m</Text>
              </View>
              <Text style={styles.splitTime}>{formatTime(item.time)}</Text>
              {(() => {
                const lap = lapByDistance.get(item.distance);
                return lap !== undefined && lap > 0 ? (
                  <Text style={styles.lapTime}>
                    {t("splits.lap")}: {formatTime(lap)}
                  </Text>
                ) : null;
              })()}
              {item.memo ? (
                <Text style={styles.splitMemo} numberOfLines={1}>{item.memo}</Text>
              ) : null}
              {!isFinished && (
                <Pressable style={styles.deleteBtn} onPress={() => removeSplit(index)}>
                  <Text style={styles.deleteBtnText}>×</Text>
                </Pressable>
              )}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  raceDistanceCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  raceDistanceLabel: {
    fontSize: fontSize.xs,
    color: colors.muted,
    fontWeight: "600",
  },
  raceDistanceRow: {
    flexDirection: "row",
    gap: spacing.xs,
    paddingVertical: 2,
  },
  raceDistanceChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  raceDistanceChipActive: {
    backgroundColor: colors.primaryMuted,
    borderColor: colors.primaryBorder,
  },
  raceDistanceChipText: {
    fontSize: fontSize.sm,
    fontFamily: "monospace",
    fontWeight: "600",
    color: colors.muted,
  },
  raceDistanceChipTextActive: {
    color: colors.primary,
  },
  recordingCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  elapsedTime: {
    fontSize: fontSize.md,
    fontFamily: "monospace",
    fontWeight: "700",
    color: colors.primary,
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
  tuneRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  tuneBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  tuneBtnText: {
    fontSize: fontSize.xs,
    color: colors.muted,
    fontWeight: "500",
  },
  inputRow: {
    flexDirection: "row",
    gap: spacing.xs,
    alignItems: "center",
  },
  distanceInput: {
    width: 72,
    height: 36,
    paddingHorizontal: spacing.sm,
    fontSize: fontSize.sm,
    fontFamily: "monospace",
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    textAlign: "center",
  },
  recordBtn: {
    height: 36,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.primaryMuted,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  recordBtnText: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.primary,
  },
  btnDisabled: {
    opacity: 0.4,
  },
  memoInput: {
    flex: 1,
    height: 36,
    paddingHorizontal: spacing.sm,
    fontSize: fontSize.sm,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
  },
  finishBtn: {
    height: 40,
    backgroundColor: colors.destructive,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  finishBtnText: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.white,
  },
  finishCard: {
    backgroundColor: colors.primaryMuted,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  finishLabel: {
    fontSize: fontSize.xs,
    color: colors.muted,
    fontWeight: "500",
  },
  finishTimeText: {
    fontSize: fontSize.xl,
    fontFamily: "monospace",
    fontWeight: "700",
    color: colors.primary,
    fontVariant: ["tabular-nums"],
  },
  finishMemoText: {
    fontSize: fontSize.xs,
    color: colors.muted,
    marginTop: spacing.xs,
  },
  editBtn: {
    height: 40,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  editBtnText: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.muted,
  },
  emptyText: {
    fontSize: fontSize.sm,
    color: colors.muted,
    textAlign: "center",
    lineHeight: 20,
    paddingVertical: spacing.xl,
  },
  splitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    marginBottom: spacing.xs,
  },
  distanceBadge: {
    backgroundColor: colors.primaryMuted,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    minWidth: 48,
    alignItems: "center",
  },
  distanceBadgeText: {
    fontSize: fontSize.xs,
    fontFamily: "monospace",
    fontWeight: "700",
    color: colors.primary,
  },
  splitTime: {
    fontSize: fontSize.sm,
    fontFamily: "monospace",
    fontWeight: "600",
    color: colors.text,
    fontVariant: ["tabular-nums"],
  },
  lapTime: {
    fontSize: fontSize.xs,
    fontFamily: "monospace",
    color: colors.muted,
    fontVariant: ["tabular-nums"],
  },
  splitMemo: {
    flex: 1,
    fontSize: fontSize.xs,
    color: colors.muted,
    textAlign: "right",
  },
  deleteBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteBtnText: {
    fontSize: 16,
    color: colors.muted,
  },
  limitBanner: {
    backgroundColor: "#FEF3C7",
    borderWidth: 1,
    borderColor: "#FDE68A",
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  limitBannerText: {
    fontSize: fontSize.xs,
    color: "#92400E",
    lineHeight: 16,
  },
  limitBannerLink: {
    fontSize: fontSize.xs,
    color: "#D97706",
    fontWeight: "600",
    lineHeight: 16,
    marginTop: spacing.xs,
    textDecorationLine: "underline",
  },
});
