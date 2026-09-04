/**
 * Sprint Contract テスト — Phase B 実装済み (QA)
 * 対象: apps/web/src/lib/video/export-pipeline.ts (exportVideoWithStopwatch)
 *
 * 案A (Sprint Contract): 動的要素 (タイマー/スプリットバッジ/透かし) はもう drawtext
 * フィルタで手書き再実装しない。共有 overlay-renderer 経由の透過PNG連番生成
 * (overlay-png-sequence.ts) を ffmpeg の overlay フィルタで合成する。
 *
 * 依存モジュール (ffmpeg-manager / webcodecs-source-probe / webcodecs-export-pipeline の
 * loadWatermarkIcon / overlay-png-sequence) を vi.mock で差し替え、
 * exportVideoWithStopwatch 自身のオーケストレーション (どの入力でffmpegに何を渡すか) だけを
 * 検証する。実際の描画分岐 (elapsed計算・スプリット判定等) は overlay-frame-renderer.test.ts、
 * PNG連番生成のフレーム数/onFrame契約は overlay-png-sequence.test.ts の担当。
 * `webcodecs-encoder-config.ts` (buildExportDimensions/scaleStopwatchConfigForExport) は
 * 純粋関数でモックせず実物を使い、期待値は仕様の計算式から独立に手計算する
 * (実装内部変数のコピーにしない)。
 *
 * 検証対象の Sprint Contract 項目:
 *   V-06/V-07/V-08: splitTimes/isFinished/finishTime/showWatermark がそのまま
 *         PNG連番生成に渡る (回帰なし)
 *   V-08: フィニッシュサマリー (単一PNG事前生成方式) の合成有無・enable式が変更されない
 *   V-09: PNG連番生成に渡す width/height/fps/durationSeconds がプローブ結果と
 *         exportSettings.resolution から正しく計算される
 *   V-10/V-11: ffmpeg.exec に渡すフィルタグラフが overlay 経由で合成し、
 *         drawtext フィルタ文字列を一切含まない
 *   V-12: resolution!="original" のとき stopwatchConfig が比率スケールされる
 *   V-14: 音声トラックが -c:a aac で再エンコードされ、-map 0:a? が維持される
 *
 * トートロジー回避: 「ffmpeg exec の引数に overlay が含まれる」ことだけでなく、
 * 具体的な数値 (summaryEnableT・スケール後の fontSize 等) を仕様の計算式から
 * 独立に算出し、実装の中間変数コピーにならないようにする。
 *
 * 型注記: 各テストは対象関数を await 済みなので、その関数が呼ぶはずの
 * generateOverlayPngSequence / fakeFFmpeg.exec は既に呼ばれている前提で
 * `.mock.calls[0]!` を使う。呼ばれていなければ直後の `[0]` アクセスがそのまま
 * ランタイムエラーになり、テストは (アサーション失敗として) 検出できる。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_STOPWATCH_CONFIG, SUMMARY_DELAY_SECONDS } from "@swimhub-timer/shared";
import type { ExportVideoOptions } from "../webcodecs-types";

vi.mock("../ffmpeg-manager", () => ({
  ffmpegManager: { load: vi.fn() },
  fetchFile: vi.fn(),
}));
vi.mock("../webcodecs-source-probe", () => ({ probeVideoSource: vi.fn() }));
vi.mock("../webcodecs-export-pipeline", () => ({ loadWatermarkIcon: vi.fn() }));
vi.mock("../overlay-png-sequence", () => ({
  generateOverlayPngSequence: vi.fn(),
  overlayPngFileName: vi.fn((index: number) => `overlay_${String(index).padStart(5, "0")}.png`),
}));

import { exportVideoWithStopwatch } from "../export-pipeline";
import { ffmpegManager, fetchFile } from "../ffmpeg-manager";
import { probeVideoSource } from "../webcodecs-source-probe";
import { loadWatermarkIcon } from "../webcodecs-export-pipeline";
import { generateOverlayPngSequence } from "../overlay-png-sequence";

function makeFakeFFmpeg() {
  return {
    writeFile: vi.fn(async (..._args: [string, Uint8Array | string]) => {}),
    readFile: vi.fn(async (..._args: [string]) => new Uint8Array([9, 9, 9])),
    exec: vi.fn(async (..._args: [string[]]) => {}),
  };
}

function makeProbeResult(overrides: Partial<{ displayWidth: number; displayHeight: number; fps: number; duration: number }> = {}) {
  const { displayWidth = 1920, displayHeight = 1080, fps = 30, duration = 2 } = overrides;
  return {
    input: {},
    videoTrack: {
      getDurationFromMetadata: vi.fn(async () => duration),
      computeDuration: vi.fn(async () => duration),
    },
    displayWidth,
    displayHeight,
    fps,
  };
}

function makeOptions(overrides: Partial<ExportVideoOptions> = {}): ExportVideoOptions {
  return {
    videoFile: new File(["dummy"], "race.mp4", { type: "video/mp4" }),
    startSignalTime: 5,
    stopwatchConfig: DEFAULT_STOPWATCH_CONFIG,
    originalVideoWidth: 1920,
    originalVideoHeight: 1080,
    exportSettings: { resolution: "original" },
    onProgress: vi.fn(),
    showWatermark: false,
    splitTimes: [],
    isFinished: false,
    finishTime: null,
    raceDistance: null,
    summaryImageData: null,
    ...overrides,
  };
}

let fakeFFmpeg: ReturnType<typeof makeFakeFFmpeg>;

beforeEach(() => {
  vi.clearAllMocks();
  fakeFFmpeg = makeFakeFFmpeg();
  vi.mocked(ffmpegManager.load).mockResolvedValue(fakeFFmpeg as never);
  vi.mocked(fetchFile).mockResolvedValue(new Uint8Array([1, 2, 3]) as never);
  vi.mocked(probeVideoSource).mockResolvedValue(makeProbeResult() as never);
  vi.mocked(loadWatermarkIcon).mockResolvedValue(null);
  // Default: resolve without invoking onFrame, so tests that don't care about the
  // per-frame callback aren't affected by it. Dedicated tests below override this to
  // actually invoke onFrame (matching the real module's contract).
  vi.mocked(generateOverlayPngSequence).mockResolvedValue({ frameCount: 60 });
});

describe("exportVideoWithStopwatch — 回帰固定: onFrame コールバックの TDZ 参照禁止", () => {
  // QA が Phase B 冒頭で検出した Critical バグの回帰テスト:
  // `const { frameCount } = await generateOverlayPngSequence(...)` という書き方だと、
  // onFrame は generateOverlayPngSequence 自身の解決前 (= 分割代入の完了前) に実行されるため、
  // onFrame 内から frameCount を参照すると ReferenceError (TDZ) で1フレーム目から必ず失敗する
  // (実際に発生を確認し Developer に差し戻し済み — 現在の実装は `computeOverlayFrameCount` +
  // `durationSeconds`/`fps`/`index` から進捗を独立算出する方式に修正されている)。
  // 将来またこのパターンが復活しないことを onFrame を自身の解決前に呼ぶモックで固定する。
  it(
    "[回帰] generateOverlayPngSequence が実際の契約通り onFrame を自身の解決前に呼んでも、" +
      "exportVideoWithStopwatch は reject せず正常に完了する (frameCount の TDZ 参照が" +
      "再発していないことの固定)",
    async () => {
      vi.mocked(generateOverlayPngSequence).mockImplementation(async (opts) => {
        await opts.onFrame(0, new Uint8Array([1, 2, 3]));
        return { frameCount: 2 };
      });

      await expect(exportVideoWithStopwatch(makeOptions())).resolves.toBeInstanceOf(Blob);
    },
  );

  it("[回帰] onFrame 呼び出し時に onProgress が (NaN ではない) 有限の数値で呼ばれる", async () => {
    const onProgress = vi.fn();
    vi.mocked(probeVideoSource).mockResolvedValue(makeProbeResult({ fps: 30, duration: 2 }) as never);
    vi.mocked(generateOverlayPngSequence).mockImplementation(async (opts) => {
      await opts.onFrame(0, new Uint8Array([1, 2, 3]));
      await opts.onFrame(29, new Uint8Array([1, 2, 3]));
      return { frameCount: 60 };
    });

    await exportVideoWithStopwatch(makeOptions({ onProgress }));

    for (const call of onProgress.mock.calls) {
      expect(Number.isFinite(call[0])).toBe(true);
    }
  });
});

describe("exportVideoWithStopwatch — PNG連番生成への入力 (V-09)", () => {
  it("[V-09] resolution=original のとき width/height はプローブされた displayWidth/Height、fps/durationSeconds はプローブ結果そのまま", async () => {
    vi.mocked(probeVideoSource).mockResolvedValue(makeProbeResult({ displayWidth: 1280, displayHeight: 720, fps: 25, duration: 4 }) as never);

    await exportVideoWithStopwatch(makeOptions({ originalVideoWidth: 1280, originalVideoHeight: 720, exportSettings: { resolution: "original" } }));

    const call = vi.mocked(generateOverlayPngSequence).mock.calls[0]![0];
    expect(call.width).toBe(1280);
    expect(call.height).toBe(720);
    expect(call.fps).toBe(25);
    expect(call.durationSeconds).toBe(4);
  });

  it("[V-09] originalVideoWidth/Height が 0 (未確定) のときはプローブの displayWidth/Height にフォールバックする", async () => {
    vi.mocked(probeVideoSource).mockResolvedValue(makeProbeResult({ displayWidth: 1920, displayHeight: 1080 }) as never);

    await exportVideoWithStopwatch(makeOptions({ originalVideoWidth: 0, originalVideoHeight: 0 }));

    const call = vi.mocked(generateOverlayPngSequence).mock.calls[0]![0];
    expect(call.width).toBe(1920);
    expect(call.height).toBe(1080);
  });

  it("[V-09] resolution=720 のとき出力サイズが 16:9 比率で高さ720にスケールされる (buildExportDimensions と同じ仕様)", async () => {
    await exportVideoWithStopwatch(
      makeOptions({ originalVideoWidth: 1920, originalVideoHeight: 1080, exportSettings: { resolution: "720" } }),
    );

    const call = vi.mocked(generateOverlayPngSequence).mock.calls[0]![0];
    // 1920x1080 (16:9) を高さ720にスケール → 幅は 720*16/9=1280 (偶数)
    expect(call.height).toBe(720);
    expect(call.width).toBe(1280);
  });
});

describe("exportVideoWithStopwatch — 解像度スケーリングの比例維持 (V-12)", () => {
  it("[V-12] resolution=720, originalVideoHeight=1080 のとき fontSize/padding/borderRadius が 720/1080 比率でスケールされる", async () => {
    await exportVideoWithStopwatch(
      makeOptions({ originalVideoHeight: 1080, exportSettings: { resolution: "720" }, stopwatchConfig: DEFAULT_STOPWATCH_CONFIG }),
    );

    const call = vi.mocked(generateOverlayPngSequence).mock.calls[0]![0];
    // 独立算出: resScale = 720/1080 = 0.6666...
    // DEFAULT_STOPWATCH_CONFIG = classic-digital (fontSize:130, padding:12, borderRadius:4)
    expect(call.stopwatchConfig.fontSize).toBe(87); // Math.round(130*2/3)=87
    expect(call.stopwatchConfig.padding).toBe(8); // Math.round(12*2/3)=8
    expect(call.stopwatchConfig.borderRadius).toBe(3); // Math.round(4*2/3)=3
  });

  it("[V-12] resolution=original のときスケーリングされない (fontSize/padding/borderRadius が入力と同一)", async () => {
    await exportVideoWithStopwatch(makeOptions({ exportSettings: { resolution: "original" } }));

    const call = vi.mocked(generateOverlayPngSequence).mock.calls[0]![0];
    expect(call.stopwatchConfig.fontSize).toBe(DEFAULT_STOPWATCH_CONFIG.fontSize);
    expect(call.stopwatchConfig.padding).toBe(DEFAULT_STOPWATCH_CONFIG.padding);
    expect(call.stopwatchConfig.borderRadius).toBe(DEFAULT_STOPWATCH_CONFIG.borderRadius);
  });

  it("[V-03][V-04] fontFamily/backgroundColor/textColor は変換されずそのまま渡る (色/フォントはスケール対象外)", async () => {
    const config = { ...DEFAULT_STOPWATCH_CONFIG, fontFamily: "sans-serif" as const, backgroundColor: "rgba(200,30,30,0.85)", textColor: "#FFFFFF" };
    await exportVideoWithStopwatch(makeOptions({ stopwatchConfig: config, exportSettings: { resolution: "720" } }));

    const call = vi.mocked(generateOverlayPngSequence).mock.calls[0]![0];
    expect(call.stopwatchConfig.fontFamily).toBe("sans-serif");
    expect(call.stopwatchConfig.backgroundColor).toBe("rgba(200,30,30,0.85)");
    expect(call.stopwatchConfig.textColor).toBe("#FFFFFF");
  });
});

describe("exportVideoWithStopwatch — 動的要素の受け渡し (V-06/V-07)", () => {
  it("[V-06] splitTimes がそのまま PNG連番生成に渡る", async () => {
    const splitTimes = [{ distance: 50, time: 25, lapTime: 25, memo: "test" }];
    await exportVideoWithStopwatch(makeOptions({ splitTimes }));
    const call = vi.mocked(generateOverlayPngSequence).mock.calls[0]![0];
    expect(call.splitTimes).toBe(splitTimes);
  });

  it("[V-07] showWatermark=false のとき loadWatermarkIcon が呼ばれず watermarkIcon=null が渡る", async () => {
    await exportVideoWithStopwatch(makeOptions({ showWatermark: false }));
    expect(loadWatermarkIcon).not.toHaveBeenCalled();
    const call = vi.mocked(generateOverlayPngSequence).mock.calls[0]![0];
    expect(call.watermarkIcon).toBeNull();
    expect(call.showWatermark).toBe(false);
  });

  it("[V-07] showWatermark=true のとき loadWatermarkIcon が呼ばれ、その解決値が watermarkIcon として渡る", async () => {
    const icon = { fake: "icon" };
    vi.mocked(loadWatermarkIcon).mockResolvedValue(icon as never);
    await exportVideoWithStopwatch(makeOptions({ showWatermark: true }));
    expect(loadWatermarkIcon).toHaveBeenCalledTimes(1);
    const call = vi.mocked(generateOverlayPngSequence).mock.calls[0]![0];
    expect(call.watermarkIcon).toBe(icon);
    expect(call.showWatermark).toBe(true);
  });

  it("[V-07][異常系] アイコン取得に失敗 (loadWatermarkIcon が null を返す) してもエクスポート自体は失敗しない", async () => {
    vi.mocked(loadWatermarkIcon).mockResolvedValue(null);
    await expect(exportVideoWithStopwatch(makeOptions({ showWatermark: true }))).resolves.toBeInstanceOf(Blob);
  });

  it("[異常系] splitTimes=[] (スプリットなし) でも正常に完了する", async () => {
    await expect(exportVideoWithStopwatch(makeOptions({ splitTimes: [] }))).resolves.toBeInstanceOf(Blob);
  });
});

describe("exportVideoWithStopwatch — フィニッシュサマリー (V-08)", () => {
  it("[V-08] summaryImageData と finishTime が両方渡されたとき summary.png が書き込まれ、overlay 合成が2段構成になる", async () => {
    // jsdom の Blob には arrayBuffer() が無いため、実装が呼ぶ `await summaryImageData.arrayBuffer()`
    // を満たす最小限のダックタイピングにする。
    const summaryImageData = {
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as unknown as Blob;
    await exportVideoWithStopwatch(makeOptions({ summaryImageData, finishTime: 45, isFinished: true, startSignalTime: 5 }));

    expect(fakeFFmpeg.writeFile).toHaveBeenCalledWith("summary.png", expect.any(Uint8Array));
    const execArgs = vi.mocked(fakeFFmpeg.exec).mock.calls[0]![0] as string[];
    const filterComplexIndex = execArgs.indexOf("-filter_complex");
    const filterComplex = execArgs[filterComplexIndex + 1];

    // 独立算出: summaryEnableT = (startSignalTime+finishTime+SUMMARY_DELAY_SECONDS).toFixed(3)
    const expectedEnableT = (5 + 45 + SUMMARY_DELAY_SECONDS).toFixed(3);
    expect(filterComplex).toContain(`enable='gte(t,${expectedEnableT})'`);
    expect(filterComplex).toContain("[timed][sum]overlay=0:0");
    expect(execArgs).toContain("summary.png");
  });

  it("[V-08] summaryImageData=null かつ finishTime=null (未フィニッシュ) のとき summary.png は書き込まれず、overlayは1段構成のまま", async () => {
    await exportVideoWithStopwatch(makeOptions({ summaryImageData: null, finishTime: null, isFinished: false }));

    expect(fakeFFmpeg.writeFile).not.toHaveBeenCalledWith("summary.png", expect.anything());
    const execArgs = vi.mocked(fakeFFmpeg.exec).mock.calls[0]![0] as string[];
    const filterComplexIndex = execArgs.indexOf("-filter_complex");
    const filterComplex = execArgs[filterComplexIndex + 1];
    expect(filterComplex).not.toContain("[sum]");
    expect(filterComplex).not.toContain("enable=");
    // -map で最終出力ラベルが timed のまま (v ラベルへの切り替えなし)
    expect(execArgs).toEqual(expect.arrayContaining(["-map", "[timed]"]));
  });

  it("[V-08] finishTime=null のとき (summaryImageData だけ渡されても) サマリー合成に入らない", async () => {
    const summaryImageData = { arrayBuffer: async () => new Uint8Array([1]).buffer } as unknown as Blob;
    await exportVideoWithStopwatch(makeOptions({ summaryImageData, finishTime: null }));
    expect(fakeFFmpeg.writeFile).not.toHaveBeenCalledWith("summary.png", expect.anything());
  });
});

describe("exportVideoWithStopwatch — drawtext 完全撤去 & overlay 合成経由 (V-10/V-11)", () => {
  it("[V-11] ffmpeg.exec の引数に drawtext フィルタ文字列が一切含まれない", async () => {
    await exportVideoWithStopwatch(makeOptions({ splitTimes: [{ distance: 50, time: 1, lapTime: 1, memo: "x" }], showWatermark: true }));
    const execArgs = vi.mocked(fakeFFmpeg.exec).mock.calls[0]![0] as string[];
    for (const arg of execArgs) {
      expect(arg).not.toContain("drawtext");
    }
  });

  it("[V-10] 第2入力として overlay_%05d.png の連番PNGが -framerate <fps> 付きで渡される", async () => {
    vi.mocked(probeVideoSource).mockResolvedValue(makeProbeResult({ fps: 29.97 }) as never);
    await exportVideoWithStopwatch(makeOptions());
    const execArgs = vi.mocked(fakeFFmpeg.exec).mock.calls[0]![0] as string[];
    // inputArgs = ["-i","input.mp4","-framerate",fps.toFixed(3),"-i","overlay_%05d.png"]
    const overlayInputIndex = execArgs.indexOf("overlay_%05d.png");
    expect(overlayInputIndex).toBeGreaterThan(0);
    expect(execArgs[overlayInputIndex - 1]).toBe("-i");
    expect(execArgs[overlayInputIndex - 2]).toBe((29.97).toFixed(3));
    expect(execArgs[overlayInputIndex - 3]).toBe("-framerate");
  });

  it("[V-10] メインの合成は overlay フィルタ ([bg][ovl]overlay=0:0) 経由であり、colorkey/chromakey は使わない", async () => {
    await exportVideoWithStopwatch(makeOptions());
    const execArgs = vi.mocked(fakeFFmpeg.exec).mock.calls[0]![0] as string[];
    const filterComplex = execArgs[execArgs.indexOf("-filter_complex") + 1];
    expect(filterComplex).toContain("[bg][ovl]overlay=0:0");
    expect(filterComplex).not.toContain("colorkey");
    expect(filterComplex).not.toContain("chromakey");
  });
});

describe("exportVideoWithStopwatch — 音声保持 (V-14)", () => {
  it("[V-14] -c:a aac で再エンコードされ、-map 0:a? で元の音声トラックを維持する", async () => {
    await exportVideoWithStopwatch(makeOptions());
    const execArgs = vi.mocked(fakeFFmpeg.exec).mock.calls[0]![0] as string[];
    expect(execArgs).toEqual(expect.arrayContaining(["-c:a", "aac", "-map", "0:a?"]));
  });
});

describe("exportVideoWithStopwatch — 異常系", () => {
  it("[異常系] ffmpeg.exec が失敗 (非0終了) すると reject し、失敗が握りつぶされない", async () => {
    vi.mocked(fakeFFmpeg.exec).mockRejectedValue(new Error("FFmpeg exec failed with exit code 1"));
    await expect(exportVideoWithStopwatch(makeOptions())).rejects.toThrow("FFmpeg exec failed");
  });

  it("[異常系] fetchFile (動画読み込み) が失敗すると reject する", async () => {
    vi.mocked(fetchFile).mockRejectedValue(new Error("failed to read video file"));
    await expect(exportVideoWithStopwatch(makeOptions())).rejects.toThrow("failed to read video file");
  });

  it("[境界値] durationSeconds が 0 に近い極端に短い動画でもクラッシュしない (PNG連番生成に委譲される)", async () => {
    vi.mocked(probeVideoSource).mockResolvedValue(makeProbeResult({ duration: 0.001 }) as never);
    await expect(exportVideoWithStopwatch(makeOptions())).resolves.toBeInstanceOf(Blob);
  });
});
