"use client";

import { useEffect, useRef, useCallback } from "react";
import { useEditorStore } from "@/stores/editor-store";
import { renderStopwatch, renderSplitDisplay, renderWatermark, renderFinishSummary } from "@/lib/stopwatch/renderer";
import { SPLIT_DISPLAY_DURATION_SECONDS, SUMMARY_DELAY_SECONDS } from "@swimhub-timer/shared";

export function useCanvasCompositor(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  videoRef: React.RefObject<HTMLVideoElement | null>,
) {
  const animationRef = useRef<number>(0);
  const { stopwatchConfig, startTime, splitTimes, isFinished, finishTime, raceDistance } = useEditorStore();

  const renderRef = useRef<() => void>(() => {});

  const render = useCallback(() => {
    renderRef.current();
  }, []);

  useEffect(() => {
    renderRef.current = () => {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Match canvas size to video dimensions
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 360;
      }

      // Clear canvas (video is rendered natively by <video> element underneath)
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Compute elapsed from video position, but cap at finishTime if finished
      const rawElapsed = startTime !== null ? Math.max(0, video.currentTime - startTime) : 0;
      let elapsed = rawElapsed;
      if (isFinished && finishTime !== null && elapsed > finishTime) {
        elapsed = finishTime;
      }

      // Show the summary SUMMARY_DELAY_SECONDS after the finish (the timer stays
      // frozen at finishTime during the gap) — matches the export + mobile.
      const summaryVisible =
        isFinished && finishTime !== null && rawElapsed >= finishTime + SUMMARY_DELAY_SECONDS;

      if (summaryVisible && finishTime !== null) {
        const contentRect = { x: 0, y: 0, width: canvas.width, height: canvas.height };
        renderFinishSummary(ctx, stopwatchConfig, splitTimes, finishTime, raceDistance, contentRect);
      } else {
        renderStopwatch(ctx, stopwatchConfig, elapsed);

        // Show split for SPLIT_DISPLAY_DURATION_SECONDS after passing its time point
        if (splitTimes.length > 0) {
          let activeSplit = null;
          for (let i = splitTimes.length - 1; i >= 0; i--) {
            const s = splitTimes[i];
            if (elapsed >= s.time && elapsed < s.time + SPLIT_DISPLAY_DURATION_SECONDS) {
              activeSplit = s;
              break;
            }
          }
          if (activeSplit) {
            renderSplitDisplay(ctx, stopwatchConfig, elapsed, activeSplit);
          }
        }
      }

      renderWatermark(ctx);

      animationRef.current = requestAnimationFrame(render);
    };
  }, [canvasRef, videoRef, stopwatchConfig, startTime, splitTimes, isFinished, finishTime, raceDistance, render]);

  const start = useCallback(() => {
    animationRef.current = requestAnimationFrame(render);
  }, [render]);

  const stop = useCallback(() => {
    cancelAnimationFrame(animationRef.current);
  }, []);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animationRef.current);
    };
  }, []);

  return { start, stop, render };
}
