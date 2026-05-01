"use client";

import { useEditorStore } from "@/stores/editor-store";
import {
  STOPWATCH_PRESETS,
  STOPWATCH_FONT_SIZE_MAX,
  STOPWATCH_FONT_SIZE_MIN,
} from "@swimhub-timer/shared";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Palette } from "lucide-react";
import { useTranslation } from "react-i18next";

export function StopwatchDesigner() {
  const { t } = useTranslation();
  const { stopwatchConfig, updateStopwatchConfig, setStopwatchConfig } = useEditorStore();

  const isActivePreset = (presetId: string) => {
    const preset = STOPWATCH_PRESETS.find((p) => p.id === presetId);
    if (!preset) return false;
    return (
      stopwatchConfig.fontFamily === preset.config.fontFamily &&
      stopwatchConfig.textColor === preset.config.textColor &&
      stopwatchConfig.backgroundColor === preset.config.backgroundColor
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <Palette className="w-4 h-4 text-primary" />
        <h3 className="font-semibold text-sm tracking-tight">{t("design.title")}</h3>
      </div>

      {/* Presets */}
      <div className="grid grid-cols-2 gap-2">
        {STOPWATCH_PRESETS.map((preset) => (
          <button
            key={preset.id}
            onClick={() => setStopwatchConfig(preset.config)}
            className={`
              flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all
              ${
                isActivePreset(preset.id)
                  ? "border-primary/30 bg-primary/5"
                  : "border-border bg-surface hover:border-primary/15 hover:bg-surface-raised"
              }
            `}
          >
            <div
              className="px-2 py-1 rounded text-sm font-bold font-mono"
              style={{
                color: preset.config.textColor,
                backgroundColor: preset.config.backgroundColor,
                borderRadius: preset.config.borderRadius,
              }}
            >
              0:00.00
            </div>
            <span
              className={`text-[10px] font-medium ${isActivePreset(preset.id) ? "text-primary" : "text-muted-foreground"}`}
            >
              {t(`design.preset.${preset.id}`)}
            </span>
          </button>
        ))}
      </div>

      {/* Size */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {t("design.size")}
          </Label>
          <span className="text-xs font-mono text-primary">{stopwatchConfig.fontSize}px</span>
        </div>
        <Slider
          min={STOPWATCH_FONT_SIZE_MIN}
          max={STOPWATCH_FONT_SIZE_MAX}
          step={2}
          value={[stopwatchConfig.fontSize]}
          onValueChange={([v]) => updateStopwatchConfig({ fontSize: v })}
        />
      </div>
    </div>
  );
}
