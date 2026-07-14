/**
 * Audio passthrough for the WebCodecs export pipeline — copies the source audio track's
 * already-encoded packets straight into the output container without decoding/re-encoding,
 * the WebCodecs-pipeline equivalent of ffmpeg's `-c:a copy`.
 */
import { EncodedAudioPacketSource, EncodedPacketSink, type InputAudioTrack, type Output } from "mediabunny";
import { WebCodecsUnsupportedError } from "./webcodecs-types";

// `EncodedAudioChunkMetadata` is a native WebCodecs DOM type (declared in lib.dom.d.ts /
// @types/dom-webcodecs, referenced ambiently by mediabunny's own .d.ts) — it isn't a named
// export of the "mediabunny" package itself, so it's used here unimported.

export interface AudioPassthroughHandle {
  /**
   * Streams every packet from the source audio track into the output. Call after
   * `output.start()`. `signal` is checked between packets so the loop stops promptly if
   * the sibling video loop fails first (see `webcodecs-export-pipeline.ts`'s abort
   * coordination — Reviewer C1).
   */
  run(signal: AbortSignal): Promise<void>;
}

/**
 * Connects the source audio track to the output and returns a handle to stream its
 * packets. Must be called *before* `output.start()` (mediabunny requires all tracks to
 * be added while the output is still `'pending'`); the returned `run()` must be called
 * after `start()`.
 *
 * Returns `null` only when there is no audio track at all — the export then simply
 * produces a video-only (silent) file, which is correct for a source that never had audio.
 *
 * Reviewer C2: if an audio track *is* present but (a) its codec isn't AAC, or (b) mediabunny
 * can't read a decoder config for it, this throws `WebCodecsUnsupportedError` instead of
 * silently skipping the track. Two independent reasons:
 *   - `EncodedAudioPacketSource.add()` requires `meta.decoderConfig` on (at least) the first
 *     packet; mediabunny's muxer path asserts on it and throws synchronously if it's absent,
 *     so silently passing `undefined` there would crash rather than degrade gracefully.
 *   - The video importer accepts webm (Opus/Vorbis audio). Passing a non-AAC codec through
 *     into an MP4 container would mux "successfully" but produce a file many MP4 players
 *     play back with no sound — a silent regression versus the ffmpeg engine, which always
 *     transcodes to AAC. Throwing here routes these cases to the ffmpeg fallback instead,
 *     which keeps the audio (transcoded to AAC) rather than losing it.
 * A video with no audio track at all is unaffected and still exports silently as before.
 */
export async function setupAudioPassthrough(
  track: InputAudioTrack | null,
  output: Output,
): Promise<AudioPassthroughHandle | null> {
  if (!track) return null;

  const codec = await track.getCodec();
  if (codec !== "aac") {
    throw new WebCodecsUnsupportedError(
      `Audio track uses codec '${codec ?? "unknown"}', which cannot be passed through to MP4 without ` +
        "re-encoding; falling back to the ffmpeg engine (which transcodes to AAC) instead of exporting silently.",
    );
  }

  const decoderConfig = await track.getDecoderConfig();
  if (!decoderConfig) {
    throw new WebCodecsUnsupportedError(
      "Audio track has no readable decoder configuration; cannot pass it through safely.",
    );
  }

  const source = new EncodedAudioPacketSource(codec);
  output.addAudioTrack(source);
  const meta: EncodedAudioChunkMetadata = { decoderConfig };

  return {
    async run(signal: AbortSignal) {
      try {
        const sink = new EncodedPacketSink(track);
        for await (const packet of sink.packets()) {
          if (signal.aborted) break;
          await source.add(packet, meta);
        }
      } finally {
        try {
          source.close();
        } catch {
          // Best-effort: the output may already be in an error/canceled state.
        }
      }
    },
  };
}
