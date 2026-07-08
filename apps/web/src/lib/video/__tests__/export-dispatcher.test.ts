/**
 * Sprint Contract テスト — Phase B 実装済み
 * 対象: apps/web/src/lib/video/export-dispatcher.ts (dispatchVideoExport)
 *
 * PM 必須リスク3: 「フォールバックは実行時例外でも必須発動」
 *   WebCodecs 経路が capability check を通過していても、実行中に例外を throw したら、
 *   必ず ffmpeg 単一スレッド版へフォールバックし、「遅いが動く」を保証すること。
 *
 * 検証対象の Sprint Contract 項目:
 *   V-16: 対応環境では WebCodecs 経路が呼ばれ、ffmpeg 経路は呼ばれない
 *   V-17: 非対応環境では ffmpeg 経路にフォールバックする (capability check = false)
 *   V-18: 対応環境と判定されても実行時例外が出たら ffmpeg 経路に自動フォールバックする (最重要)
 *   V-19: どちらの経路でも最終的な出力 Blob の engine タグ / mime type が一致する
 *   V-20: フォールバック発生時、onProgress(0) でリセットされる (呼び出し元プログレスバー契約)
 *
 * 依存3モジュール (webcodecs-capability / webcodecs-export-pipeline / export-pipeline) を
 * vi.mock で差し替え、dispatcher 自身の分岐ロジックのみを検証する。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_STOPWATCH_CONFIG } from "@swimhub-timer/shared";
import type { ExportVideoOptions } from "../webcodecs-types";
import { WebCodecsUnsupportedError } from "../webcodecs-types";

vi.mock("../webcodecs-capability", () => ({ checkWebCodecsSupport: vi.fn() }));
vi.mock("../webcodecs-export-pipeline", () => ({ exportVideoWithStopwatchWebCodecs: vi.fn() }));
vi.mock("../export-pipeline", () => ({ exportVideoWithStopwatch: vi.fn() }));

import { dispatchVideoExport } from "../export-dispatcher";
import { checkWebCodecsSupport } from "../webcodecs-capability";
import { exportVideoWithStopwatchWebCodecs } from "../webcodecs-export-pipeline";
import { exportVideoWithStopwatch } from "../export-pipeline";

function makeOptions(overrides: Partial<ExportVideoOptions> = {}): ExportVideoOptions {
  return {
    videoFile: new File(["dummy"], "race.mp4", { type: "video/mp4" }),
    startSignalTime: 5,
    stopwatchConfig: DEFAULT_STOPWATCH_CONFIG,
    originalVideoWidth: 1920,
    originalVideoHeight: 1080,
    exportSettings: { resolution: "1080" },
    onProgress: vi.fn(),
    showWatermark: true,
    splitTimes: [],
    isFinished: false,
    finishTime: null,
    raceDistance: null,
    summaryImageData: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("dispatchVideoExport — 対応環境の分岐", () => {
  it("[V-16] WebCodecs 対応環境では webcodecs-export-pipeline が呼ばれ、ffmpeg 版は呼ばれない", async () => {
    vi.mocked(checkWebCodecsSupport).mockResolvedValue(true);
    const wcBlob = new Blob(["wc"], { type: "video/mp4" });
    vi.mocked(exportVideoWithStopwatchWebCodecs).mockResolvedValue(wcBlob);

    const result = await dispatchVideoExport(makeOptions());

    expect(result).toEqual({ blob: wcBlob, engine: "webcodecs" });
    expect(exportVideoWithStopwatchWebCodecs).toHaveBeenCalledTimes(1);
    expect(exportVideoWithStopwatch).not.toHaveBeenCalled();
  });

  it("[V-17] WebCodecs 非対応環境では最初から ffmpeg 版が呼ばれる (WebCodecs 側は一度も呼ばれない)", async () => {
    vi.mocked(checkWebCodecsSupport).mockResolvedValue(false);
    const ffBlob = new Blob(["ff"], { type: "video/mp4" });
    vi.mocked(exportVideoWithStopwatch).mockResolvedValue(ffBlob);

    const result = await dispatchVideoExport(makeOptions());

    expect(result).toEqual({ blob: ffBlob, engine: "ffmpeg" });
    expect(exportVideoWithStopwatchWebCodecs).not.toHaveBeenCalled();
    expect(exportVideoWithStopwatch).toHaveBeenCalledTimes(1);
  });
});

describe("dispatchVideoExport — 実行時フォールバック (最重要: PM必須リスク3)", () => {
  it("[V-18] capability check=true だが webcodecs-export-pipeline が実行時に throw → ffmpeg 版に自動フォールバックし成功する", async () => {
    vi.mocked(checkWebCodecsSupport).mockResolvedValue(true);
    vi.mocked(exportVideoWithStopwatchWebCodecs).mockRejectedValue(new Error("mid-encode failure"));
    const ffBlob = new Blob(["ff-fallback"], { type: "video/mp4" });
    vi.mocked(exportVideoWithStopwatch).mockResolvedValue(ffBlob);

    // throw されず正常に resolve すること自体が「エラーをユーザーに見せない」契約の検証
    await expect(dispatchVideoExport(makeOptions())).resolves.toEqual({ blob: ffBlob, engine: "ffmpeg" });
    expect(exportVideoWithStopwatch).toHaveBeenCalledTimes(1);
  });

  it("[V-18] フォールバック時、ffmpeg 版は dispatchVideoExport が受け取った単一 ExportVideoOptions オブジェクトをそのまま (改変せず) 1個の引数で受け取る", async () => {
    // 案A でシグネチャが「9引数の分解」から「単一 options オブジェクト」に変わったため、
    // 単なる旧シグネチャのハードコード更新ではなく、以下2点を独立に検証する:
    //   1. 呼び出し引数の個数が1個であること (分解引数への先祖返りをしていないか)
    //   2. options に含まれる、この分岐で特に重要な値 (splitTimes/isFinished/summaryImageData/
    //      finishTime) が「WebCodecs 専用引数 (raceDistance 等) も含めて」欠落・改変なく
    //      渡っていること — フォールバック時に「WebCodecs 用に一部整形された引数」が
    //      間違って ffmpeg 版に渡ってしまう回帰を検出する
    vi.mocked(checkWebCodecsSupport).mockResolvedValue(true);
    vi.mocked(exportVideoWithStopwatchWebCodecs).mockRejectedValue(new Error("boom"));
    vi.mocked(exportVideoWithStopwatch).mockResolvedValue(new Blob(["ff"], { type: "video/mp4" }));

    const splitTimes = [{ distance: 50, time: 25, lapTime: 25, memo: "test" }];
    const summaryImageData = new Blob(["png"]);
    const options = makeOptions({
      finishTime: 45,
      isFinished: true,
      summaryImageData,
      splitTimes,
      raceDistance: 100,
    });
    await dispatchVideoExport(options);

    expect(exportVideoWithStopwatch).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(exportVideoWithStopwatch).mock.calls[0];
    expect(callArgs).toHaveLength(1);

    const passedOptions = callArgs[0];
    expect(passedOptions).toBe(options); // 参照同一 (再構築・部分コピーされていない)
    expect(passedOptions.splitTimes).toBe(splitTimes);
    expect(passedOptions.isFinished).toBe(true);
    expect(passedOptions.finishTime).toBe(45);
    expect(passedOptions.summaryImageData).toBe(summaryImageData);
    expect(passedOptions.raceDistance).toBe(100);
  });

  it("[V-20] フォールバック発生時、ffmpeg 版を呼ぶ前に onProgress(0) でリセットする", async () => {
    vi.mocked(checkWebCodecsSupport).mockResolvedValue(true);
    vi.mocked(exportVideoWithStopwatchWebCodecs).mockRejectedValue(new Error("boom"));
    vi.mocked(exportVideoWithStopwatch).mockResolvedValue(new Blob(["ff"], { type: "video/mp4" }));

    const onProgress = vi.fn();
    await dispatchVideoExport(makeOptions({ onProgress }));

    expect(onProgress).toHaveBeenCalledWith(0);
  });

  it("[V-18] WebCodecs 側が例外を投げても、その後 ffmpeg 版が呼ばれる前に他の副作用 (options変更) が起きない", async () => {
    vi.mocked(checkWebCodecsSupport).mockResolvedValue(true);
    vi.mocked(exportVideoWithStopwatchWebCodecs).mockRejectedValue(new Error("mid-encode failure"));
    vi.mocked(exportVideoWithStopwatch).mockResolvedValue(new Blob(["ff"], { type: "video/mp4" }));

    const options = makeOptions();
    const snapshotBefore = { ...options };
    await dispatchVideoExport(options);

    // options 自体 (プリミティブ値・参照) が dispatcher によって書き換えられていないこと
    expect(options).toMatchObject(snapshotBefore);
  });

  it("[V-18] webcodecs-export-pipeline が reject しても、checkWebCodecsSupport が false のときと同じ ffmpeg 呼び出し引数になる (フォールバック経路の一貫性)", async () => {
    vi.mocked(checkWebCodecsSupport).mockResolvedValue(true);
    vi.mocked(exportVideoWithStopwatchWebCodecs).mockRejectedValue(new Error("boom"));
    vi.mocked(exportVideoWithStopwatch).mockResolvedValue(new Blob(["ff"], { type: "video/mp4" }));

    const options = makeOptions();
    await dispatchVideoExport(options);

    const fallbackArgs = vi.mocked(exportVideoWithStopwatch).mock.calls[0];

    vi.clearAllMocks();
    vi.mocked(checkWebCodecsSupport).mockResolvedValue(false);
    vi.mocked(exportVideoWithStopwatch).mockResolvedValue(new Blob(["ff"], { type: "video/mp4" }));
    await dispatchVideoExport(options);
    const directArgs = vi.mocked(exportVideoWithStopwatch).mock.calls[0];

    expect(fallbackArgs).toEqual(directArgs);
  });

  it("[C2再検証] 非AAC音声によるWebCodecsUnsupportedError (webcodecs-audio-passthrough由来) でも、他の実行時エラーと同様にffmpeg版へフォールバックし、音声を保持したまま完了する", async () => {
    // webcodecs-audio-passthrough.ts の setupAudioPassthrough は非AAC音声のとき
    // WebCodecsUnsupportedError を throw する (単体テスト: webcodecs-audio-passthrough.test.ts で確認済み)。
    // dispatcher にとってはそれも「WebCodecs実行時エラーの一種」であり、特別扱いせず
    // 汎用のフォールバック機構でffmpeg版に処理を委ねる。ffmpeg版は常に `-c:a aac` で
    // 音声を再エンコードするため (apps/web/src/lib/video/export-pipeline.ts で確認済み)、
    // 「音声が保持される (無音にならない)」という契約はffmpeg版が既に満たしている。
    vi.mocked(checkWebCodecsSupport).mockResolvedValue(true);
    vi.mocked(exportVideoWithStopwatchWebCodecs).mockRejectedValue(
      new WebCodecsUnsupportedError("Audio track uses codec 'opus', which cannot be passed through to MP4"),
    );
    const ffBlobWithAudio = new Blob(["ff-with-aac-audio"], { type: "video/mp4" });
    vi.mocked(exportVideoWithStopwatch).mockResolvedValue(ffBlobWithAudio);

    const result = await dispatchVideoExport(makeOptions());

    expect(result).toEqual({ blob: ffBlobWithAudio, engine: "ffmpeg" });
    expect(exportVideoWithStopwatch).toHaveBeenCalledTimes(1);
  });
});

describe("dispatchVideoExport — 出力の一貫性", () => {
  it("[V-19] WebCodecs 経路の結果は engine:\"webcodecs\" タグ付きで返る", async () => {
    vi.mocked(checkWebCodecsSupport).mockResolvedValue(true);
    const blob = new Blob(["wc"], { type: "video/mp4" });
    vi.mocked(exportVideoWithStopwatchWebCodecs).mockResolvedValue(blob);

    const result = await dispatchVideoExport(makeOptions());
    expect(result.engine).toBe("webcodecs");
    expect(result.blob.type).toBe("video/mp4");
  });

  it("[V-19] ffmpeg 経路の結果は engine:\"ffmpeg\" タグ付きで返る", async () => {
    vi.mocked(checkWebCodecsSupport).mockResolvedValue(false);
    const blob = new Blob(["ff"], { type: "video/mp4" });
    vi.mocked(exportVideoWithStopwatch).mockResolvedValue(blob);

    const result = await dispatchVideoExport(makeOptions());
    expect(result.engine).toBe("ffmpeg");
    expect(result.blob.type).toBe("video/mp4");
  });
});
