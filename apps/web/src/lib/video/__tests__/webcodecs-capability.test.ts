/**
 * Sprint Contract テスト — Phase B 実装済み
 * 対象: apps/web/src/lib/video/webcodecs-capability.ts
 *   detectWebCodecsCapability / checkWebCodecsSupport
 *
 * 検証対象の Sprint Contract 項目:
 *   V-05: VideoEncoder / VideoDecoder / OffscreenCanvas 非対応環境では false
 *   V-06: isConfigSupported が例外を throw しても catch して false を返す (throw させない)
 *   V-07: isConfigSupported の呼び出し引数 (codec / width / height / bitrate / framerate) が意図通り
 *   V-31: resolution ごとに異なる (解像度/fpsに応じた) codec 文字列で probe している
 *         (固定 Baseline Level 3.1 文字列を使い回していないことの確認)
 *
 * jsdom には VideoEncoder/VideoDecoder/OffscreenCanvas が存在しないため、既定では
 * 「非対応」分岐が自然にテストされる。「対応」分岐は `vi.stubGlobal` で差し替える。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { detectWebCodecsCapability, checkWebCodecsSupport } from "../webcodecs-capability";

function stubVideoEncoder(isConfigSupportedImpl: (config: unknown) => unknown) {
  vi.stubGlobal("VideoEncoder", {
    isConfigSupported: vi.fn(isConfigSupportedImpl),
  } as unknown as typeof VideoEncoder);
}

function stubVideoDecoder() {
  vi.stubGlobal("VideoDecoder", {} as unknown as typeof VideoDecoder);
}

function stubOffscreenCanvas() {
  vi.stubGlobal("OffscreenCanvas", class {} as unknown as typeof OffscreenCanvas);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const BASE_PARAMS = { width: 1920, height: 1080, bitrate: 8_000_000, framerate: 30, codecString: "avc1.640028" };

describe("detectWebCodecsCapability — 対応検出", () => {
  it("[V-05] VideoEncoder が globalThis に存在しない (jsdom の既定状態) とき false を返す", async () => {
    const result = await detectWebCodecsCapability(BASE_PARAMS);
    expect(result.supported).toBe(false);
    expect(result.reason).toMatch(/VideoEncoder|VideoDecoder/);
  });

  it("[V-05] VideoEncoder はあるが VideoDecoder がない環境でも false を返す", async () => {
    stubVideoEncoder(() => ({ supported: true }));
    // VideoDecoder は stub しない (jsdom既定でundefinedのまま)
    const result = await detectWebCodecsCapability(BASE_PARAMS);
    expect(result.supported).toBe(false);
  });

  it("[V-05] VideoEncoder/VideoDecoder はあるが OffscreenCanvas がない環境では false を返す", async () => {
    stubVideoEncoder(() => ({ supported: true }));
    stubVideoDecoder();
    // OffscreenCanvas は stub しない
    const result = await detectWebCodecsCapability(BASE_PARAMS);
    expect(result.supported).toBe(false);
    expect(result.reason).toMatch(/OffscreenCanvas/);
  });

  it("[V-05] isConfigSupported が { supported: false } を返すとき false + 理由文字列を返す", async () => {
    stubVideoEncoder(() => ({ supported: false }));
    stubVideoDecoder();
    stubOffscreenCanvas();
    const result = await detectWebCodecsCapability(BASE_PARAMS);
    expect(result.supported).toBe(false);
    expect(result.reason).toContain(BASE_PARAMS.codecString);
  });

  it("[V-05] 全API存在 + isConfigSupported が { supported: true } を返すとき true を返す", async () => {
    stubVideoEncoder(() => ({ supported: true }));
    stubVideoDecoder();
    stubOffscreenCanvas();
    const result = await detectWebCodecsCapability(BASE_PARAMS);
    expect(result).toEqual({ supported: true });
  });

  it("[V-06] isConfigSupported が例外を throw しても catch して false を返す (呼び出し元に伝播させない)", async () => {
    stubVideoEncoder(() => {
      throw new Error("simulated browser bug");
    });
    stubVideoDecoder();
    stubOffscreenCanvas();
    await expect(detectWebCodecsCapability(BASE_PARAMS)).resolves.toEqual({
      supported: false,
      reason: "simulated browser bug",
    });
  });

  it("[V-07] isConfigSupported に codec/width/height/bitrate/framerate がそのまま渡される", async () => {
    const spy = vi.fn(() => ({ supported: true }));
    stubVideoEncoder(spy);
    stubVideoDecoder();
    stubOffscreenCanvas();
    await detectWebCodecsCapability(BASE_PARAMS);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        codec: BASE_PARAMS.codecString,
        width: BASE_PARAMS.width,
        height: BASE_PARAMS.height,
        bitrate: BASE_PARAMS.bitrate,
        framerate: BASE_PARAMS.framerate,
      }),
    );
  });

  it("[W1回帰固定] isConfigSupported は hardwareAcceleration: \"no-preference\" で呼ばれる (prefer-hardware に戻す回帰の検知)", async () => {
    // W1: ハードウェアエンコーダを持たない環境 (一部Linux/VM/低性能Android) で
    // 'prefer-hardware' を probe に使うと isConfigSupported が過剰に false を返し、
    // 実際にはソフトウェアエンコードで動作可能な環境まで ffmpeg フォールバックに回してしまう
    // (QA が headless Chromium で実測済み: prefer-hardware=false, no-preference=true)。
    // 実エンコーダ (CanvasSource) 側は依然 'prefer-hardware' ヒントを使ってよいが、
    // capability probe だけは 'no-preference' に固定する必要がある。この assertion が
    // 落ちたら 'prefer-hardware' に戻す回帰が起きたことを意味する。
    const spy = vi.fn(() => ({ supported: true }));
    stubVideoEncoder(spy);
    stubVideoDecoder();
    stubOffscreenCanvas();
    await detectWebCodecsCapability(BASE_PARAMS);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ hardwareAcceleration: "no-preference" }));
  });
});

describe("checkWebCodecsSupport — dispatcher 向けの真偽判定 (buildEncoderConfig と連携)", () => {
  it("[V-31] resolution=\"720\" と resolution=\"1080\" で異なる codec 文字列が isConfigSupported に渡される (固定Level3.1の使い回しでない)", async () => {
    const spy = vi.fn(() => ({ supported: true }));
    stubVideoEncoder(spy);
    stubVideoDecoder();
    stubOffscreenCanvas();

    await checkWebCodecsSupport(1920, 1080, "720", 30);
    const codec720 = (spy.mock.calls[0] as unknown as [{ codec: string }])[0].codec;

    spy.mockClear();
    await checkWebCodecsSupport(1920, 1080, "1080", 30);
    const codec1080 = (spy.mock.calls[0] as unknown as [{ codec: string }])[0].codec;

    expect(codec720).not.toBe(codec1080);
    expect(codec720).toBe("avc1.64001f"); // Level 3.1 (720p@30fpsでちょうど収まる)
    expect(codec1080).toBe("avc1.640028"); // Level 4.0 (1080p@30fpsに必要な最小レベル)
  });

  it("[V-07] resolution=\"original\" のとき元動画の width/height (偶数丸め後) が isConfigSupported に渡される", async () => {
    const spy = vi.fn(() => ({ supported: true }));
    stubVideoEncoder(spy);
    stubVideoDecoder();
    stubOffscreenCanvas();

    await checkWebCodecsSupport(1920, 1080, "original", 30);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ width: 1920, height: 1080 }));
  });

  it("[V-05] 非対応環境 (VideoEncoder なし) では boolean の false を返す (dispatcher が判定に使う契約)", async () => {
    const result = await checkWebCodecsSupport(1920, 1080, "1080");
    expect(result).toBe(false);
  });

  it("[V-05] 対応環境では boolean の true を返す", async () => {
    stubVideoEncoder(() => ({ supported: true }));
    stubVideoDecoder();
    stubOffscreenCanvas();
    const result = await checkWebCodecsSupport(1920, 1080, "1080");
    expect(result).toBe(true);
  });
});
