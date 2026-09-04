import { describe, expect, it } from "vitest";
import { DEFAULT_STOPWATCH_CONFIG, STOPWATCH_PRESETS } from "../utils/stopwatch-presets";

describe("STOPWATCH_PRESETS", () => {
  it("has at least one preset", () => {
    expect(STOPWATCH_PRESETS.length).toBeGreaterThan(0);
  });

  it("each preset has unique id", () => {
    const ids = STOPWATCH_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("each preset has required fields", () => {
    for (const preset of STOPWATCH_PRESETS) {
      expect(preset.id).toBeTruthy();
      expect(preset.name).toBeTruthy();
      expect(preset.config).toBeDefined();
    }
  });

  it("each preset config has valid position (0-1 range)", () => {
    for (const preset of STOPWATCH_PRESETS) {
      const { x, y } = preset.config.position;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
  });

  it("each preset config has positive fontSize", () => {
    for (const preset of STOPWATCH_PRESETS) {
      expect(preset.config.fontSize).toBeGreaterThan(0);
    }
  });

  it("each preset config has positive padding", () => {
    for (const preset of STOPWATCH_PRESETS) {
      expect(preset.config.padding).toBeGreaterThan(0);
    }
  });

  it("each preset config has non-negative borderRadius", () => {
    for (const preset of STOPWATCH_PRESETS) {
      expect(preset.config.borderRadius).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("DEFAULT_STOPWATCH_CONFIG", () => {
  it("equals the first preset config", () => {
    // STOPWATCH_PRESETS is a non-empty literal array (see stopwatch-presets.ts).
    expect(DEFAULT_STOPWATCH_CONFIG).toBe(STOPWATCH_PRESETS[0]!.config);
  });
});
