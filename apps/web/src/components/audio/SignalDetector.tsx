"use client";

import { useEffect } from "react";
import { useEditorStore } from "@/stores/editor-store";
import { useAudioAnalysis } from "@/hooks/useAudioAnalysis";
import { useStartSignalDetection } from "@/hooks/useStartSignalDetection";
import { Button } from "@/components/ui/button";
import { WaveformDisplay } from "./WaveformDisplay";
import { Loader2, Zap, Minus, Plus, MousePointerClick, Check } from "lucide-react";
import { useTranslation } from "react-i18next";

export function SignalDetector() {
  const { t } = useTranslation();
  const {
    detectedSignalTime,
    startTime,
    audioBuffer,
    waveformData,
    setDetectedSignalTime,
    setStartTime,
  } = useEditorStore();

  const { analyze, isAnalyzing, error: analysisError, attempted } = useAudioAnalysis();
  const { detect, isDetecting } = useStartSignalDetection();

  useEffect(() => {
    // Auto-analyze once per video. Gate on `attempted`/`analysisError` too so a
    // decode failure (e.g. a silent/unsupported track) does not re-fire the
    // effect forever, re-reading the whole video file each time.
    if (!audioBuffer && !isAnalyzing && !attempted && !analysisError) {
      analyze();
    }
  }, [audioBuffer, isAnalyzing, attempted, analysisError, analyze]);

  const handleAutoDetect = async () => {
    if (!audioBuffer) {
      await analyze();
    }
    await detect();
  };

  const adjustTime = (delta: number) => {
    if (detectedSignalTime === null) return;
    setDetectedSignalTime(Math.max(0, detectedSignalTime + delta));
  };

  const handleConfirm = () => {
    if (detectedSignalTime === null) return;
    setStartTime(detectedSignalTime);
  };

  const isLoading = isAnalyzing || isDetecting;
  const isConfirmed = startTime !== null && startTime === detectedSignalTime;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <Zap className="w-4 h-4 text-primary" />
        <h3 className="font-semibold text-sm tracking-tight">{t("signal.title")}</h3>
      </div>

      {/* Waveform — manual click area */}
      {waveformData && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <MousePointerClick className="w-3 h-3" />
              <span className="text-[11px]">{t("signal.clickWaveform")}</span>
            </div>
          </div>
          <WaveformDisplay height={72} onClickTime={(time) => setDetectedSignalTime(time)} />
        </div>
      )}

      {/* Auto-detect */}
      <div className="space-y-3">
        <Button
          onClick={handleAutoDetect}
          disabled={isLoading}
          variant="outline"
          className="w-full h-9 text-xs font-medium"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
              {isAnalyzing ? t("signal.analyzing") : t("signal.detecting")}
            </>
          ) : (
            <>
              <Zap className="w-3.5 h-3.5 mr-2" />
              {t("signal.autoDetect")}
            </>
          )}
        </Button>

        {analysisError && <p className="text-xs text-destructive">{analysisError}</p>}
      </div>

      {/* Detected time + fine-tune + confirm */}
      {detectedSignalTime !== null && (
        <div className="space-y-3 p-3.5 bg-surface-raised rounded-xl border border-border">
          <div className="flex items-center justify-end">
            <span className="text-sm font-mono font-bold text-primary tabular-nums">
              {detectedSignalTime.toFixed(3)}s
            </span>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            <button
              onClick={() => adjustTime(-0.1)}
              className="flex items-center justify-center gap-0.5 text-[10px] font-medium py-1.5 rounded-lg bg-surface border border-border text-muted-foreground hover:text-foreground hover:border-primary/20 transition-colors"
            >
              <Minus className="w-2.5 h-2.5" />
              100ms
            </button>
            <button
              onClick={() => adjustTime(-0.01)}
              className="flex items-center justify-center gap-0.5 text-[10px] font-medium py-1.5 rounded-lg bg-surface border border-border text-muted-foreground hover:text-foreground hover:border-primary/20 transition-colors"
            >
              <Minus className="w-2.5 h-2.5" />
              10ms
            </button>
            <button
              onClick={() => adjustTime(0.01)}
              className="flex items-center justify-center gap-0.5 text-[10px] font-medium py-1.5 rounded-lg bg-surface border border-border text-muted-foreground hover:text-foreground hover:border-primary/20 transition-colors"
            >
              <Plus className="w-2.5 h-2.5" />
              10ms
            </button>
            <button
              onClick={() => adjustTime(0.1)}
              className="flex items-center justify-center gap-0.5 text-[10px] font-medium py-1.5 rounded-lg bg-surface border border-border text-muted-foreground hover:text-foreground hover:border-primary/20 transition-colors"
            >
              <Plus className="w-2.5 h-2.5" />
              100ms
            </button>
          </div>

          {/* Confirm button */}
          <Button
            onClick={handleConfirm}
            disabled={isConfirmed}
            className="w-full h-9 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 glow-cyan-sm"
          >
            {isConfirmed ? (
              <>
                <Check className="w-3.5 h-3.5 mr-2" />
                {t("signal.confirmed")}
              </>
            ) : (
              <>
                <Check className="w-3.5 h-3.5 mr-2" />
                {t("signal.setAsStartPoint")}
              </>
            )}
          </Button>
        </div>
      )}

      {/* Show confirmed start time if different from candidate */}
      {startTime !== null && detectedSignalTime !== startTime && (
        <div className="flex items-center justify-between p-3 bg-primary/5 rounded-lg border border-primary/20">
          <span className="text-[11px] uppercase tracking-wider text-primary/70">
            {t("signal.startConfirmed")}
          </span>
          <span className="text-sm font-mono font-bold text-primary tabular-nums">
            {startTime.toFixed(3)}s
          </span>
        </div>
      )}
    </div>
  );
}
