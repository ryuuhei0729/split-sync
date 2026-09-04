interface AudioData {
  pcmData: Float32Array;
  sampleRate: number;
  duration: number;
}

const TARGET_SAMPLE_RATE = 44100;

/**
 * Check if FFmpeg native module is available (not available in Expo Go).
 */
export function isFFmpegAvailable(): boolean {
  try {
    const Constants = require("expo-constants").default;
    if (Constants.appOwnership === "expo") return false;
  } catch {
    // expo-constants not available, continue check
  }
  try {
    require("ffmpeg-kit-react-native");
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract audio from a video file as PCM data using FFmpeg.
 * Converts to mono 16-bit PCM WAV at 44100Hz.
 */
export async function extractAudioFromVideo(videoUri: string): Promise<AudioData> {
  if (!isFFmpegAvailable()) {
    throw new Error(
      "自動検出にはDevelopment Buildが必要です。\nExpo Goでは手動でスタート時刻をセットしてください。",
    );
  }

  const ffmpegModule = require("ffmpeg-kit-react-native");
  const FFmpegKit = ffmpegModule.FFmpegKit;
  const ReturnCode = ffmpegModule.ReturnCode;

  const { Paths, File } = require("expo-file-system") as typeof import("expo-file-system");
  const outputFile = new File(Paths.cache, "audio_extract.wav");
  const outputPath = outputFile.uri;

  // Convert video to WAV (mono, 16-bit PCM, 44100Hz)
  const command = `-y -i "${videoUri}" -vn -ac 1 -ar ${TARGET_SAMPLE_RATE} -acodec pcm_s16le "${outputPath}"`;

  const session = await FFmpegKit.execute(command);
  const returnCode = await session.getReturnCode();

  if (!ReturnCode.isSuccess(returnCode)) {
    const logs = await session.getLogsAsString();
    throw new Error(`FFmpeg audio extraction failed: ${logs}`);
  }

  // Read WAV file as bytes
  const bytes = await outputFile.bytes();
  const pcmData = parseWavBytes(bytes);

  // Clean up temp file
  try {
    outputFile.delete();
  } catch {
    // Ignore cleanup errors
  }

  return {
    pcmData,
    sampleRate: TARGET_SAMPLE_RATE,
    duration: pcmData.length / TARGET_SAMPLE_RATE,
  };
}

/**
 * Parse WAV file bytes and extract PCM data as Float32Array.
 * Expects 16-bit mono PCM WAV format.
 */
function parseWavBytes(bytes: Uint8Array): Float32Array {
  // Find "data" chunk
  let dataOffset = -1;
  let dataSize = 0;

  for (let i = 0; i < bytes.length - 8; i++) {
    if (
      bytes[i] === 0x64 && // 'd'
      bytes[i + 1] === 0x61 && // 'a'
      bytes[i + 2] === 0x74 && // 't'
      bytes[i + 3] === 0x61 // 'a'
    ) {
      const b4 = bytes[i + 4];
      const b5 = bytes[i + 5];
      const b6 = bytes[i + 6];
      const b7 = bytes[i + 7];
      if (b4 === undefined || b5 === undefined || b6 === undefined || b7 === undefined) {
        continue; // i < bytes.length - 8 guarantees i+7 < bytes.length; guard is defensive only
      }
      dataSize = b4 | (b5 << 8) | (b6 << 16) | (b7 << 24);
      dataOffset = i + 8;
      break;
    }
  }

  if (dataOffset === -1) {
    throw new Error("Invalid WAV file: data chunk not found");
  }

  // Convert 16-bit PCM samples to Float32 (-1.0 to 1.0)
  const numSamples = Math.floor(dataSize / 2);
  const pcmData = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const byteOffset = dataOffset + i * 2;
    // Little-endian 16-bit signed integer.
    // TODO(#14-B real-bug candidate): dataSize comes from the WAV header and is
    // never validated against bytes.length; a truncated/malformed video's
    // extracted audio could run byteOffset past the buffer. `?? 0` reproduces
    // the exact prior runtime behavior (bitwise OR coerced `undefined` to 0
    // via ToInt32), so this is not a behavior change — flagging because the
    // underlying lack of bounds/dataSize validation predates this fix.
    let sample = (bytes[byteOffset] ?? 0) | ((bytes[byteOffset + 1] ?? 0) << 8);
    if (sample >= 0x8000) sample -= 0x10000;
    pcmData[i] = sample / 32768;
  }

  return pcmData;
}

/**
 * Generate waveform visualization data by downsampling PCM data.
 * Returns peak values for each segment.
 */
export function generateWaveformData(pcmData: Float32Array, numBars: number = 200): Float32Array {
  const samplesPerBar = Math.floor(pcmData.length / numBars);
  const waveform = new Float32Array(numBars);

  for (let i = 0; i < numBars; i++) {
    let maxVal = 0;
    const start = i * samplesPerBar;
    const end = Math.min(start + samplesPerBar, pcmData.length);
    for (let j = start; j < end; j++) {
      const sample = pcmData[j];
      if (sample === undefined) continue; // end <= pcmData.length, so j is always in-bounds; guard is defensive only
      const abs = Math.abs(sample);
      if (abs > maxVal) maxVal = abs;
    }
    waveform[i] = maxVal;
  }

  return waveform;
}
