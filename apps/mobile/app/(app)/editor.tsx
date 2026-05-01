import { useState, useCallback } from "react";
import { View, StyleSheet, ScrollView, Pressable, Text, ToastAndroid, Platform, Alert } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { VideoPlayer } from "../../components/video/VideoPlayer";
import { SignalDetector } from "../../components/audio/SignalDetector";
import { StopwatchDesigner } from "../../components/stopwatch/StopwatchDesigner";
import { SplitsPanel } from "../../components/splits/SplitsPanel";
import { TabBar } from "../../components/ui/TabBar";
import { useEditorStore } from "../../stores/editor-store";
import { colors, spacing, radius, fontSize } from "../../lib/theme";

export default function EditorScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const startTime = useEditorStore((s) => s.startTime);
  const isFinished = useEditorStore((s) => s.isFinished);
  const designConfirmed = useEditorStore((s) => s.designConfirmed);
  const setDesignConfirmed = useEditorStore((s) => s.setDesignConfirmed);
  const [activeTab, setActiveTab] = useState("signal");

  const designLocked = startTime === null;
  const splitsLocked = startTime === null || !designConfirmed;

  const TABS = [
    {
      key: "signal",
      label: t("editor.tabSignal"),
      icon: ({ color, size }: { color: string; size: number }) => (
        <Ionicons name="radio-outline" size={size} color={color} />
      ),
    },
    {
      key: "design",
      label: t("editor.tabDesign"),
      icon: ({ color, size }: { color: string; size: number }) => (
        <Ionicons name="color-palette-outline" size={size} color={color} />
      ),
      disabled: designLocked,
    },
    {
      key: "splits",
      label: t("editor.tabSplits"),
      icon: ({ color, size }: { color: string; size: number }) => (
        <Ionicons name="timer-outline" size={size} color={color} />
      ),
      disabled: splitsLocked,
    },
  ];

  const showHint = useCallback((message: string) => {
    if (Platform.OS === "android") {
      ToastAndroid.show(message, ToastAndroid.SHORT);
    } else {
      Alert.alert("", message);
    }
  }, []);

  const handleDisabledTabPress = useCallback(
    (key: string) => {
      if (key === "design") {
        showHint(t("editor.gateSignalRequired"));
      } else if (key === "splits") {
        if (startTime === null) {
          showHint(t("editor.gateSignalRequired"));
        } else if (!designConfirmed) {
          showHint(t("editor.gateDesignRequired"));
        }
      }
    },
    [showHint, t, startTime, designConfirmed],
  );

  const handleSignalConfirm = useCallback(() => {
    setActiveTab("design");
  }, []);

  const handleDesignConfirm = useCallback(() => {
    setDesignConfirmed(true);
    setActiveTab("splits");
  }, [setDesignConfirmed]);

  // Bottom bar button logic:
  // - design tab + startTime set: "このデザインで確定" → go to splits
  // - splits tab + isFinished: "書き出し" → go to export
  // - splits tab + startTime set + !isFinished: show Finish (handled inside SplitsPanel)
  const showDesignConfirm = activeTab === "design" && startTime !== null;
  const showExport = activeTab === "splits" && isFinished;

  return (
    <View style={styles.container}>
      {/* Video Preview (top half) */}
      <View style={styles.videoSection}>
        <VideoPlayer />
      </View>

      {/* Tab Bar */}
      <TabBar
        tabs={TABS}
        activeKey={activeTab}
        onSelect={setActiveTab}
        onDisabledPress={handleDisabledTabPress}
      />

      {/* Tab Content (bottom half) */}
      <ScrollView
        style={styles.tabContent}
        contentContainerStyle={styles.tabContentInner}
        keyboardShouldPersistTaps="handled"
      >
        {activeTab === "signal" && <SignalDetector onConfirm={handleSignalConfirm} />}
        {activeTab === "design" && <StopwatchDesigner />}
        {activeTab === "splits" && <SplitsPanel />}
      </ScrollView>

      {/* Bottom action bar */}
      {showDesignConfirm && (
        <View style={styles.exportBar}>
          <Pressable
            style={({ pressed }) => [styles.exportBtn, pressed && styles.exportBtnPressed]}
            onPress={handleDesignConfirm}
          >
            <Text style={styles.exportBtnText}>{t("editor.confirmDesign")}</Text>
          </Pressable>
        </View>
      )}
      {showExport && (
        <View style={styles.exportBar}>
          <Pressable
            style={({ pressed }) => [styles.exportBtn, pressed && styles.exportBtnPressed]}
            onPress={() => router.push("/export")}
          >
            <Text style={styles.exportBtnText}>{t("common.export")}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  videoSection: {
    paddingHorizontal: 8,
    paddingTop: 4,
  },
  tabContent: {
    flex: 1,
  },
  tabContentInner: {
    paddingBottom: 100,
  },
  exportBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.md,
    paddingBottom: spacing.xl,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  exportBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: "center",
  },
  exportBtnPressed: {
    opacity: 0.85,
  },
  exportBtnText: {
    fontSize: fontSize.md,
    fontWeight: "700",
    color: colors.white,
  },
});
