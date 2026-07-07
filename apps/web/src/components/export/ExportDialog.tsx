"use client";

import { useState, useMemo, useEffect } from "react";
import { useEditorStore } from "@/stores/editor-store";
import { useVideoExport } from "@/hooks/useVideoExport";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Download, Loader2, Check, ArrowLeft, Timer, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import type { ExportResolution } from "@swimhub-timer/shared";
import { getAvailableResolutions, shouldShowWatermark } from "@swimhub-timer/shared";
import { getGuestTodayCount } from "@/lib/guest-daily-limit";

export function ExportDialog() {
  const { t } = useTranslation();
  const { plan } = useAuth();
  const { exportSettings, setExportSettings, setStep } = useEditorStore();
  const availableResolutions = getAvailableResolutions(plan);
  const showWatermark = shouldShowWatermark(plan);
  const {
    startExport: startEncoding,
    downloadOutput,
    isExporting,
    exportProgress,
    error,
    outputBlob,
    limitReached,
  } = useVideoExport(showWatermark);

  // Plan-gating guard: exportSettings.resolution can hold a paywalled default (the store
  // defaults to "1080") that no free/guest user ever actively chose. Normalize it to an
  // allowed value as soon as the plan is known so the UI never shows a paywalled default as
  // the selected quality (existing onValueChange validation above still guards manual picks).
  useEffect(() => {
    if (!availableResolutions.includes(exportSettings.resolution)) {
      setExportSettings({ resolution: availableResolutions[availableResolutions.length - 1] });
    }
  }, [availableResolutions, exportSettings.resolution, setExportSettings]);

  const [exportTriggered, setExportTriggered] = useState(false);
  const remainingExports = useMemo(() => {
    if (plan === "premium" || plan === "free") return null;
    if (plan === "guest") {
      const used = getGuestTodayCount("timer");
      return Math.max(0, 1 - used);
    }
    return null;
  }, [plan]);

  const exportComplete = outputBlob !== null;

  const handleExport = () => {
    setExportTriggered(true);
    startEncoding();
  };

  return (
    <div className="flex flex-col gap-8 max-w-md mx-auto w-full">
      {/* Header */}
      <div className="flex flex-col items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-surface-raised border border-border flex items-center justify-center">
          <Timer className="w-7 h-7 text-primary" />
        </div>
        <div className="text-center space-y-1">
          <h2 className="text-xl font-bold tracking-tight">{t("exportScreen.webTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("exportScreen.subtitle")}</p>
        </div>
      </div>

      {/* Card */}
      <div className="bg-surface rounded-2xl border border-border p-6 space-y-6">
        {/* Quality selection */}
        <div className="space-y-2">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {t("exportScreen.quality")}
          </Label>
          <Select
            value={exportSettings.resolution}
            onValueChange={(v) => {
              if (availableResolutions.includes(v as ExportResolution)) {
                setExportSettings({ resolution: v as ExportResolution });
              }
            }}
          >
            <SelectTrigger className="bg-surface-raised border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="720">720p</SelectItem>
              <SelectItem value="1080" disabled={!availableResolutions.includes("1080")}>
                1080p {t("exportScreen.recommended")}
              </SelectItem>
              <SelectItem value="original" disabled={!availableResolutions.includes("original")}>
                {t("exportScreen.original")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Remaining exports status */}
        {plan !== "premium" && remainingExports !== null && !exportComplete && (
          <p className="text-xs text-muted-foreground text-center">
            {t("exportScreen.remainingCount", {
              remaining: remainingExports,
            })}
          </p>
        )}

        {/* Limit reached message */}
        {limitReached && (
          <div className="p-3.5 bg-amber-500/5 border border-amber-500/20 rounded-xl flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <p className="text-sm text-amber-400">
              {plan === "guest"
                ? t("exportScreen.dailyLimitGuest")
                : t("exportScreen.dailyLimitFree")}
            </p>
          </div>
        )}

        {/* Export button / progress / done */}
        {!isExporting && !outputBlob && !exportTriggered && !limitReached && (
          <Button
            onClick={handleExport}
            size="lg"
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90 glow-cyan h-11"
          >
            <Download className="w-4 h-4 mr-2" />
            {t("exportScreen.exportMp4")}
          </Button>
        )}

        {(isExporting || (exportTriggered && !exportComplete && !limitReached)) && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span>{t("exportScreen.encoding")}</span>
              </div>
              <span className="font-mono text-primary tabular-nums">{exportProgress}%</span>
            </div>
            <div className="w-full bg-surface-raised rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-primary h-full rounded-full transition-all duration-300"
                style={{ width: `${exportProgress}%` }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground text-center">
              {t("exportScreen.timeEstimate")}
            </p>
          </div>
        )}

        {exportComplete && (
          <div className="space-y-4">
            <div className="flex items-center justify-center gap-2 py-3">
              <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <Check className="w-4 h-4 text-emerald-400" />
              </div>
              <span className="font-medium text-emerald-400">{t("exportScreen.complete")}</span>
            </div>
            <Button
              onClick={downloadOutput}
              size="lg"
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90 glow-cyan h-11"
            >
              <Download className="w-4 h-4 mr-2" />
              {t("exportScreen.downloadMp4", {
                size: (outputBlob!.size / 1024 / 1024).toFixed(1),
              })}
            </Button>
          </div>
        )}

        {error && (
          <div className="p-3.5 bg-destructive/5 border border-destructive/20 rounded-xl">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={handleExport} className="mt-3 text-xs">
              {t("common.retry")}
            </Button>
          </div>
        )}
      </div>

      {/* Back button */}
      <button
        onClick={() => setStep("detect")}
        className="flex items-center justify-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        {t("exportScreen.backToEditor")}
      </button>
    </div>
  );
}
