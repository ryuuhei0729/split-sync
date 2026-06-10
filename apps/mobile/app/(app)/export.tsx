import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { View, Text, StyleSheet, Pressable, Alert, Dimensions } from "react-native";
import { useRouter } from "expo-router";
import type * as SharingType from "expo-sharing";
import { useTranslation } from "react-i18next";
import { useEditorStore } from "../../stores/editor-store";
import { useAuth } from "../../contexts/AuthProvider";
import {
  formatTime,
  getAvailableResolutions,
  shouldShowWatermark,
  checkIsPremium,
  SPLIT_DISPLAY_DURATION_SECONDS,
} from "@swimhub-timer/shared";
import type { ExportResolution } from "@swimhub-timer/shared";
import {
  exportVideoWithStopwatch,
  saveToPhotoLibrary,
  cleanupExportFiles,
  computeSummaryStartT,
  type TimerSequenceInput,
} from "../../lib/video/export-pipeline";
import {
  createRewardedAdController,
  type AdState,
  type RewardedAdController,
} from "../../lib/ads/rewarded-ad";
import { colors, spacing, radius, fontSize } from "../../lib/theme";
import {
  canGuestUseToday,
  markGuestUsedToday,
  getGuestTodayCount,
} from "../../lib/guest-daily-limit";
import { GuestExportIndicator } from "../../components/plan/GuestExportIndicator";
import { FinishSummaryTable } from "../../components/splits/FinishSummaryTable";
import {
  getStopwatchWrapperStyle,
  getMeasuredWrapperStyle,
} from "../../components/stopwatch/StopwatchOverlay";

// Phase 2 (design-skia-unified-renderer.md §4.2/§5): render the finish-summary
// overlay with the shared Skia renderer instead of capturing the RN
// FinishSummaryTable via react-native-view-shot. Keep this OFF until the Phase 0
// native spike (skia-smoke.tsx) is GO *and* the live preview is swapped to
// StopwatchSkiaOverlay — otherwise the Skia export would no longer match the
// still-RN preview. When ON, a Skia failure transparently falls back to the
// view-shot capture below, so flipping it can never produce a blank summary.
const USE_SKIA_SUMMARY = true;

// Phase 4 (design-skia-unified-renderer.md §4.2/§5): render the live timer (and
// active split) as a Skia PNG sequence overlaid by FFmpeg, retiring `drawtext`
// so the timer box height matches the preview exactly. Heaviest path (fps ×
// window frames) — keep OFF until Phase 0 is GO, the preview is on
// StopwatchSkiaOverlay, and the ffmpeg-fork's image2 demuxer is confirmed.
// For a fully pixel-matched overlay also enable USE_SKIA_SUMMARY; otherwise the
// summary still comes from the view-shot capture (functional, but not matched
// to the Skia-rendered timer).
const USE_SKIA_TIMER_SEQUENCE = true;
const SKIA_TIMER_SEQUENCE_FPS = 30;

// react-native-view-shot loaded lazily to avoid crashing in Expo Go
function getCaptureRef() {
  try {
    const { captureRef } = require("react-native-view-shot") as typeof import("react-native-view-shot");
    return captureRef;
  } catch {
    return null;
  }
}

export default function ExportScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { subscription, guestMode } = useAuth();
  const effectivePlan = guestMode ? "guest" : (subscription?.plan ?? "free");
  const {
    videoUri,
    videoMetadata,
    startTime,
    stopwatchConfig,
    exportSettings,
    setExportSettings,
    splitTimes,
    isFinished,
    finishTime,
    raceDistance,
  } = useEditorStore();

  // --- Encoding state ---
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // --- Ad state ---
  const adControllerRef = useRef<RewardedAdController | null>(null);
  const [adState, setAdState] = useState<AdState>("idle");
  const [adRewardEarned, setAdRewardEarned] = useState(false);
  const [adUnavailable, setAdUnavailable] = useState(false);
  const exportTriggeredRef = useRef(false);

  // --- Export limit state ---
  const [limitReached, setLimitReached] = useState(false);

  // --- Summary PNG capture ref & URI ---
  const summaryViewRef = useRef<View>(null);
  const [capturedSummaryUri, setCapturedSummaryUri] = useState<string | null>(null);
  const [captureSummaryLayout, setCaptureSummaryLayout] = useState<
    { width: number; height: number } | null
  >(null);
  const summaryReadyRef = useRef(false);

  // --- Derived ---
  const exportComplete = outputPath !== null;
  const isPremium = checkIsPremium(subscription);
  const canProceed = exportComplete && (isPremium || adRewardEarned || adUnavailable);
  const duration = videoMetadata?.duration ?? 0;
  const availableResolutions = getAvailableResolutions(effectivePlan);
  const showWatermark = shouldShowWatermark(effectivePlan);

  const videoWidth = videoMetadata?.width ?? 1920;
  const videoHeight = videoMetadata?.height ?? 1080;

  const remainingExports = useMemo(() => {
    if (effectivePlan === "premium" || effectivePlan === "free") return null;
    if (effectivePlan === "guest") {
      const used = getGuestTodayCount("timer");
      return Math.max(0, 1 - used);
    }
    return null;
  }, [effectivePlan]);

  const ALL_RESOLUTIONS: { key: ExportResolution; label: string }[] = [
    { key: "original", label: t("exportScreen.original") },
    { key: "1080", label: "1080p" },
    { key: "720", label: "720p" },
  ];

  // Normalize resolution when available resolutions change (e.g. plan downgrade)
  useEffect(() => {
    if (!availableResolutions.includes(exportSettings.resolution)) {
      setExportSettings({ resolution: availableResolutions[0] ?? "720" });
    }
  }, [availableResolutions, exportSettings.resolution, setExportSettings]);

  // Preload ad on mount (premium users skip ads)
  useEffect(() => {
    if (isPremium) {
      setAdUnavailable(true);
      return;
    }

    const controller = createRewardedAdController();
    if (!controller) {
      setAdUnavailable(true);
      return;
    }
    adControllerRef.current = controller;

    const unsubscribe = controller.onStateChange((state) => {
      setAdState(state);
      if (state === "rewarded") {
        setAdRewardEarned(true);
      }
    });

    controller.load();

    return () => {
      unsubscribe();
      controller.dispose();
    };
  }, [isPremium]);

  // If ad loads AFTER export was triggered, show it automatically
  useEffect(() => {
    if (exportTriggeredRef.current && adState === "loaded" && !adRewardEarned && !adUnavailable) {
      adControllerRef.current?.show().catch(() => setAdUnavailable(true));
    }
  }, [adState, adRewardEarned, adUnavailable]);

  // Fallback: if ad fails to load, allow export without ad after delay
  useEffect(() => {
    if (adState === "error" && !adUnavailable) {
      const timer = setTimeout(() => setAdUnavailable(true), 2000);
      return () => clearTimeout(timer);
    }
  }, [adState, adUnavailable]);

  // Set limitReached based on remaining exports (guest only; free/premium unlimited)
  useEffect(() => {
    if (effectivePlan === "premium" || effectivePlan === "free") {
      setLimitReached(false);
      return;
    }
    if (effectivePlan === "guest") {
      setLimitReached(!canGuestUseToday("timer"));
      return;
    }
  }, [effectivePlan]);

  // Pre-capture the summary PNG once the off-screen wrapper has laid out and
  // settled to pixel-based positioning. captureSummaryLayout becoming
  // non-null is the signal that the wrapper re-rendered with absolute coords
  // — the capture before that point would use the percentage/transform style
  // that doesn't always survive view-shot's snapshot.
  useEffect(() => {
    // The Skia summary path renders headlessly at export time — no view-shot
    // pre-capture needed (and capturing here would pre-fill capturedSummaryUri,
    // shadowing the Skia render).
    if (USE_SKIA_SUMMARY) return;
    if (!isFinished || finishTime === null) return;
    if (!captureSummaryLayout) return;
    if (summaryReadyRef.current) return;
    const handle = setTimeout(() => {
      const captureRef = getCaptureRef();
      if (!captureRef || !summaryViewRef.current) return;
      captureRef(summaryViewRef, {
        format: "png",
        quality: 1.0,
        width: videoWidth,
        height: videoHeight,
        // iOS-only: use renderInContext instead of the default
        // drawViewHierarchyInRect. Recommended by the view-shot README when
        // the default strategy returns a blank bitmap.
        useRenderInContext: true,
      })
        .then((uri) => {
          summaryReadyRef.current = true;
          setCapturedSummaryUri(uri);
        })
        .catch(() => {
          // Leave summaryReadyRef false so handleExport will try again.
        });
    }, 100);
    return () => clearTimeout(handle);
  }, [isFinished, finishTime, videoWidth, videoHeight, captureSummaryLayout]);

  const handleExport = useCallback(async () => {
    if (!videoUri || startTime === null) {
      Alert.alert(t("common.error"), t("exportScreen.needVideoAndStart"));
      return;
    }

    if (effectivePlan === "guest") {
      if (!canGuestUseToday("timer")) {
        setLimitReached(true);
        return;
      }
    }

    let resolvedSettings = exportSettings;
    if (!availableResolutions.includes(exportSettings.resolution)) {
      const fallback = availableResolutions[0] ?? "720";
      setExportSettings({ resolution: fallback });
      resolvedSettings = { ...exportSettings, resolution: fallback };
    }

    setIsExporting(true);
    setProgress(0);
    setError(null);
    exportTriggeredRef.current = true;

    // --- Show ad (fire-and-forget; premium skips) ---
    if (!isPremium) {
      const controller = adControllerRef.current;
      if (controller) {
        const currentState = controller.getState();
        if (currentState === "loaded") {
          controller.show().catch(() => setAdUnavailable(true));
        } else if (currentState !== "loading") {
          setAdUnavailable(true);
        }
      }
    }

    // --- Capture summary PNG (only when finished) ---
    // If pre-capture (on mount) already produced a URI, reuse it. Otherwise
    // capture now. Pre-capture avoids the race where the off-screen view
    // hadn't fully rendered by the time the user pressed the export button.
    let summaryImageUri: string | null = capturedSummaryUri;

    // Preferred path: render the summary headlessly with the shared Skia
    // renderer (pixel-identical to the Skia preview). Lazily required so the
    // Skia native module is only touched when the flag is on.
    if (USE_SKIA_SUMMARY && isFinished && finishTime !== null) {
      try {
        const { renderFinishSummaryPng } =
          require("../../lib/overlay/render-offscreen") as typeof import("../../lib/overlay/render-offscreen");
        summaryImageUri = await renderFinishSummaryPng(
          stopwatchConfig,
          splitTimes,
          finishTime,
          raceDistance,
          videoWidth,
          videoHeight,
        );
        setCapturedSummaryUri(summaryImageUri);
      } catch (e) {
        // Fall through to the view-shot capture below.
        console.warn("[export] Skia summary render failed; using view-shot", e);
      }
    }

    if (
      !summaryImageUri &&
      isFinished &&
      finishTime !== null &&
      summaryViewRef.current
    ) {
      try {
        const captureRef = getCaptureRef();
        if (captureRef) {
          summaryImageUri = await captureRef(summaryViewRef, {
            format: "png",
            quality: 1.0,
            width: videoWidth,
            height: videoHeight,
            // Must match the pre-capture options (see effect above): without
            // useRenderInContext the iOS default (drawViewHierarchyInRect)
            // bakes the wrapper's near-zero opacity into the bitmap, so the
            // summary overlay ends up invisible in the exported video.
            useRenderInContext: true,
          });
          setCapturedSummaryUri(summaryImageUri);
        }
      } catch (e) {
        // PNG capture failed — export without summary overlay, but surface it
        // so a blank summary in the output isn't silently mistaken for "works".
        console.warn("[export] summary PNG capture failed", e);
        summaryImageUri = null;
      }
    }

    // --- Pre-render the Skia timer PNG sequence (Phase 4, flag-gated) ---
    // Frames are rendered at native video resolution with the unscaled config;
    // the export filtergraph scales them to the output resolution.
    let timerSequence: TimerSequenceInput | null = null;
    let timerSequenceDir: string | null = null;
    if (USE_SKIA_TIMER_SEQUENCE && startTime !== null) {
      try {
        const summaryStartAbs =
          isFinished && finishTime !== null
            ? computeSummaryStartT(startTime, finishTime, duration)
            : null;
        const endAbs = summaryStartAbs ?? duration;
        // Render over VIDEO time [0, endAbs] so the timer shows 0:00 from the
        // very start of the clip (matching the preview), freezes at finishTime,
        // and hides when the summary appears. elapsed = max(0, t - startTime).
        if (endAbs > 0) {
          const sortedSplits = [...splitTimes].sort((a, b) => a.time - b.time);
          const elapsedFor = (videoSec: number) => {
            const e = Math.max(0, videoSec - startTime);
            return isFinished && finishTime !== null ? Math.min(e, finishTime) : e;
          };
          const activeSplitAt = (elapsed: number) => {
            const cap =
              isFinished && finishTime !== null ? Math.min(elapsed, finishTime) : elapsed;
            for (let i = sortedSplits.length - 1; i >= 0; i--) {
              const s = sortedSplits[i];
              if (isFinished && finishTime !== null && raceDistance !== null) {
                if (s.distance === raceDistance && s.time === finishTime) continue;
              }
              if (cap >= s.time && cap < s.time + SPLIT_DISPLAY_DURATION_SECONDS) return s;
            }
            return null;
          };
          const { renderTimerSequence } =
            require("../../lib/overlay/render-offscreen") as typeof import("../../lib/overlay/render-offscreen");
          const seq = await renderTimerSequence({
            config: stopwatchConfig,
            startSec: 0,
            endSec: endAbs,
            fps: SKIA_TIMER_SEQUENCE_FPS,
            width: videoWidth,
            height: videoHeight,
            elapsedFor,
            activeSplitAt,
            watermarkIcon: null, // watermark stays a separate FFmpeg overlay
          });
          timerSequenceDir = seq.dir;
          timerSequence = {
            pattern: seq.pattern,
            fps: seq.fps,
            startT: 0, // frame 0 = video time 0
            endT: endAbs,
            region: seq.region,
          };
        }
      } catch (e) {
        // Fall back to the drawtext timer path.
        console.warn("[export] Skia timer sequence render failed; using drawtext", e);
        timerSequence = null;
      }
    }

    // --- Render the watermark with Skia (pixel-identical to the preview) ---
    let watermarkImageUri: string | null = null;
    if (USE_SKIA_SUMMARY && showWatermark) {
      try {
        const { renderWatermarkPng } =
          require("../../lib/overlay/render-offscreen") as typeof import("../../lib/overlay/render-offscreen");
        watermarkImageUri = await renderWatermarkPng(videoWidth, videoHeight);
      } catch (e) {
        // Fall back to the FFmpeg drawtext watermark.
        console.warn("[export] Skia watermark render failed; using drawtext", e);
        watermarkImageUri = null;
      }
    }

    // --- Start encoding ---
    try {
      const durationMs = duration * 1000;
      const path = await exportVideoWithStopwatch(
        videoUri,
        startTime,
        stopwatchConfig,
        isFinished,
        finishTime,
        videoMetadata?.height ?? 1080,
        resolvedSettings,
        (timeMs) => {
          if (durationMs > 0) {
            setProgress(Math.min(timeMs / durationMs, 1));
          }
        },
        showWatermark,
        summaryImageUri,
        splitTimes,
        raceDistance,
        duration,
        timerSequence,
        watermarkImageUri,
      );
      setOutputPath(path);
      setProgress(1);

      if (effectivePlan === "guest") {
        markGuestUsedToday("timer");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("exportScreen.errorDuringExport"));
    } finally {
      setIsExporting(false);
      if (timerSequenceDir) {
        try {
          const { deleteTimerSequence } =
            require("../../lib/overlay/render-offscreen") as typeof import("../../lib/overlay/render-offscreen");
          deleteTimerSequence(timerSequenceDir);
        } catch {
          // ignore cleanup errors
        }
      }
    }
  }, [
    videoUri,
    startTime,
    stopwatchConfig,
    isFinished,
    finishTime,
    exportSettings,
    availableResolutions,
    setExportSettings,
    duration,
    videoMetadata?.height,
    showWatermark,
    effectivePlan,
    isPremium,
    videoWidth,
    videoHeight,
    splitTimes,
    raceDistance,
    capturedSummaryUri,
    t,
  ]);

  const handleSaveToLibrary = useCallback(async () => {
    if (!outputPath) return;
    try {
      await saveToPhotoLibrary(outputPath);
      Alert.alert(t("exportScreen.saveComplete"), t("exportScreen.savedToLibrary"));
    } catch (e) {
      Alert.alert(t("common.error"), e instanceof Error ? e.message : t("exportScreen.saveFailed"));
    }
  }, [outputPath, t]);

  const handleShare = useCallback(async () => {
    if (!outputPath) return;
    try {
      const Sharing = require("expo-sharing") as typeof SharingType;
      await Sharing.shareAsync(outputPath, {
        mimeType: "video/mp4",
        UTI: "public.mpeg-4",
      });
    } catch {
      // User cancelled share sheet
    }
  }, [outputPath]);

  const handleDone = useCallback(async () => {
    await cleanupExportFiles(outputPath, capturedSummaryUri);
    router.back();
  }, [router, outputPath, capturedSummaryUri]);

  const progressPercent = Math.round(progress * 100);

  // The hidden view-shot capture view is only needed for the legacy (non-Skia)
  // summary path; with USE_SKIA_SUMMARY the summary is rendered headlessly, so
  // skip mounting the large off-screen view (avoids needless re-renders).
  const showSummaryCapture = !USE_SKIA_SUMMARY && isFinished && finishTime !== null;

  // Measured size of the inner summary table — used to position the wrapper
  // with absolute pixels instead of a `transform: translate(-50%, -50%)`
  // (which on iOS/Android sometimes isn't picked up by view-shot, so the
  // capture would be empty/clipped → no summary in the exported video).
  const captureWrapperStyle = captureSummaryLayout
    ? getMeasuredWrapperStyle(
        stopwatchConfig.summaryPosition,
        stopwatchConfig.summaryAnchor,
        videoWidth,
        videoHeight,
        captureSummaryLayout,
      )
    : getStopwatchWrapperStyle(
        stopwatchConfig.summaryPosition,
        stopwatchConfig.summaryAnchor,
      );

  return (
    <View style={styles.container}>
      {/* Hidden summary view for PNG capture — rendered on-screen but at
          near-zero opacity. Off-screen (top:-100000) was unreliable on
          recent iOS/RN versions: view-shot would return an empty bitmap.
          collapsable={false} keeps Android's view manager from
          short-circuiting it. */}
      {showSummaryCapture && (
        <View
          ref={summaryViewRef}
          style={[
            styles.summaryCapture,
            { width: videoWidth, height: videoHeight },
          ]}
          pointerEvents="none"
          collapsable={false}
        >
          <View
            style={captureWrapperStyle}
            collapsable={false}
            onLayout={(e) => {
              const { width, height } = e.nativeEvent.layout;
              setCaptureSummaryLayout((prev) =>
                prev && prev.width === width && prev.height === height
                  ? prev
                  : { width, height },
              );
            }}
          >
            <FinishSummaryTable
              splitTimes={splitTimes}
              finishTime={finishTime!}
              config={{
                textColor: stopwatchConfig.textColor,
                backgroundColor: stopwatchConfig.backgroundColor,
                fontFamily: stopwatchConfig.fontFamily,
              }}
              // Reproduce the preview's visual proportions at native video resolution.
              // The preview clamps cells to a readable minimum (e.g. 28px) at the
              // device's screen width; to match, we scale that clamp threshold up by
              // (videoWidth / screenWidth). The 0.5 factor is the clamp transition
              // point (28/56), so the formula degrades gracefully on wider screens.
              scaleFactor={
                Math.max(0.5 * videoWidth / Dimensions.get("window").width, 1) *
                stopwatchConfig.summaryScale
              }
              raceDistance={raceDistance}
            />
          </View>
        </View>
      )}

      {/* Summary */}
      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>{t("exportScreen.settings")}</Text>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>{t("exportScreen.startTime")}</Text>
          <Text style={styles.summaryValue}>
            {startTime !== null ? formatTime(startTime) : t("exportScreen.notSet")}
          </Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>{t("exportScreen.splitsLabel")}</Text>
          <Text style={styles.summaryValue}>{t("splits.count", { count: splitTimes.length })}</Text>
        </View>
      </View>

      {/* Resolution */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{t("exportScreen.resolution")}</Text>
        <View style={styles.resolutionRow}>
          {ALL_RESOLUTIONS.map((r) => {
            const active = exportSettings.resolution === r.key;
            const isLocked = !availableResolutions.includes(r.key);
            return (
              <Pressable
                key={r.key}
                style={[
                  styles.resBtn,
                  active && styles.resBtnActive,
                  isLocked && styles.resBtnLocked,
                ]}
                onPress={() => {
                  if (isLocked) {
                    router.push("/(app)/paywall");
                  } else {
                    setExportSettings({ resolution: r.key });
                  }
                }}
              >
                <Text
                  style={[
                    styles.resBtnText,
                    active && styles.resBtnTextActive,
                    isLocked && styles.resBtnTextLocked,
                  ]}
                >
                  {r.label}
                </Text>
                {isLocked && <Text style={styles.premiumBadge}>{t("auth.premiumOnly")}</Text>}
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Tier indicator (guest remaining / free upsell / premium: nothing) */}
      {!exportComplete && (
        <GuestExportIndicator
          plan={effectivePlan}
          remaining={remainingExports}
          onActionPress={() => router.push("/(auth)/get-started")}
        />
      )}

      {/* Progress / waiting for ad / done / export button */}
      {isExporting || (exportComplete && !canProceed) ? (
        <View style={styles.progressSection}>
          <Text style={styles.progressText}>
            {t("exportScreen.encodingPercent", { percent: progressPercent })}
          </Text>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
          </View>
          {exportComplete && !adRewardEarned && !adUnavailable && (
            <Text style={styles.adWaitText}>{t("exportScreen.adWatchPrompt")}</Text>
          )}
        </View>
      ) : canProceed ? (
        <View style={styles.doneSection}>
          <Text style={styles.doneText}>{t("exportScreen.complete")}</Text>
          <View style={styles.actionRow}>
            <Pressable style={styles.saveBtn} onPress={handleSaveToLibrary}>
              <Text style={styles.saveBtnText}>{t("exportScreen.saveToLibrary")}</Text>
            </Pressable>
            <Pressable style={styles.shareBtn} onPress={handleShare}>
              <Text style={styles.shareBtnText}>{t("exportScreen.share")}</Text>
            </Pressable>
          </View>
          <Pressable style={styles.doneBtn} onPress={handleDone}>
            <Text style={styles.doneBtnText}>{t("common.done")}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.exportSection}>
          {error && (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
          <Pressable
            style={({ pressed }) => [
              styles.exportBtn,
              pressed && styles.exportBtnPressed,
              (!startTime || limitReached) && styles.exportBtnDisabled,
            ]}
            onPress={handleExport}
            disabled={!startTime || limitReached}
          >
            <Text style={styles.exportBtnText}>{t("exportScreen.startExport")}</Text>
          </Pressable>
          {adState === "loading" && (
            <Text style={styles.adStatusText}>{t("exportScreen.adLoading")}</Text>
          )}
          {adState === "error" && (
            <Text style={styles.adStatusText}>{t("exportScreen.adFailed")}</Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
    gap: spacing.xl,
  },
  // Hidden view for summary PNG capture, sized to videoWidth × videoHeight so
  // captureRef produces a 1:1 PNG with the output frame. We render at
  // (0, 0) with near-zero opacity — *not* opacity:0, which view-shot
  // sometimes reads as a fully-transparent bitmap; and *not* far-off-screen
  // (top:-100000), which view-shot has stopped capturing reliably on recent
  // RN/iOS combinations.
  summaryCapture: {
    position: "absolute",
    top: 0,
    left: 0,
    opacity: 0.01,
  },
  summaryCard: {
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
  summaryTitle: {
    fontSize: fontSize.md,
    fontWeight: "600",
    color: colors.text,
    marginBottom: spacing.xs,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  summaryLabel: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },
  summaryValue: {
    fontSize: fontSize.sm,
    color: colors.text,
    fontWeight: "500",
    maxWidth: "60%",
  },
  section: {
    gap: spacing.sm,
  },
  sectionLabel: {
    fontSize: fontSize.xs,
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  resolutionRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  resBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  resBtnActive: {
    backgroundColor: colors.primaryMuted,
    borderColor: colors.primaryBorder,
  },
  resBtnLocked: {
    opacity: 0.5,
  },
  resBtnText: {
    fontSize: fontSize.sm,
    color: colors.muted,
    fontWeight: "500",
  },
  resBtnTextActive: {
    color: colors.primary,
  },
  resBtnTextLocked: {
    color: colors.muted,
  },
  premiumBadge: {
    fontSize: 9,
    color: "#92400E",
    backgroundColor: "#FEF3C7",
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    marginTop: 2,
    overflow: "hidden",
  },
  progressSection: {
    gap: spacing.md,
    alignItems: "center",
  },
  progressText: {
    fontSize: fontSize.md,
    color: colors.text,
    fontWeight: "600",
  },
  progressBar: {
    width: "100%",
    height: 6,
    backgroundColor: colors.surfaceRaised,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.primary,
    borderRadius: 3,
  },
  doneSection: {
    gap: spacing.lg,
    alignItems: "center",
  },
  doneText: {
    fontSize: fontSize.lg,
    fontWeight: "700",
    color: colors.success,
  },
  actionRow: {
    flexDirection: "row",
    gap: spacing.md,
    width: "100%",
  },
  saveBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: "center",
  },
  saveBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.white,
  },
  shareBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  shareBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.text,
  },
  doneBtn: {
    paddingVertical: spacing.md,
  },
  doneBtnText: {
    fontSize: fontSize.sm,
    color: colors.muted,
    fontWeight: "500",
  },
  exportSection: {
    gap: spacing.md,
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
  exportBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: "center",
  },
  exportBtnPressed: {
    opacity: 0.85,
  },
  exportBtnDisabled: {
    opacity: 0.5,
  },
  exportBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.white,
  },
  adWaitText: {
    fontSize: fontSize.xs,
    color: colors.muted,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  adStatusText: {
    fontSize: fontSize.xs,
    color: colors.muted,
    textAlign: "center",
  },
});
