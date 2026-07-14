import { useState, useCallback, useEffect } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Text,
  ToastAndroid,
  Platform,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { VideoPlayer } from "../../components/video/VideoPlayer";
import { SignalDetector } from "../../components/audio/SignalDetector";
import { SplitsPanel } from "../../components/splits/SplitsPanel";
import { TabBar } from "../../components/ui/TabBar";
import { useEditorStore } from "../../stores/editor-store";
import { colors, spacing, radius, fontSize } from "../../lib/theme";

export default function EditorScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const startTime = useEditorStore((s) => s.startTime);
  const isFinished = useEditorStore((s) => s.isFinished);
  const setDesignConfirmed = useEditorStore((s) => s.setDesignConfirmed);
  const [activeTab, setActiveTab] = useState("signal");

  const splitsLocked = startTime === null;

  // Design is locked to minimal-white and edited inline on the video, so the
  // legacy designConfirmed gate auto-passes once the start time is set.
  useEffect(() => {
    setDesignConfirmed(startTime !== null);
  }, [startTime, setDesignConfirmed]);

  const TABS = [
    {
      key: "signal",
      label: t("editor.tabSignal"),
      icon: ({ color, size }: { color: string; size: number }) => (
        <Ionicons name="radio-outline" size={size} color={color} />
      ),
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
      if (key === "splits") {
        showHint(t("editor.gateSignalRequired"));
      }
    },
    [showHint, t],
  );

  const handleSignalConfirm = useCallback(() => {
    setActiveTab("splits");
  }, []);

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

      {/* Tab Content (bottom half).
          ScrollView uses automaticallyAdjustKeyboardInsets so iOS pads the
          content inset by the keyboard height and auto-scrolls the focused
          TextInput into view. Android relies on the manifest's
          windowSoftInputMode=adjustResize. */}
      {activeTab === "signal" ? (
        // Scrollable so the confirm button stays reachable on short screens
        // (the 16:9 video section leaves little room below the tab bar).
        <ScrollView style={styles.tabContent}>
          <SignalDetector onConfirm={handleSignalConfirm} />
        </ScrollView>
      ) : (
        <ScrollView
          style={styles.tabContent}
          contentContainerStyle={styles.tabContentInner}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
          keyboardDismissMode="interactive"
        >
          {activeTab === "splits" && <SplitsPanel />}
        </ScrollView>
      )}

      {/* Bottom action bar */}
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
