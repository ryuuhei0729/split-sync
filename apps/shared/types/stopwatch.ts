export type StopwatchAnchor =
  | "top-left"
  | "top-center"
  | "top-right"
  | "center"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export type FontFamily = "monospace" | "sans-serif" | "serif";

export interface StopwatchConfig {
  fontFamily: FontFamily;
  fontSize: number;
  textColor: string;
  backgroundColor: string;
  borderRadius: number;
  padding: number;
  position: { x: number; y: number };
  anchor: StopwatchAnchor;
  summaryPosition: { x: number; y: number };
  summaryAnchor: StopwatchAnchor;
  summaryScale: number;
}

export interface StopwatchPreset {
  id: string;
  name: string;
  config: StopwatchConfig;
}

export interface SplitTime {
  distance: number; // 5, 12.5, 25, 50 etc.
  time: number; // elapsed seconds from start
  lapTime: number | null; // calculated only at 50m intervals
  memo: string; // optional short note (e.g. "ドルフィンキック5回")
}
