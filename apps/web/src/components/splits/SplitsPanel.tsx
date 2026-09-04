"use client";

import { useEditorStore } from "@/stores/editor-store";
import { useAuth } from "@/hooks/useAuth";
import { formatTime, getMaxSplitCount, COMMON_RACE_DISTANCES } from "@swimhub-timer/shared";
import { useTranslation } from "react-i18next";
import {
  ListOrdered,
  Trash2,
  RotateCcw,
  Trophy,
  CircleDot,
  Flag,
  Minus,
  Plus,
  Lock,
  Pencil,
} from "lucide-react";

export function SplitsPanel() {
  const { t } = useTranslation();
  const { plan } = useAuth();
  const maxSplits = getMaxSplitCount(plan);
  const {
    splitTimes,
    isFinished,
    finishTime,
    finishMemo,
    startTime,
    currentVideoTime,
    currentDistanceInput,
    currentMemoInput,
    raceDistance,
    setCurrentDistanceInput,
    setCurrentMemoInput,
    setRaceDistance,
    recordSplit,
    finishRecording,
    removeSplit,
    revertFinish,
    resetSplits,
    seekVideo,
  } = useEditorStore();

  const elapsed = startTime !== null ? Math.max(0, currentVideoTime - startTime) : 0;
  const splitLimitReached = splitTimes.length >= maxSplits;
  const canFinish = raceDistance !== null && raceDistance > 0;

  // Per-row lap = current split time − previous split time (by distance order),
  // derived at display time so it stays correct after out-of-order recording or
  // a removeSplit. Shown for every row (matches the mobile SplitsPanel).
  const sortedByDistance = [...splitTimes].sort((a, b) => a.distance - b.distance);
  const lapByDistance = new Map<number, number>();
  for (let i = 0; i < sortedByDistance.length; i++) {
    const curr = sortedByDistance[i];
    if (!curr) continue; // i stays within [0, sortedByDistance.length); guard is defensive only
    const prevSplit = sortedByDistance[i - 1];
    const prevTime = i === 0 || !prevSplit ? 0 : prevSplit.time;
    lapByDistance.set(curr.distance, curr.time - prevTime);
  }

  const handleRecord = () => {
    if (splitLimitReached) return;
    recordSplit(elapsed);
  };

  const handleFinish = () => {
    if (!canFinish) return;
    finishRecording(elapsed, currentMemoInput);
  };

  // Seek video by delta (adjusts the video position)
  const adjustVideo = (delta: number) => {
    const newTime = Math.max(0, currentVideoTime + delta);
    seekVideo(newTime);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ListOrdered className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold">{t("splits.title")}</h3>
          {splitTimes.length > 0 && (
            <span className="text-[10px] font-medium text-muted-foreground bg-surface-raised px-1.5 py-0.5 rounded-md">
              {splitTimes.length}
            </span>
          )}
        </div>
        {splitTimes.length > 0 && (
          <button
            onClick={resetSplits}
            className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            {t("common.reset")}
          </button>
        )}
      </div>

      {/* Race distance chips */}
      {startTime !== null && !isFinished && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
            {t("splits.raceDistanceLabel")}
          </p>
          <div className="overflow-x-auto flex gap-2 pb-2">
            {COMMON_RACE_DISTANCES.map((d) => {
              const active = raceDistance === d;
              return (
                <button
                  key={d}
                  onClick={() => setRaceDistance(d === raceDistance ? null : d)}
                  className={`shrink-0 px-3 py-1 text-xs font-semibold font-mono rounded-lg border transition-colors ${
                    active
                      ? "bg-primary/10 border-primary/20 text-primary"
                      : "bg-surface-raised border-border text-muted-foreground hover:text-foreground hover:border-primary/20"
                  }`}
                >
                  {d}m
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Recording controls */}
      {startTime !== null && !isFinished && (
        <div className="space-y-3 p-3.5 bg-surface-raised rounded-xl border border-border">
          {/* Current elapsed time */}
          <div className="flex items-center justify-end">
            <span className="text-sm font-mono font-bold text-primary tabular-nums">
              {formatTime(elapsed)}
            </span>
          </div>

          {/* Fine-tune video position */}
          <div className="grid grid-cols-4 gap-1.5">
            <button
              onClick={() => adjustVideo(-0.1)}
              className="flex items-center justify-center gap-0.5 text-[10px] font-medium py-1.5 rounded-lg bg-surface border border-border text-muted-foreground hover:text-foreground hover:border-primary/20 transition-colors"
            >
              <Minus className="w-2.5 h-2.5" />
              100ms
            </button>
            <button
              onClick={() => adjustVideo(-0.01)}
              className="flex items-center justify-center gap-0.5 text-[10px] font-medium py-1.5 rounded-lg bg-surface border border-border text-muted-foreground hover:text-foreground hover:border-primary/20 transition-colors"
            >
              <Minus className="w-2.5 h-2.5" />
              10ms
            </button>
            <button
              onClick={() => adjustVideo(0.01)}
              className="flex items-center justify-center gap-0.5 text-[10px] font-medium py-1.5 rounded-lg bg-surface border border-border text-muted-foreground hover:text-foreground hover:border-primary/20 transition-colors"
            >
              <Plus className="w-2.5 h-2.5" />
              10ms
            </button>
            <button
              onClick={() => adjustVideo(0.1)}
              className="flex items-center justify-center gap-0.5 text-[10px] font-medium py-1.5 rounded-lg bg-surface border border-border text-muted-foreground hover:text-foreground hover:border-primary/20 transition-colors"
            >
              <Plus className="w-2.5 h-2.5" />
              100ms
            </button>
          </div>

          {/* Distance input + Record */}
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="any"
              min="0"
              placeholder={t("splits.distancePlaceholder")}
              value={currentDistanceInput}
              onChange={(e) => setCurrentDistanceInput(e.target.value)}
              className="flex-1 h-8 px-3 text-xs bg-surface border border-border rounded-lg font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              onClick={handleRecord}
              disabled={!currentDistanceInput || splitLimitReached}
              className="h-8 px-3 text-xs font-medium rounded-lg bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 shrink-0"
            >
              <CircleDot className="w-3.5 h-3.5" />
              {t("splits.record")}
            </button>
          </div>

          {/* Split limit message */}
          {splitLimitReached && (
            <div className="flex items-start gap-2 p-2.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-lg">
              <Lock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-700 dark:text-amber-300">
                {t("splits.limitReached", { max: maxSplits })}
              </p>
            </div>
          )}

          {/* Memo input */}
          <input
            type="text"
            placeholder={t("splits.memoPlaceholder")}
            value={currentMemoInput}
            onChange={(e) => setCurrentMemoInput(e.target.value)}
            className="w-full h-8 px-3 text-xs bg-surface border border-border rounded-lg placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
          />

          {/* Finish button */}
          <button
            onClick={handleFinish}
            disabled={!canFinish}
            className="w-full h-9 text-xs font-medium rounded-lg bg-red-600/90 text-white hover:bg-red-500 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Flag className="w-3.5 h-3.5" />
            {canFinish
              ? t("splits.finishAtDistance", { distance: raceDistance })
              : t("splits.finishNeedRaceDistance")}
          </button>
        </div>
      )}

      {/* Finish summary */}
      {isFinished && finishTime !== null && (
        <div className="space-y-2">
          <div
            onClick={() => startTime !== null && seekVideo(startTime + finishTime)}
            className="bg-primary/10 border border-primary/20 rounded-lg p-3 flex items-center gap-3 cursor-pointer hover:bg-primary/15 transition-colors"
          >
            <Trophy className="w-5 h-5 text-primary shrink-0" />
            <div>
              <div className="text-[11px] text-muted-foreground font-medium">
                {t("splits.finalTime")}
              </div>
              <div className="text-lg font-bold font-mono text-primary tabular-nums">
                {formatTime(finishTime)}
              </div>
              {finishMemo && <p className="text-[10px] text-muted-foreground mt-0.5">{finishMemo}</p>}
            </div>
          </div>
          <button
            onClick={revertFinish}
            className="w-full h-8 text-xs font-medium rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-primary/20 transition-colors flex items-center justify-center gap-1.5"
          >
            <Pencil className="w-3 h-3" />
            {t("splits.edit")}
          </button>
        </div>
      )}

      {/* Split list */}
      {splitTimes.length === 0 && !isFinished ? (
        <p className="text-xs text-muted-foreground/60 text-center py-6">{t("splits.emptyHint")}</p>
      ) : (
        <div className="flex flex-col gap-1">
          {splitTimes.map((split, index) => (
            <div
              key={split.distance}
              onClick={() => startTime !== null && seekVideo(startTime + split.time)}
              className="px-2.5 py-2 rounded-lg bg-surface-raised/50 hover:bg-surface-raised transition-colors group cursor-pointer"
            >
              <div className="flex items-center gap-2">
                {/* Distance badge */}
                <span className="text-[11px] font-bold font-mono text-primary bg-primary/10 px-2 py-0.5 rounded-md min-w-[48px] text-center tabular-nums">
                  {split.distance}m
                </span>

                {/* Time */}
                <span className="text-xs font-mono font-semibold tabular-nums flex-1">
                  {formatTime(split.time)}
                </span>

                {/* Lap = diff from the previous split (derived, shown for all rows) */}
                {lapByDistance.has(split.distance) && (
                  <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
                    {t("splits.lap")}: {formatTime(lapByDistance.get(split.distance)!)}
                  </span>
                )}

                {/* Delete button */}
                {!isFinished && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSplit(index);
                    }}
                    className="w-5 h-5 rounded flex items-center justify-center text-muted-foreground/40 hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
              {split.memo && (
                <p className="text-[10px] text-muted-foreground mt-1 ml-[56px]">{split.memo}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
