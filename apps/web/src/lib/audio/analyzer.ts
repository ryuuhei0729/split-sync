import type { AudioAnalysisResult } from "@swimhub-timer/shared";

/**
 * Extract AudioBuffer from a video/audio file using Web Audio API.
 */
export async function extractAudioBuffer(file: File): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer();
  const audioContext = new AudioContext();
  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    return audioBuffer;
  } finally {
    await audioContext.close();
  }
}

/**
 * Generate a downsampled waveform for visualization.
 * Returns peak amplitudes per bucket for display.
 */
export function generateWaveform(
  audioBuffer: AudioBuffer,
  targetSamples: number = 2000,
): Float32Array {
  const channelData = audioBuffer.getChannelData(0);
  const samplesPerBucket = Math.max(1, Math.floor(channelData.length / targetSamples));
  const outputLength = Math.ceil(channelData.length / samplesPerBucket);
  const waveform = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const start = i * samplesPerBucket;
    const end = Math.min(start + samplesPerBucket, channelData.length);
    let max = 0;
    for (let j = start; j < end; j++) {
      const sample = channelData[j];
      if (sample === undefined) continue; // end <= channelData.length, so j is always in-bounds; guard is defensive only
      const abs = Math.abs(sample);
      if (abs > max) max = abs;
    }
    waveform[i] = max;
  }

  return waveform;
}

/**
 * Analyze audio from a video file: extract buffer and generate waveform.
 */
export async function analyzeAudio(
  file: File,
  targetSamples?: number,
): Promise<AudioAnalysisResult & { audioBuffer: AudioBuffer }> {
  const audioBuffer = await extractAudioBuffer(file);
  const waveformData = generateWaveform(audioBuffer, targetSamples);

  return {
    audioBuffer,
    waveformData,
    duration: audioBuffer.duration,
    sampleRate: audioBuffer.sampleRate,
  };
}
