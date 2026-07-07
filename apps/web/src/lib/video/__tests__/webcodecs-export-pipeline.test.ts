/**
 * Sprint Contract テスト — Phase B 追補 (Developer Critical修正 C1 の再検証)
 * 対象: apps/web/src/lib/video/webcodecs-export-pipeline.ts (exportVideoWithStopwatchWebCodecs)
 *
 * 検証対象: 「V-18 の拡張」— mid-stream 失敗 (数フレーム/パケット処理後に throw) で:
 *   (a) もう片方のループがオーファン化して裏で走り続けないこと (bounded, 早期停止)
 *   (b) 例外が呼び出し元 (dispatcher) まで伝播し、ffmpeg フォールバックが発動できること
 *   (c) output.cancel() が呼ばれ、finalize() は呼ばれないこと (二重パイプライン/破損出力の防止)
 *
 * 前回 (早期失敗=VideoEncoder.configure 呼び出し時点) との違い:
 *   今回は「数フレーム処理した後」に失敗を注入し、AbortController が実際に途中停止させることを
 *   フレーム処理カウントで直接検証する (オーファン化なら大きい数のフレームが処理され続けるはず)。
 *
 * mediabunny 自体は jsdom で動かせない (OffscreenCanvas/VideoEncoder 依存) ため、
 * exportVideoWithStopwatchWebCodecs が直接 import する mediabunny のクラス群と、
 * 隣接モジュール (capability/encoder-config/frame-compositor/audio-passthrough/source-probe)
 * を全て vi.mock し、video/audio 2つの並行ループの相互作用のみを分離してテストする。
 *
 * vi.mock ファクトリはファイル先頭にホイストされるため、参照する可変状態は
 * vi.hoisted() でまとめて宣言する (通常の const 宣言は mock ファクトリより後に評価され、
 * ReferenceError になる)。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { state } = vi.hoisted(() => {
  return {
    state: {
      outputCancel: vi.fn().mockResolvedValue(undefined),
      outputFinalize: vi.fn().mockResolvedValue(undefined),
      outputStart: vi.fn().mockResolvedValue(undefined),
      addVideoTrack: vi.fn(),
      addAudioTrack: vi.fn(),
      canvasSourceAdd: vi.fn().mockResolvedValue(undefined),
      canvasSourceClose: vi.fn(),
      audioRunMock: vi.fn(),
      // Frame index (1-based count of canvasSourceAdd calls + 1) at which the video loop
      // itself throws, for the "video throws mid-stream" case. -1 = never.
      videoThrowsAtCall: -1,
      // How many frames the fake CanvasSink is willing to yield if never aborted
      // (large = "runs forever" — used to distinguish "stopped early" from "ran to completion").
      FAKE_TOTAL_FRAMES: 200,
    },
  };
});

vi.mock("mediabunny", () => ({
  BufferTarget: vi.fn().mockImplementation(() => ({ buffer: new ArrayBuffer(8) })),
  Mp4OutputFormat: vi.fn().mockImplementation(() => ({})),
  Output: vi.fn().mockImplementation(() => ({
    start: state.outputStart,
    cancel: state.outputCancel,
    finalize: state.outputFinalize,
    addVideoTrack: state.addVideoTrack,
    addAudioTrack: state.addAudioTrack,
  })),
  CanvasSource: vi.fn().mockImplementation(() => ({
    add: state.canvasSourceAdd,
    close: state.canvasSourceClose,
  })),
  CanvasSink: vi.fn().mockImplementation(() => ({
    // Async generator that yields many frames with a microtask delay between each —
    // long enough that an *unaborted* loop would process most/all of FAKE_TOTAL_FRAMES,
    // so early stopping is clearly distinguishable from "ran to completion".
    canvases: async function* () {
      for (let i = 0; i < state.FAKE_TOTAL_FRAMES; i++) {
        await Promise.resolve();
        yield { canvas: {}, timestamp: i / 30, duration: 1 / 30 };
      }
    },
  })),
}));

vi.mock("../webcodecs-capability", () => ({
  detectWebCodecsCapability: vi.fn().mockResolvedValue({ supported: true }),
}));

vi.mock("../webcodecs-encoder-config", () => ({
  buildEncoderConfig: vi.fn().mockReturnValue({
    width: 640,
    height: 480,
    bitrate: 3_000_000,
    codecString: "avc1.640028",
    levelName: "4.0",
  }),
  scaleStopwatchConfigForExport: vi.fn((config: unknown) => config),
}));

vi.mock("../webcodecs-frame-compositor", () => ({
  createFrameCompositorContext: vi.fn().mockReturnValue({ canvas: {}, ctx: {}, width: 640, height: 480 }),
  compositeFrame: vi.fn(() => {
    if (state.canvasSourceAdd.mock.calls.length + 1 === state.videoThrowsAtCall) {
      throw new Error("QA-injected mid-stream video failure");
    }
  }),
}));

vi.mock("../webcodecs-source-probe", () => ({
  probeVideoSource: vi.fn().mockResolvedValue({
    input: { getPrimaryAudioTrack: vi.fn().mockResolvedValue({}) },
    videoTrack: {
      canDecode: vi.fn().mockResolvedValue(true),
      getDurationFromMetadata: vi.fn().mockResolvedValue(4),
      computeDuration: vi.fn().mockResolvedValue(4),
    },
    displayWidth: 640,
    displayHeight: 480,
    fps: 30,
  }),
}));

vi.mock("../webcodecs-audio-passthrough", () => ({
  setupAudioPassthrough: vi.fn().mockResolvedValue({ run: state.audioRunMock }),
}));

import { exportVideoWithStopwatchWebCodecs } from "../webcodecs-export-pipeline";
import { DEFAULT_STOPWATCH_CONFIG, type SplitTime } from "@swimhub-timer/shared";

function makeArgs(): Parameters<typeof exportVideoWithStopwatchWebCodecs> {
  return [
    new File(["dummy"], "race.mp4", { type: "video/mp4" }),
    5,
    DEFAULT_STOPWATCH_CONFIG,
    480,
    { resolution: "1080" },
    vi.fn(),
    false, // showWatermark=false — skip the icon fetch path entirely
    [] as SplitTime[],
    false,
    null,
    null,
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  state.videoThrowsAtCall = -1;
  state.canvasSourceAdd.mockResolvedValue(undefined);
});

describe("exportVideoWithStopwatchWebCodecs — mid-stream failure abort coordination (C1 再検証)", () => {
  it("[V-18拡張] audio ループが数パケット後に throw → video ループは大きく処理を進めず早期停止する (オーファン化しない)", async () => {
    // 音声ループは即時 throw (数パケット処理後を模す — video ループとの競合を最短で作る)
    state.audioRunMock.mockRejectedValue(new Error("QA-injected mid-stream audio failure"));

    await expect(exportVideoWithStopwatchWebCodecs(...makeArgs())).rejects.toThrow(
      "QA-injected mid-stream audio failure",
    );

    // オーファン化していれば canvasSourceAdd は FAKE_TOTAL_FRAMES (200) 近くまで呼ばれ続けるはず。
    // AbortController が機能していれば、数フレーム以内で停止する。
    expect(state.canvasSourceAdd.mock.calls.length).toBeLessThan(10);
    expect(state.canvasSourceAdd.mock.calls.length).toBeLessThan(state.FAKE_TOTAL_FRAMES / 2);
  });

  it("[V-18拡張] audio ループ失敗時、output.cancel() が呼ばれ finalize() は呼ばれない (破損出力防止)", async () => {
    state.audioRunMock.mockRejectedValue(new Error("mid-stream audio failure"));
    await expect(exportVideoWithStopwatchWebCodecs(...makeArgs())).rejects.toThrow();

    expect(state.outputCancel).toHaveBeenCalledTimes(1);
    expect(state.outputFinalize).not.toHaveBeenCalled();
  });

  it("[V-18拡張] video ループが数フレーム処理した後に throw → 例外が伝播し、audio ループも早期停止する", async () => {
    state.videoThrowsAtCall = 5; // 5フレーム目の compositeFrame で throw
    state.audioRunMock.mockImplementation(async (signal: AbortSignal) => {
      // 実装と同じ契約: signal.aborted を都度チェックして早期停止する audio ループを模す
      for (let i = 0; i < 1000; i++) {
        if (signal.aborted) return;
        await Promise.resolve();
      }
    });

    await expect(exportVideoWithStopwatchWebCodecs(...makeArgs())).rejects.toThrow(
      "QA-injected mid-stream video failure",
    );

    // video ループは throw した時点 (5フレーム目) 以降、それ以上 add を呼んでいない
    expect(state.canvasSourceAdd.mock.calls.length).toBeLessThanOrEqual(5);
    expect(state.outputCancel).toHaveBeenCalledTimes(1);
    expect(state.outputFinalize).not.toHaveBeenCalled();
  });

  it("[V-18拡張] 両ループとも正常終了する通常ケースでは output.finalize() が呼ばれ、cancel() は呼ばれない (回帰確認)", async () => {
    state.audioRunMock.mockResolvedValue(undefined);
    const blob = await exportVideoWithStopwatchWebCodecs(...makeArgs());

    expect(blob.type).toBe("video/mp4");
    expect(state.outputFinalize).toHaveBeenCalledTimes(1);
    expect(state.outputCancel).not.toHaveBeenCalled();
    // アボートされていないので全フレームが処理される
    expect(state.canvasSourceAdd.mock.calls.length).toBe(state.FAKE_TOTAL_FRAMES);
  });

  it("[V-18拡張] canvasSource.close() は video ループの成功/失敗どちらでも呼ばれる (リソース解放の保証)", async () => {
    state.audioRunMock.mockRejectedValue(new Error("mid-stream audio failure"));
    await expect(exportVideoWithStopwatchWebCodecs(...makeArgs())).rejects.toThrow();
    expect(state.canvasSourceClose).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    state.canvasSourceAdd.mockResolvedValue(undefined);
    state.audioRunMock.mockResolvedValue(undefined);
    await exportVideoWithStopwatchWebCodecs(...makeArgs());
    expect(state.canvasSourceClose).toHaveBeenCalledTimes(1);
  });
});
