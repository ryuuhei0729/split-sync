import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canGuestUseToday,
  getGuestTodayCount,
  getTodayJST,
  markGuestUsedToday,
} from "../utils/guest-daily-limit";

function createFakeStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

describe("getTodayJST", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a YYYY-MM-DD formatted string", () => {
    expect(getTodayJST()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("does not throw an Invalid Date (regression: no new Date(toLocaleString) round-trip)", () => {
    const result = getTodayJST();
    expect(result).not.toBe("Invalid Date");
    expect(Number.isNaN(new Date(result).getTime())).toBe(false);
  });

  it("returns JST date, one day ahead of UTC, when UTC time is 15:00-23:59 (boundary case 1: just after midnight JST)", () => {
    // UTC 2026-03-12T15:00:00Z === JST 2026-03-13T00:00:00 (+9h)
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-12T15:00:00Z"));
    expect(getTodayJST()).toBe("2026-03-13");
  });

  it("returns JST date, one day ahead of UTC, when UTC time is 23:59 (boundary case 2: late JST morning)", () => {
    // UTC 2026-03-12T23:59:00Z === JST 2026-03-13T08:59:00 (+9h)
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-12T23:59:00Z"));
    expect(getTodayJST()).toBe("2026-03-13");
  });

  it("returns the same date as UTC when UTC time is before 15:00 (no day rollover)", () => {
    // UTC 2026-03-12T10:00:00Z === JST 2026-03-12T19:00:00 (+9h), same calendar day
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-12T10:00:00Z"));
    expect(getTodayJST()).toBe("2026-03-12");
  });

  it("handles month rollover across the JST boundary", () => {
    // UTC 2026-02-28T15:00:00Z === JST 2026-03-01T00:00:00
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-28T15:00:00Z"));
    expect(getTodayJST()).toBe("2026-03-01");
  });
});

describe("canGuestUseToday / markGuestUsedToday / getGuestTodayCount (with getTodayJST-based storage)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-12T03:00:00Z")); // JST 2026-03-12T12:00:00
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("canGuestUseToday returns true when nothing has been recorded yet", () => {
    const { getItem } = createFakeStorage();
    expect(canGuestUseToday("timer", getItem)).toBe(true);
  });

  it("markGuestUsedToday then canGuestUseToday reflects the limit being reached", () => {
    const { getItem, setItem } = createFakeStorage();
    markGuestUsedToday("timer", getItem, setItem);
    expect(canGuestUseToday("timer", getItem, 1)).toBe(false);
  });

  it("canGuestUseToday allows another use when dailyLimit > recorded count", () => {
    const { getItem, setItem } = createFakeStorage();
    markGuestUsedToday("timer", getItem, setItem);
    expect(canGuestUseToday("timer", getItem, 2)).toBe(true);
  });

  it("getGuestTodayCount reflects the count stored under today's JST date", () => {
    const { getItem, setItem } = createFakeStorage();
    markGuestUsedToday("timer", getItem, setItem);
    markGuestUsedToday("timer", getItem, setItem);
    expect(getGuestTodayCount("timer", getItem)).toBe(2);
  });

  it("usage recorded before the JST boundary is stale (count 0 / usable) after crossing into the next JST day", () => {
    const { getItem, setItem } = createFakeStorage();
    // Use it just before the JST rollover (UTC 14:59 = JST 23:59)
    vi.setSystemTime(new Date("2026-03-12T14:59:00Z"));
    markGuestUsedToday("timer", getItem, setItem);
    expect(getGuestTodayCount("timer", getItem)).toBe(1);
    expect(canGuestUseToday("timer", getItem, 1)).toBe(false);

    // Cross the JST boundary (UTC 15:00 = JST next day 00:00)
    vi.setSystemTime(new Date("2026-03-12T15:00:00Z"));
    expect(getGuestTodayCount("timer", getItem)).toBe(0);
    expect(canGuestUseToday("timer", getItem, 1)).toBe(true);
  });

  it("getGuestTodayCount returns 0 when nothing has been recorded", () => {
    const { getItem } = createFakeStorage();
    expect(getGuestTodayCount("timer", getItem)).toBe(0);
  });

  it("isolates usage between different app keys (scanner vs timer)", () => {
    const { getItem, setItem } = createFakeStorage();
    markGuestUsedToday("timer", getItem, setItem);
    expect(canGuestUseToday("scanner", getItem, 1)).toBe(true);
    expect(getGuestTodayCount("scanner", getItem)).toBe(0);
  });
});
