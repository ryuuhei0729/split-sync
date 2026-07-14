"use client";

import { useCallback } from "react";
import { useEditorStore } from "@/stores/editor-store";
import { analyzeAudio } from "@/lib/audio/analyzer";

export function useAudioAnalysis() {
  const isAnalyzing = useEditorStore((s) => s.isAnalyzingAudio);
  const error = useEditorStore((s) => s.audioAnalysisError);
  const attempted = useEditorStore((s) => s.audioAnalysisAttempted);

  const analyze = useCallback(async () => {
    // Read fresh state at call time (not from a render closure): two mounted
    // SignalDetector instances fire their effects in the same commit, so the
    // in-flight guard must see the first call's synchronous `set` before the
    // second call proceeds — otherwise the file is decoded twice.
    const store = useEditorStore.getState();
    const { videoFile, isAnalyzingAudio, audioBuffer } = store;
    if (!videoFile || isAnalyzingAudio || audioBuffer) return;

    store.setIsAnalyzingAudio(true);
    store.setAudioAnalysisError(null);

    try {
      const result = await analyzeAudio(videoFile);
      useEditorStore.getState().setAudioBuffer(result.audioBuffer);
      useEditorStore.getState().setWaveformData(result.waveformData);
    } catch (err) {
      useEditorStore
        .getState()
        .setAudioAnalysisError(err instanceof Error ? err.message : "Audio analysis failed");
    } finally {
      const s = useEditorStore.getState();
      s.setIsAnalyzingAudio(false);
      // Mark attempted so the auto-analyze effect does not re-fire on failure
      // (audioBuffer stays null on error → the effect would otherwise loop).
      s.setAudioAnalysisAttempted(true);
    }
  }, []);

  return { analyze, isAnalyzing, error, attempted };
}
