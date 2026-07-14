/**
 * Sprint Contract テスト — Phase B 追補 (Developer Critical修正 C2 の再検証)
 * 対象: apps/web/src/lib/video/webcodecs-audio-passthrough.ts (setupAudioPassthrough)
 *
 * 検証対象: 非AAC音声トラック、または decoderConfig が読めない音声トラックを
 * サイレントに無視して無音声動画を作らず、`WebCodecsUnsupportedError` を throw して
 * dispatcher 経由で ffmpeg エンジン (常に AAC へトランスコードする) にフォールバックさせること。
 *
 * 修正前の懸念: 非AAC音声は黙って無視され、書き出し後に音声が欠落する
 *   (エラーは出ないが機能的にはリグレッション)。
 * 修正後の期待: throw → dispatcher の catch → ffmpeg 経路 → 音声保持 (AACに再エンコード)。
 * この「throw した後、実際に ffmpeg 経路で音声が保持される」という後半の契約は
 * export-dispatcher.test.ts 側 (フォールバック機構の汎用テスト) でカバーする。
 */
import { describe, it, expect, vi } from "vitest";
import { WebCodecsUnsupportedError } from "../webcodecs-types";

vi.mock("mediabunny", () => ({
  EncodedAudioPacketSource: vi.fn().mockImplementation(() => ({ add: vi.fn(), close: vi.fn() })),
  EncodedPacketSink: vi.fn().mockImplementation(() => ({
    packets: async function* () {
      /* empty by default; individual tests override via track mocks, not this sink */
    },
  })),
}));

import { setupAudioPassthrough } from "../webcodecs-audio-passthrough";

function makeOutput() {
  return { addAudioTrack: vi.fn() } as unknown as import("mediabunny").Output;
}

describe("setupAudioPassthrough — C2: 非AAC/decoderConfig欠落のフォールバック誘発", () => {
  it("[C2] audioTrack=null (音声トラックなし) のときは null を返す (無音動画は正しい挙動)", async () => {
    const result = await setupAudioPassthrough(null, makeOutput());
    expect(result).toBeNull();
  });

  it("[C2] codec='aac' 以外 (例: opus) のとき WebCodecsUnsupportedError を throw する (無音フォールバックしない)", async () => {
    const track = {
      getCodec: vi.fn().mockResolvedValue("opus"),
      getDecoderConfig: vi.fn(),
    } as unknown as import("mediabunny").InputAudioTrack;

    await expect(setupAudioPassthrough(track, makeOutput())).rejects.toThrow(WebCodecsUnsupportedError);
    await expect(setupAudioPassthrough(track, makeOutput())).rejects.toThrow(/opus/);
  });

  it("[C2] codec が読めない (null/undefined) ときも WebCodecsUnsupportedError を throw する", async () => {
    const track = {
      getCodec: vi.fn().mockResolvedValue(null),
      getDecoderConfig: vi.fn(),
    } as unknown as import("mediabunny").InputAudioTrack;

    await expect(setupAudioPassthrough(track, makeOutput())).rejects.toThrow(WebCodecsUnsupportedError);
  });

  it("[C2] codec='aac' だが getDecoderConfig() が null を返すとき WebCodecsUnsupportedError を throw する", async () => {
    const track = {
      getCodec: vi.fn().mockResolvedValue("aac"),
      getDecoderConfig: vi.fn().mockResolvedValue(null),
    } as unknown as import("mediabunny").InputAudioTrack;

    await expect(setupAudioPassthrough(track, makeOutput())).rejects.toThrow(WebCodecsUnsupportedError);
    await expect(setupAudioPassthrough(track, makeOutput())).rejects.toThrow(/decoder configuration/);
  });

  it("[C2] codec='aac' かつ decoderConfig あり → 正常に handle を返し、addAudioTrack が呼ばれる (回帰確認: 正常系は壊れていない)", async () => {
    const track = {
      getCodec: vi.fn().mockResolvedValue("aac"),
      getDecoderConfig: vi.fn().mockResolvedValue({ codec: "mp4a.40.2" }),
    } as unknown as import("mediabunny").InputAudioTrack;
    const output = makeOutput();

    const handle = await setupAudioPassthrough(track, output);

    expect(handle).not.toBeNull();
    expect(handle?.run).toBeInstanceOf(Function);
    expect(vi.mocked(output.addAudioTrack)).toHaveBeenCalledTimes(1);
  });

  it("[C2] throw は addAudioTrack() が呼ばれる前に発生する (Output に不整合なトラックを追加しない)", async () => {
    const track = {
      getCodec: vi.fn().mockResolvedValue("vorbis"),
      getDecoderConfig: vi.fn(),
    } as unknown as import("mediabunny").InputAudioTrack;
    const output = makeOutput();

    await expect(setupAudioPassthrough(track, output)).rejects.toThrow(WebCodecsUnsupportedError);
    expect(vi.mocked(output.addAudioTrack)).not.toHaveBeenCalled();
  });
});
