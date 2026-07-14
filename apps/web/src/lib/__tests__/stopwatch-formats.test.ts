import { describe, expect, it } from "vitest";
import { formatTime } from "@swimhub-timer/shared";

describe("formatTime", () => {
  // Regression guard for the float-truncation bug: 2.55 * 100 === 254.9999…,
  // so a naive Math.floor rendered "2.54". Values that are mathematically exact
  // must render exactly; genuine sub-centisecond fractions still truncate.
  it("does not drop a centisecond on values stored as N.99999…", () => {
    expect(formatTime(2.55)).toBe("2.55");
    expect(formatTime(1.15)).toBe("1.15");
    expect(formatTime(0.29)).toBe("0.29");
  });

  it("truncates genuine sub-centisecond fractions (no rounding up)", () => {
    expect(formatTime(2.559)).toBe("2.55");
    expect(formatTime(0.019)).toBe("0.01");
  });

  it("formats minutes / seconds / centiseconds", () => {
    expect(formatTime(83.45)).toBe("1:23.45");
    expect(formatTime(5.32)).toBe("5.32");
    expect(formatTime(0)).toBe("0.00");
    expect(formatTime(600)).toBe("10:00.00");
  });

  it("clamps negative input to zero", () => {
    expect(formatTime(-1)).toBe("0.00");
  });

  it("keeps the seconds field consistent when a centisecond rolls to 60s", () => {
    // 59.999 must not render "60.00" via a rolled cs disagreeing with seconds.
    expect(formatTime(59.999)).toBe("59.99");
  });
});
