import type { StopwatchConfig } from "@swimhub-timer/shared";
import { DEFAULT_STOPWATCH_CONFIG } from "@swimhub-timer/shared";

function getStorage() {
  try {
    const { createMMKV } = require("react-native-mmkv");
    return createMMKV({ id: "swimhub-timer-settings" });
  } catch {
    // Fallback for Expo Go: no persistence
    return null;
  }
}

function getLegacyStorage() {
  try {
    const { createMMKV } = require("react-native-mmkv");
    return createMMKV({ id: "split-sync-settings" });
  } catch {
    return null;
  }
}

let _storage: ReturnType<typeof getStorage> | undefined = undefined;
function storage() {
  if (_storage === undefined) {
    _storage = getStorage();
  }
  return _storage;
}

const KEYS = {
  STOPWATCH_CONFIG: "stopwatch-config",
  MIGRATED: "migrated-from-legacy",
} as const;

function migrateFromLegacyStorage(): void {
  const s = storage();
  if (!s) return;

  if (s.getBoolean(KEYS.MIGRATED)) return;

  const legacy = getLegacyStorage();
  if (!legacy) {
    s.set(KEYS.MIGRATED, true);
    return;
  }

  const legacyJson = legacy.getString(KEYS.STOPWATCH_CONFIG);
  if (legacyJson) {
    s.set(KEYS.STOPWATCH_CONFIG, legacyJson);
    legacy.delete(KEYS.STOPWATCH_CONFIG);
  }

  s.set(KEYS.MIGRATED, true);
}

export function saveStopwatchConfig(config: StopwatchConfig): void {
  const s = storage();
  if (!s) return;
  s.set(KEYS.STOPWATCH_CONFIG, JSON.stringify(config));
}

export function loadStopwatchConfig(): StopwatchConfig {
  const s = storage();
  if (!s) return { ...DEFAULT_STOPWATCH_CONFIG };

  migrateFromLegacyStorage();

  const json = s.getString(KEYS.STOPWATCH_CONFIG);
  if (!json) return { ...DEFAULT_STOPWATCH_CONFIG };

  try {
    return { ...DEFAULT_STOPWATCH_CONFIG, ...JSON.parse(json) };
  } catch {
    return { ...DEFAULT_STOPWATCH_CONFIG };
  }
}
