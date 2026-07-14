/**
 * Pure-function tests for the export pipeline (no FFmpeg / native calls).
 *
 * Covers the "silently wrong output" surfaces flagged in review: the summary
 * transition clamp (computeSummaryStartT), drawtext escaping (incl. the `"`
 * fix), encoder/bitrate/audio arg builders, and the HW encoder selector.
 */
import { SUMMARY_DELAY_SECONDS } from "@swimhub-timer/shared";
import {
  computeSummaryStartT,
  escapeDrawtextText,
  getHwEncoder,
  buildHwDecodeArgs,
  buildVideoBitrateArgs,
  buildVideoEncoderArgs,
  buildAudioArgs,
} from "../lib/video/export-pipeline";

describe("computeSummaryStartT", () => {
  it("returns null when there is no finish", () => {
    expect(computeSummaryStartT(10, null, 60)).toBeNull();
  });

  it("returns finishAbs + delay when the clip has room after the finish", () => {
    // start=5, finish=30 → finishAbs=35; plenty of clip left (120s).
    expect(computeSummaryStartT(5, 30, 120)).toBeCloseTo(35 + SUMMARY_DELAY_SECONDS, 5);
  });

  it("clamps so the summary still lands on real frames when the finish is near the clip end", () => {
    // start=0, finish=59, duration=60 → desired (59+delay) overruns the clip.
    // Clamp = min(duration-0.05, max(finishAbs, duration-1.5)) = min(59.95, 59) = 59.
    expect(computeSummaryStartT(0, 59, 60)).toBeCloseTo(59, 5);
  });

  it("never returns a time at/after the clip end", () => {
    const t = computeSummaryStartT(0, 59.9, 60);
    expect(t).not.toBeNull();
    expect(t as number).toBeLessThanOrEqual(60 - 0.05);
  });

  it("does not clamp when duration is unknown (0)", () => {
    expect(computeSummaryStartT(0, 30, 0)).toBeCloseTo(30 + SUMMARY_DELAY_SECONDS, 5);
  });
});

describe("escapeDrawtextText", () => {
  it('strips double quotes (they would close the -filter_complex "…" argument)', () => {
    expect(escapeDrawtextText('a"b"c')).toBe("abc");
  });

  it("replaces apostrophes with a typographic quote", () => {
    expect(escapeDrawtextText("it's")).toBe("it’s");
  });

  it("escapes colons and percent signs, and drops backslashes", () => {
    expect(escapeDrawtextText("a:b")).toBe("a\\:b");
    expect(escapeDrawtextText("50%")).toBe("50\\%");
    expect(escapeDrawtextText("a\\b")).toBe("ab");
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeDrawtextText("100m Free")).toBe("100m Free");
  });
});

describe("HW encoder + arg builders", () => {
  it("selects a platform HW encoder (ios default in tests → videotoolbox)", () => {
    expect(getHwEncoder()).toBe("h264_videotoolbox");
  });

  it("builds hwaccel decode args only when enabled", () => {
    expect(buildHwDecodeArgs(true)).toBe("-hwaccel videotoolbox");
    expect(buildHwDecodeArgs(false)).toBe("");
  });

  it("uses higher bitrate for 1080/original and lower for 720", () => {
    expect(buildVideoBitrateArgs("1080")).toContain("-b:v 10M");
    expect(buildVideoBitrateArgs("original")).toContain("-b:v 10M");
    expect(buildVideoBitrateArgs("720")).toContain("-b:v 5M");
  });

  it("falls back to libx264 with CRF when there is no HW encoder", () => {
    expect(buildVideoEncoderArgs(null, "1080", "23")).toBe(
      "-c:v libx264 -preset veryfast -crf 23",
    );
    expect(buildVideoEncoderArgs("h264_videotoolbox", "720", "23")).toBe(
      "-c:v h264_videotoolbox -b:v 5M -maxrate 6M -bufsize 8M",
    );
  });

  it("copies AAC audio and re-encodes anything else", () => {
    expect(buildAudioArgs("aac")).toBe("-c:a copy");
    expect(buildAudioArgs("AAC")).toBe("-c:a copy");
    expect(buildAudioArgs("opus")).toBe("-c:a aac -b:a 128k");
    expect(buildAudioArgs(null)).toBe("-c:a aac -b:a 128k");
  });
});
