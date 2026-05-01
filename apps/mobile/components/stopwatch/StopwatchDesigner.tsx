import { useRef, useCallback } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import { useEditorStore } from "../../stores/editor-store";
import {
  STOPWATCH_PRESETS,
  STOPWATCH_FONT_SIZE_MAX,
  STOPWATCH_FONT_SIZE_MIN,
} from "@swimhub-timer/shared";
import { colors, spacing, radius, fontSize } from "../../lib/theme";

const SIZE_MIN = STOPWATCH_FONT_SIZE_MIN;
const SIZE_MAX = STOPWATCH_FONT_SIZE_MAX;

export function StopwatchDesigner() {
  const { t } = useTranslation();
  const { stopwatchConfig, updateStopwatchConfig, setStopwatchConfig } = useEditorStore();

  const trackWidth = useRef(0);

  const seekToSize = useCallback(
    (locationX: number) => {
      if (trackWidth.current <= 0) return;
      const ratio = Math.max(0, Math.min(1, locationX / trackWidth.current));
      const size = Math.round(SIZE_MIN + ratio * (SIZE_MAX - SIZE_MIN));
      updateStopwatchConfig({ fontSize: size });
    },
    [updateStopwatchConfig],
  );

  const isActivePreset = (presetId: string) => {
    const preset = STOPWATCH_PRESETS.find((p) => p.id === presetId);
    if (!preset) return false;
    return (
      stopwatchConfig.fontFamily === preset.config.fontFamily &&
      stopwatchConfig.textColor === preset.config.textColor &&
      stopwatchConfig.backgroundColor === preset.config.backgroundColor
    );
  };

  return (
    <View style={styles.container}>
      {/* Presets */}
      <View style={styles.presetGrid}>
        {STOPWATCH_PRESETS.map((preset) => {
          const active = isActivePreset(preset.id);
          return (
            <Pressable
              key={preset.id}
              style={[styles.presetCard, active && styles.presetCardActive]}
              onPress={() => setStopwatchConfig(preset.config)}
            >
              <View
                style={[
                  styles.presetPreview,
                  {
                    backgroundColor: preset.config.backgroundColor,
                    borderRadius: preset.config.borderRadius,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.presetText,
                    {
                      color: preset.config.textColor,
                      fontFamily:
                        preset.config.fontFamily === "monospace" ? "monospace" : undefined,
                    },
                  ]}
                >
                  0:00.00
                </Text>
              </View>
              <Text style={[styles.presetName, active && styles.presetNameActive]}>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- i18n dynamic key */}
                {t(`design.preset.${preset.id}` as any)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Font Size */}
      <View style={styles.sliderSection}>
        <View style={styles.sliderHeader}>
          <Text style={styles.sliderLabel}>{t("design.size")}</Text>
          <Text style={styles.sliderValue}>{stopwatchConfig.fontSize}px</Text>
        </View>
        <View style={styles.sizeRow}>
          <Pressable
            style={styles.sizeBtn}
            onPress={() =>
              updateStopwatchConfig({
                fontSize: Math.max(SIZE_MIN, stopwatchConfig.fontSize - 2),
              })
            }
          >
            <Text style={styles.sizeBtnText}>-</Text>
          </Pressable>
          <View
            style={styles.sizeTrack}
            onLayout={(e) => {
              trackWidth.current = e.nativeEvent.layout.width;
            }}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={(e) => seekToSize(e.nativeEvent.locationX)}
            onResponderMove={(e) => seekToSize(e.nativeEvent.locationX)}
          >
            <View pointerEvents="none" style={styles.sizeTrackInner}>
              <View style={styles.sizeTrackBg}>
                <View
                  style={[
                    styles.sizeTrackFill,
                    {
                      width: `${((stopwatchConfig.fontSize - SIZE_MIN) / (SIZE_MAX - SIZE_MIN)) * 100}%`,
                    },
                  ]}
                />
              </View>
              <View
                style={[
                  styles.sizeThumb,
                  {
                    left: `${((stopwatchConfig.fontSize - SIZE_MIN) / (SIZE_MAX - SIZE_MIN)) * 100}%`,
                  },
                ]}
              />
            </View>
          </View>
          <Pressable
            style={styles.sizeBtn}
            onPress={() =>
              updateStopwatchConfig({
                fontSize: Math.min(SIZE_MAX, stopwatchConfig.fontSize + 2),
              })
            }
          >
            <Text style={styles.sizeBtnText}>+</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  presetGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  presetCard: {
    width: "48%",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  presetCardActive: {
    borderColor: colors.primaryBorder,
    backgroundColor: colors.primaryMuted,
  },
  presetPreview: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  presetText: {
    fontSize: fontSize.md,
    fontWeight: "700",
  },
  presetName: {
    fontSize: fontSize.xs,
    fontWeight: "500",
    color: colors.muted,
  },
  presetNameActive: {
    color: colors.primary,
  },
  sliderSection: {
    gap: spacing.xs,
  },
  sliderHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sliderLabel: {
    fontSize: fontSize.xs,
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  sliderValue: {
    fontSize: fontSize.sm,
    fontFamily: "monospace",
    color: colors.primary,
  },
  sizeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  sizeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  sizeBtnText: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.text,
  },
  sizeTrack: {
    flex: 1,
    height: 24,
    justifyContent: "center",
  },
  sizeTrackInner: {
    flex: 1,
    justifyContent: "center",
  },
  sizeTrackBg: {
    height: 4,
    backgroundColor: colors.surfaceRaised,
    borderRadius: 2,
    overflow: "hidden",
  },
  sizeTrackFill: {
    height: "100%",
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  sizeThumb: {
    position: "absolute",
    top: 6,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.primary,
    marginLeft: -7,
  },
});
