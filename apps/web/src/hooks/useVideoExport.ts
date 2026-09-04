"use client";

import { useCallback, useState } from "react";
import { useEditorStore } from "@/stores/editor-store";
import { dispatchVideoExport } from "@/lib/video/export-dispatcher";
import { renderFinishSummary } from "@/lib/stopwatch/renderer";
import { useAuth } from "@/hooks/useAuth";
import { canGuestUseToday, markGuestUsedToday } from "@/lib/guest-daily-limit";
import { getAvailableResolutions } from "@swimhub-timer/shared";

export function useVideoExport(showWatermark = true) {
  const {
    videoFile,
    startTime,
    stopwatchConfig,
    exportSettings,
    videoMetadata,
    isFinished,
    finishTime,
    splitTimes,
    raceDistance,
    setExportProgress,
    setIsExporting,
    isExporting,
    exportProgress,
  } = useEditorStore();
  const { plan } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [outputBlob, setOutputBlob] = useState<Blob | null>(null);
  const [limitReached, setLimitReached] = useState(false);

  const checkExportAllowed = useCallback(async (): Promise<boolean> => {
    if (plan === "premium" || plan === "free") return true;

    if (plan === "guest") {
      return canGuestUseToday("timer");
    }

    return true;
  }, [plan]);

  const recordExportUsage = useCallback(async () => {
    if (plan === "premium" || plan === "free") return;

    if (plan === "guest") {
      markGuestUsedToday("timer");
      return;
    }
  }, [plan]);

  const startExport = useCallback(async () => {
    if (!videoFile || startTime === null) return;

    setLimitReached(false);
    setError(null);

    const allowed = await checkExportAllowed();
    if (!allowed) {
      setLimitReached(true);
      return;
    }

    setIsExporting(true);
    setExportProgress(0);
    setOutputBlob(null);

    // Plan-gating guard: the store's exportSettings.resolution can be a paywalled value
    // (e.g. it defaults to "1080") that was never explicitly chosen by a free/guest user.
    // Clamp to the highest resolution the plan actually allows right before dispatching so
    // a stale/default selection can never bypass the plan gate.
    const allowedResolutions = getAvailableResolutions(plan);
    const lastAllowedResolution = allowedResolutions[allowedResolutions.length - 1];
    const clampedResolution = allowedResolutions.includes(exportSettings.resolution)
      ? exportSettings.resolution
      : lastAllowedResolution;
    if (!clampedResolution) {
      // getAvailableResolutions() always returns a non-empty array for every plan today,
      // so this is structurally unreachable; guard defensively rather than let an empty
      // allow-list silently fall through to the unclamped (possibly paywalled) resolution.
      setError("エクスポート設定の取得に失敗しました");
      setIsExporting(false);
      return;
    }
    const clampedExportSettings = { ...exportSettings, resolution: clampedResolution };

    try {
      // Render finish summary PNG if applicable
      let summaryBlob: Blob | null = null;
      if (isFinished && finishTime !== null) {
        const width = videoMetadata?.width ?? 1920;
        const height = videoMetadata?.height ?? 1080;
        const offscreen = document.createElement("canvas");
        offscreen.width = width;
        offscreen.height = height;
        const ctx = offscreen.getContext("2d");
        if (ctx) {
          const contentRect = { x: 0, y: 0, width, height };
          renderFinishSummary(ctx, stopwatchConfig, splitTimes, finishTime, raceDistance, contentRect);
          summaryBlob = await new Promise<Blob | null>((resolve) =>
            offscreen.toBlob(resolve, "image/png"),
          );
          offscreen.width = 0;
          offscreen.height = 0;
        }
      }

      const result = await dispatchVideoExport({
        videoFile,
        startSignalTime: startTime,
        stopwatchConfig,
        originalVideoWidth: videoMetadata?.width ?? 0,
        originalVideoHeight: videoMetadata?.height ?? 0,
        exportSettings: clampedExportSettings,
        onProgress: (percent: number) => setExportProgress(percent),
        showWatermark,
        splitTimes,
        isFinished,
        finishTime,
        raceDistance,
        summaryImageData: summaryBlob,
      });
      // Lightweight rollout signal (not user-facing, doesn't change the hook's public
      // return shape): lets us see the WebCodecs-vs-ffmpeg-fallback split in real usage
      // without wiring up full analytics yet.
      console.info(`[useVideoExport] export completed via '${result.engine}' engine.`);
      setOutputBlob(result.blob);
      await recordExportUsage();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setIsExporting(false);
    }
  }, [
    videoFile,
    startTime,
    stopwatchConfig,
    videoMetadata,
    exportSettings,
    plan,
    isFinished,
    finishTime,
    splitTimes,
    raceDistance,
    setExportProgress,
    setIsExporting,
    showWatermark,
    checkExportAllowed,
    recordExportUsage,
  ]);

  const downloadOutput = useCallback(() => {
    if (!outputBlob) return;
    const url = URL.createObjectURL(outputBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `swimhub-timer-${Date.now()}.mp4`;
    a.click();
    URL.revokeObjectURL(url);
  }, [outputBlob]);

  return {
    startExport,
    downloadOutput,
    isExporting,
    exportProgress,
    error,
    outputBlob,
    limitReached,
  };
}
