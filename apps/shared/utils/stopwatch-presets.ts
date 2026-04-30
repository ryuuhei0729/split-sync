import type { StopwatchPreset } from "../types/stopwatch";

export const STOPWATCH_FONT_SIZE_MIN = 60;
export const STOPWATCH_FONT_SIZE_MAX = 200;
export const STOPWATCH_FONT_SIZE_DEFAULT = 130;

const SHARED_LAYOUT = {
  fontSize: STOPWATCH_FONT_SIZE_DEFAULT,
  position: { x: 0.5, y: 0.5 },
  anchor: "center",
  summaryPosition: { x: 0.5, y: 0.5 },
  summaryAnchor: "center",
  summaryScale: 1,
} as const;

export const STOPWATCH_PRESETS: StopwatchPreset[] = [
  {
    id: "classic-digital",
    name: "Classic Digital",
    config: {
      fontFamily: "monospace",
      textColor: "#00FF00",
      backgroundColor: "rgba(0,0,0,0.8)",
      borderRadius: 4,
      padding: 12,
      ...SHARED_LAYOUT,
    },
  },
  {
    id: "minimal-white",
    name: "Minimal White",
    config: {
      fontFamily: "sans-serif",
      textColor: "#FFFFFF",
      backgroundColor: "rgba(0,0,0,0.4)",
      borderRadius: 8,
      padding: 10,
      ...SHARED_LAYOUT,
    },
  },
  {
    id: "broadcast",
    name: "Broadcast",
    config: {
      fontFamily: "sans-serif",
      textColor: "#FFFFFF",
      backgroundColor: "rgba(0,50,120,0.85)",
      borderRadius: 6,
      padding: 16,
      ...SHARED_LAYOUT,
    },
  },
  {
    id: "competition-red",
    name: "Competition Red",
    config: {
      fontFamily: "monospace",
      textColor: "#FFFFFF",
      backgroundColor: "rgba(200,30,30,0.85)",
      borderRadius: 4,
      padding: 12,
      ...SHARED_LAYOUT,
    },
  },
];

export const DEFAULT_STOPWATCH_CONFIG = STOPWATCH_PRESETS[0].config;
