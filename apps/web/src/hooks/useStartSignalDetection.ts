"use client";

import { useCallback } from "react";
import { useEditorStore } from "@/stores/editor-store";
import { detectStartSignalAsync } from "@/lib/audio/signal-detector";

export function useStartSignalDetection() {
  const setDetectedSignalTime = useEditorStore((s) => s.setDetectedSignalTime);
  const setIsDetecting = useEditorStore((s) => s.setIsDetecting);
  const isDetecting = useEditorStore((s) => s.isDetecting);

  const detect = useCallback(async () => {
    // Read the buffer fresh so a detect() triggered right after analyze()
    // (which just populated the store) doesn't run against a stale null.
    const audioBuffer = useEditorStore.getState().audioBuffer;
    if (!audioBuffer) return null;

    setIsDetecting(true);

    try {
      // Chunked detector yields to the event loop between frames so the UI
      // stays responsive instead of freezing for the whole STFT pass.
      const result = await detectStartSignalAsync(audioBuffer);
      setDetectedSignalTime(result ? result.time : null);
      return result;
    } finally {
      setIsDetecting(false);
    }
  }, [setDetectedSignalTime, setIsDetecting]);

  return { detect, isDetecting };
}
