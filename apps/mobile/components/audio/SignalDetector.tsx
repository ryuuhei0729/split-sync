import { useState, useCallback, useEffect, useRef } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Modal } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useEditorStore } from "../../stores/editor-store";
import { formatTime } from "@swimhub-timer/shared";
import { extractAudioFromVideo, generateWaveformData } from "../../lib/audio/extractor";
import { detectStartSignal } from "../../lib/audio/signal-detector";
import { WaveformDisplay } from "./WaveformDisplay";
import { colors, spacing, radius, fontSize } from "../../lib/theme";

interface SignalDetectorProps {
  onConfirm?: () => void;
}

export function SignalDetector({ onConfirm }: SignalDetectorProps) {
  const { t } = useTranslation();
  const {
    videoUri,
    currentVideoTime,
    detectedSignalTime,
    startTime,
    isDetecting,
    audioData,
    waveformData,
    setDetectedSignalTime,
    setStartTime,
    setIsDetecting,
    setAudioData,
    setWaveformData,
    seekVideoAndPause,
  } = useEditorStore();

  const [error, setError] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const extractedForUri = useRef<string | null>(null);

  // Auto-extract audio when video is available
  useEffect(() => {
    if (!videoUri || audioData || extractedForUri.current === videoUri) return;
    extractedForUri.current = videoUri;

    let cancelled = false;
    (async () => {
      setIsExtracting(true);
      try {
        const audio = await extractAudioFromVideo(videoUri);
        if (cancelled) return;
        setAudioData(audio);
        const waveform = generateWaveformData(audio.pcmData);
        setWaveformData(waveform);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : t("signal.audioExtractionError"));
        }
      } finally {
        if (!cancelled) setIsExtracting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [videoUri, audioData, setAudioData, setWaveformData, t]);

  const runAutoDetect = async () => {
    if (!audioData) return;

    setIsDetecting(true);
    setError(null);

    // Yield once so the loading modal commits to native before the synchronous
    // FFT pass blocks the JS thread. Matches the web flow's microtask flush.
    await new Promise<void>((r) => setTimeout(r, 0));

    try {
      // Race start happens early — analyzing only the first 30s keeps Hermes's
      // FFT work bounded on long clips.
      const ANALYSIS_WINDOW_SEC = 30;
      const maxSamples = Math.floor(ANALYSIS_WINDOW_SEC * audioData.sampleRate);
      const target =
        audioData.pcmData.length > maxSamples
          ? {
              ...audioData,
              pcmData: audioData.pcmData.subarray(0, maxSamples),
              duration: ANALYSIS_WINDOW_SEC,
            }
          : audioData;
      const result = detectStartSignal(target);
      if (result) {
        setDetectedSignalTime(result.time);
        seekVideoAndPause(result.time);
      } else {
        setError(t("signal.notDetected"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("signal.audioAnalysisError"));
    } finally {
      setIsDetecting(false);
    }
  };

  const onWaveformSeek = useCallback(
    (time: number) => {
      setDetectedSignalTime(time);
      seekVideoAndPause(time);
    },
    [setDetectedSignalTime, seekVideoAndPause],
  );

  const adjustSignal = (delta: number) => {
    const current = detectedSignalTime ?? currentVideoTime;
    const newTime = Math.max(0, current + delta);
    setDetectedSignalTime(newTime);
    seekVideoAndPause(newTime);
  };

  const confirmStart = () => {
    if (detectedSignalTime !== null) {
      setStartTime(detectedSignalTime);
      onConfirm?.();
    }
  };

  const isConfirmed = startTime !== null;

  const isLoading = isExtracting || isDetecting;
  const loadingMessage = isExtracting ? t("signal.extracting") : t("signal.analyzingStart");

  return (
    <View style={styles.container}>
      {/* Full-screen loading modal */}
      <Modal visible={isLoading} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={styles.modalText}>{loadingMessage}</Text>
          </View>
        </View>
      </Modal>

      {/* 1. Auto detect button (or confirmed status when locked in) */}
      {isConfirmed ? (
        <View style={styles.statusCard}>
          <Text style={styles.statusLabel}>{t("signal.confirmedTime")}</Text>
          <Text style={styles.statusTime}>{formatTime(startTime)}</Text>
          <Pressable style={styles.resetBtn} onPress={() => setStartTime(null)}>
            <Text style={styles.resetBtnText}>{t("signal.change")}</Text>
          </Pressable>
        </View>
      ) : !isDetecting && audioData ? (
        <Pressable
          style={({ pressed }) => [styles.autoDetectBtn, pressed && styles.autoDetectBtnPressed]}
          onPress={runAutoDetect}
        >
          <Ionicons name="scan" size={24} color={colors.primary} />
          <View>
            <Text style={styles.autoDetectBtnText}>{t("signal.autoDetect")}</Text>
            <Text style={styles.autoDetectBtnSub}>{t("signal.autoDetectDesc")}</Text>
          </View>
        </Pressable>
      ) : null}

      {/* Error */}
      {error && (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* 2. Waveform */}
      {waveformData && audioData && (
        <WaveformDisplay
          waveformData={waveformData}
          duration={audioData.duration}
          signalTime={detectedSignalTime ?? -1}
          currentTime={currentVideoTime}
          onSeek={onWaveformSeek}
        />
      )}

      {/* 3. Fine-tune */}
      {!isConfirmed && detectedSignalTime !== null && (
        <View style={styles.tuneSection}>
          <Text style={styles.tuneLabel}>{t("signal.fineTune")}</Text>
          <View style={styles.tuneRow}>
            {[
              { label: "-100ms", delta: -0.1 },
              { label: "-10ms", delta: -0.01 },
              { label: "+10ms", delta: 0.01 },
              { label: "+100ms", delta: 0.1 },
            ].map(({ label, delta }) => (
              <Pressable key={label} style={styles.tuneBtn} onPress={() => adjustSignal(delta)}>
                <Text style={styles.tuneBtnText}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {/* 4. Candidate time + confirm */}
      {!isConfirmed && detectedSignalTime !== null && (
        <View style={styles.statusCard}>
          <Text style={styles.statusLabel}>{t("signal.candidateTime")}</Text>
          <Text style={styles.statusTime}>{formatTime(detectedSignalTime)}</Text>
          <Pressable style={styles.confirmBtn} onPress={confirmStart}>
            <Text style={styles.confirmBtnText}>{t("signal.setAsStartPoint")}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  autoDetectBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.primaryMuted,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  autoDetectBtnPressed: {
    opacity: 0.85,
  },
  autoDetectBtnText: {
    fontSize: fontSize.md,
    fontWeight: "600",
    color: colors.primary,
  },
  autoDetectBtnSub: {
    fontSize: fontSize.xs,
    color: colors.muted,
    marginTop: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center",
    gap: spacing.md,
    minWidth: 200,
  },
  modalText: {
    fontSize: fontSize.sm,
    color: colors.text,
    fontWeight: "500",
  },
  errorCard: {
    backgroundColor: "rgba(220, 38, 38, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(220, 38, 38, 0.3)",
    borderRadius: radius.md,
    padding: spacing.md,
  },
  errorText: {
    fontSize: fontSize.sm,
    color: colors.destructive,
  },
  statusCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: "center",
    gap: spacing.xs,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  statusLabel: {
    fontSize: fontSize.xs,
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  statusTime: {
    fontSize: fontSize.xl,
    fontFamily: "monospace",
    fontWeight: "700",
    color: colors.primary,
  },
  resetBtn: {
    marginTop: spacing.xs,
  },
  resetBtnText: {
    fontSize: fontSize.xs,
    color: colors.primary,
    fontWeight: "500",
  },
  tuneSection: {
    gap: spacing.md,
  },
  tuneLabel: {
    fontSize: fontSize.xs,
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  tuneRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  tuneBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  tuneBtnText: {
    fontSize: fontSize.xs,
    color: colors.muted,
    fontWeight: "500",
  },
  confirmBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: "center",
    alignSelf: "stretch",
    marginTop: spacing.sm,
  },
  confirmBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.white,
  },
});
