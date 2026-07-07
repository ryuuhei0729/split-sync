/**
 * Opens a video file via mediabunny just far enough to read the primary video track's
 * rotation-corrected display dimensions and an estimated frame rate.
 *
 * Both the dispatcher's coarse capability gate (`checkWebCodecsSupport` in
 * `webcodecs-capability.ts`) and the real export pipeline
 * (`webcodecs-export-pipeline.ts`) call this same function on the same `File`, so they
 * always agree on width/height/fps. Before this existed, the dispatcher guessed a fixed
 * 30fps while the pipeline measured the source's real frame rate, which could make each
 * side pick a different AVC level for the *same* export — the exact "probe and configure
 * must match" property `webcodecs-capability.ts` otherwise guarantees. The redundant file
 * open this causes (dispatcher + pipeline each parse the container once) is cheap:
 * `computePacketStats` only reads a bounded number of packet *headers*, no video decode.
 */
import { ALL_FORMATS, BlobSource, Input, type InputVideoTrack } from "mediabunny";

export interface VideoSourceProbe {
  input: Input;
  videoTrack: InputVideoTrack;
  /** Rotation-corrected ("right way up") display dimensions. */
  displayWidth: number;
  displayHeight: number;
  /** Estimated frame rate, sampled cheaply (metadata-only, no decode). */
  fps: number;
}

/** Fallback frame rate assumption when the source track has no readable packets to sample. */
const DEFAULT_FPS_ASSUMPTION = 30;
/** Packets sampled to estimate frame rate — enough to be accurate, cheap enough to stay fast. */
const FPS_SAMPLE_PACKET_COUNT = 60;

export async function probeVideoSource(videoFile: File): Promise<VideoSourceProbe> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(videoFile) });

  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) {
    throw new Error("No video track found in the input file.");
  }

  const [displayWidth, displayHeight, { averagePacketRate }] = await Promise.all([
    videoTrack.getDisplayWidth(),
    videoTrack.getDisplayHeight(),
    videoTrack.computePacketStats(FPS_SAMPLE_PACKET_COUNT),
  ]);

  return {
    input,
    videoTrack,
    displayWidth,
    displayHeight,
    fps: averagePacketRate > 0 ? averagePacketRate : DEFAULT_FPS_ASSUMPTION,
  };
}
