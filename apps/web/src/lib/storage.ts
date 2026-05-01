import { get, set } from "idb-keyval";
import type { StopwatchConfig } from "@swimhub-timer/shared";

const KEYS = {
  STOPWATCH_CONFIG: "swimhub-timer-stopwatch-config",
} as const;

export async function saveStopwatchConfig(config: StopwatchConfig): Promise<void> {
  await set(KEYS.STOPWATCH_CONFIG, config);
}

export async function loadStopwatchConfig(): Promise<StopwatchConfig | null> {
  const config = await get<StopwatchConfig>(KEYS.STOPWATCH_CONFIG);
  return config ?? null;
}
