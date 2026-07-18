interface DailyUsage {
  date: string;
  count: number;
}

const STORAGE_KEY_PREFIX = "swimhub_guest_daily_usage";

export function getTodayJST(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
}

export function canGuestUseToday(
  app: string,
  getItem: (key: string) => string | null,
  dailyLimit: number = 1
): boolean {
  try {
    const key = `${STORAGE_KEY_PREFIX}_${app}`;
    const raw = getItem(key);
    if (!raw) return true;
    const usage: DailyUsage = JSON.parse(raw);
    const today = getTodayJST();
    if (usage.date !== today) return true;
    return usage.count < dailyLimit;
  } catch {
    return true;
  }
}

export function markGuestUsedToday(
  app: string,
  getItem: (key: string) => string | null,
  setItem: (key: string, value: string) => void
): void {
  try {
    const key = `${STORAGE_KEY_PREFIX}_${app}`;
    const today = getTodayJST();
    const raw = getItem(key);
    let usage: DailyUsage;
    if (raw) {
      usage = JSON.parse(raw);
      if (usage.date === today) {
        usage.count += 1;
      } else {
        usage = { date: today, count: 1 };
      }
    } else {
      usage = { date: today, count: 1 };
    }
    setItem(key, JSON.stringify(usage));
  } catch {
    // storage unavailable
  }
}

export function getGuestTodayCount(
  app: string,
  getItem: (key: string) => string | null
): number {
  try {
    const key = `${STORAGE_KEY_PREFIX}_${app}`;
    const raw = getItem(key);
    if (!raw) return 0;
    const usage: DailyUsage = JSON.parse(raw);
    const today = getTodayJST();
    return usage.date === today ? usage.count : 0;
  } catch {
    return 0;
  }
}
