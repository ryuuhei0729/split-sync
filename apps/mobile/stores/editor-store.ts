import { create } from "zustand";
import type {
  EditorStep,
  StopwatchConfig,
  SplitTime,
  VideoMetadata,
  ExportSettings,
  Rect,
} from "@swimhub-timer/shared";
import { STOPWATCH_PRESETS } from "@swimhub-timer/shared";

const MOBILE_BASE_PRESET =
  STOPWATCH_PRESETS.find((p) => p.id === "minimal-white") ?? STOPWATCH_PRESETS[0];

// Mobile is locked to the minimal-white preset, but with a slightly darker
// backdrop so the timer reads cleanly over light pool footage.
// borderRadius is 0 so the preview matches the FFmpeg drawtext box, which is
// always square — fixing the rounded-vs-square mismatch.
/**
 * Default summary-table scale on mobile. The shared base font (13px @ native
 * video resolution) is tiny next to the ~130px timer, so the summary needs a
 * multiplier to read well by default. (Adjust to taste.)
 */
export const MOBILE_DEFAULT_SUMMARY_SCALE = 5;

export const MOBILE_DEFAULT_STOPWATCH_CONFIG: StopwatchConfig = {
  ...MOBILE_BASE_PRESET.config,
  backgroundColor: "rgba(0,0,0,0.6)",
  anchor: "bottom-left",
  borderRadius: 0,
  summaryScale: MOBILE_DEFAULT_SUMMARY_SCALE,
};

interface AudioData {
  pcmData: Float32Array;
  sampleRate: number;
  duration: number;
}

interface EditorState {
  step: EditorStep;
  videoUri: string | null;
  videoMetadata: VideoMetadata | null;
  audioData: AudioData | null;
  waveformData: Float32Array | null;
  detectedSignalTime: number | null;
  startTime: number | null;
  isDetecting: boolean;
  stopwatchConfig: StopwatchConfig;
  exportSettings: ExportSettings;
  exportProgress: number;
  isExporting: boolean;

  currentVideoTime: number;
  pendingVideoSeek: number | null;
  pendingPause: boolean;
  setCurrentVideoTime: (time: number) => void;
  seekVideo: (time: number) => void;
  seekVideoAndPause: (time: number) => void;
  clearPendingSeek: () => void;

  splitTimes: SplitTime[];
  currentDistanceInput: string;
  currentMemoInput: string;
  raceDistance: number | null;
  isFinished: boolean;
  finishTime: number | null;
  finishMemo: string;
  designConfirmed: boolean;

  // Which overlay element is currently being edited in the preview. Shared so
  // the Skia preview (StopwatchSkiaOverlay) can defer to the RN editing chrome
  // for the element under edit (keeps the selection frame aligned with the
  // glyphs), while drawing the rest WYSIWYG.
  timerEditing: boolean;
  summaryEditing: boolean;
  setTimerEditing: (editing: boolean) => void;
  setSummaryEditing: (editing: boolean) => void;

  // Screen-space bounds (relative to the overlay root) of the timer/summary as
  // drawn by the Skia preview. The RN gesture layer positions its hit areas +
  // selection frame from these so editing chrome is glued to the Skia glyphs
  // and preview == export (single geometry: shared calculatePosition).
  timerPreviewBounds: Rect | null;
  summaryPreviewBounds: Rect | null;
  setPreviewBounds: (bounds: { timer: Rect | null; summary: Rect | null }) => void;

  setStep: (step: EditorStep) => void;
  setVideoUri: (uri: string) => void;
  clearVideo: () => void;
  setVideoMetadata: (metadata: VideoMetadata) => void;
  setAudioData: (data: AudioData) => void;
  setWaveformData: (data: Float32Array) => void;
  setDetectedSignalTime: (time: number | null) => void;
  setStartTime: (time: number | null) => void;
  setIsDetecting: (detecting: boolean) => void;
  updateStopwatchConfig: (partial: Partial<StopwatchConfig>) => void;
  setStopwatchConfig: (config: StopwatchConfig) => void;
  setExportSettings: (settings: Partial<ExportSettings>) => void;
  setExportProgress: (progress: number) => void;
  setIsExporting: (exporting: boolean) => void;
  setCurrentDistanceInput: (value: string) => void;
  setCurrentMemoInput: (value: string) => void;
  setRaceDistance: (distance: number | null) => void;
  setDesignConfirmed: (confirmed: boolean) => void;
  recordSplit: (elapsedSeconds: number) => void;
  removeSplit: (index: number) => void;
  finishRecording: (elapsedSeconds: number, memo?: string) => void;
  revertFinish: () => void;
  resetSplits: () => void;
  reset: () => void;
}

const initialState = {
  step: "import" as EditorStep,
  videoUri: null as string | null,
  videoMetadata: null as VideoMetadata | null,
  audioData: null as AudioData | null,
  waveformData: null as Float32Array | null,
  detectedSignalTime: null as number | null,
  startTime: null as number | null,
  isDetecting: false,
  stopwatchConfig: { ...MOBILE_DEFAULT_STOPWATCH_CONFIG },
  exportSettings: { resolution: "1080" as const },
  exportProgress: 0,
  isExporting: false,
  currentVideoTime: 0,
  pendingVideoSeek: null as number | null,
  pendingPause: false,
  splitTimes: [] as SplitTime[],
  currentDistanceInput: "",
  currentMemoInput: "",
  raceDistance: null as number | null,
  isFinished: false,
  finishTime: null as number | null,
  finishMemo: "",
  designConfirmed: false,
  timerEditing: false,
  summaryEditing: false,
  timerPreviewBounds: null as Rect | null,
  summaryPreviewBounds: null as Rect | null,
};

export const useEditorStore = create<EditorState>((set, get) => ({
  ...initialState,

  setStep: (step) => set({ step }),

  setVideoUri: (uri) => {
    set({ videoUri: uri, step: "detect" });
  },

  clearVideo: () => {
    set({
      ...initialState,
      stopwatchConfig: get().stopwatchConfig,
    });
  },

  setVideoMetadata: (metadata) => set({ videoMetadata: metadata }),
  setAudioData: (data) => set({ audioData: data }),
  setWaveformData: (data) => set({ waveformData: data }),
  setDetectedSignalTime: (time) => set({ detectedSignalTime: time }),
  setStartTime: (time) => set({ startTime: time }),
  setIsDetecting: (detecting) => set({ isDetecting: detecting }),

  updateStopwatchConfig: (partial) =>
    set((state) => ({
      stopwatchConfig: { ...state.stopwatchConfig, ...partial },
    })),

  setStopwatchConfig: (config) => set({ stopwatchConfig: config }),

  setExportSettings: (settings) =>
    set((state) => ({
      exportSettings: { ...state.exportSettings, ...settings },
    })),

  setExportProgress: (progress) => set({ exportProgress: progress }),
  setIsExporting: (exporting) => set({ isExporting: exporting }),

  setCurrentVideoTime: (time) => set({ currentVideoTime: time }),
  seekVideo: (time) => set({ pendingVideoSeek: time }),
  seekVideoAndPause: (time) => set({ pendingVideoSeek: time, pendingPause: true }),
  clearPendingSeek: () => set({ pendingVideoSeek: null, pendingPause: false }),
  setCurrentDistanceInput: (value) => set({ currentDistanceInput: value }),
  setCurrentMemoInput: (value) => set({ currentMemoInput: value }),
  setRaceDistance: (distance) => set({ raceDistance: distance }),
  setDesignConfirmed: (confirmed) => set({ designConfirmed: confirmed }),
  setTimerEditing: (editing) => set({ timerEditing: editing }),
  setSummaryEditing: (editing) => set({ summaryEditing: editing }),
  setPreviewBounds: ({ timer, summary }) =>
    set({ timerPreviewBounds: timer, summaryPreviewBounds: summary }),

  recordSplit: (elapsedSeconds) => {
    const { currentDistanceInput, currentMemoInput, splitTimes } = get();
    const distance = parseFloat(currentDistanceInput);
    if (isNaN(distance) || distance <= 0) return;
    if (splitTimes.some((s) => s.distance === distance)) return;

    // lapTime is derived at display time via calculateRaceLapTimesTable.
    // Keep the field for backward compat but stop populating it here.
    const newSplit: SplitTime = {
      distance,
      time: elapsedSeconds,
      lapTime: null,
      memo: currentMemoInput.trim(),
    };
    const updated = [...splitTimes, newSplit].sort((a, b) => a.distance - b.distance);
    set({
      splitTimes: updated,
      currentDistanceInput: "",
      currentMemoInput: "",
    });
  },

  removeSplit: (index) => {
    const { splitTimes } = get();
    set({ splitTimes: splitTimes.filter((_, i) => i !== index) });
  },

  finishRecording: (elapsedSeconds, memo) => {
    const { raceDistance, splitTimes } = get();
    // Auto-record a split at raceDistance so the FinishSummaryTable can compute
    // the final lap times consistently with the rest of the rows.
    let updatedSplits = splitTimes;
    if (raceDistance !== null && raceDistance > 0) {
      const filtered = splitTimes.filter((s) => s.distance !== raceDistance);
      updatedSplits = [
        ...filtered,
        {
          distance: raceDistance,
          time: elapsedSeconds,
          lapTime: null,
          memo: (memo ?? "").trim(),
        },
      ].sort((a, b) => a.distance - b.distance);
    }
    set({
      splitTimes: updatedSplits,
      isFinished: true,
      finishTime: elapsedSeconds,
      finishMemo: (memo ?? "").trim(),
    });
  },

  revertFinish: () => {
    const { splitTimes, finishTime, raceDistance } = get();
    // Drop the auto-added finish split (only if it still matches finishTime —
    // that disambiguates from a split the user manually placed at raceDistance).
    let restored = splitTimes;
    if (raceDistance !== null && raceDistance > 0 && finishTime !== null) {
      restored = splitTimes.filter(
        (s) => !(s.distance === raceDistance && s.time === finishTime),
      );
    }
    set({
      splitTimes: restored,
      isFinished: false,
      finishTime: null,
      finishMemo: "",
    });
  },

  resetSplits: () => {
    set({
      splitTimes: [],
      currentDistanceInput: "",
      currentMemoInput: "",
      raceDistance: null,
      isFinished: false,
      finishTime: null,
      finishMemo: "",
    });
  },

  reset: () => {
    set(initialState);
  },
}));
