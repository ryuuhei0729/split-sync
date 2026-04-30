"use client";

import { useCallback, useState } from "react";
import { useEditorStore } from "@/stores/editor-store";
import { exportVideoWithStopwatch } from "@/lib/video/export-pipeline";
import { renderFinishSummary } from "@/lib/stopwatch/renderer";
import { useAuth } from "@/hooks/useAuth";
import { canGuestUseToday, markGuestUsedToday } from "@/lib/guest-daily-limit";

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

      const blob = await exportVideoWithStopwatch(
        videoFile,
        startTime,
        stopwatchConfig,
        videoMetadata?.height ?? 0,
        exportSettings,
        (percent) => setExportProgress(percent),
        showWatermark,
        summaryBlob,
        finishTime,
      );
      setOutputBlob(blob);
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
