import type { DetectedSignal } from "@swimhub-timer/shared";
import { BEEP_FREQUENCY_RANGE, FFT_WINDOW_SIZE, FFT_HOP_SIZE } from "@swimhub-timer/shared";
import { applyHannWindow, computeMagnitudeSpectrum } from "./audio-utils";

/**
 * Detect the electronic start beep in swimming race audio.
 *
 * Race sequence: whistles → "Take your mark" → Electronic beep (START).
 *
 * Detection strategy — look for a **sustained pure tone** in 800-3500Hz:
 *   1. For each STFT frame, find the dominant frequency in the beep band.
 *   2. Compute "tonality" — how much energy is concentrated around that peak.
 *      Pure tones (beep) score high; broadband sounds (speech, crowd) score low.
 *   3. Find consecutive runs of high-tonality frames lasting ≥ 150ms.
 *   4. Reject runs whose dominant frequency sits in the whistle range (> 2500Hz).
 *   5. Return the last qualifying run (beep comes after whistles).
 */
export function detectStartSignal(audioBuffer: AudioBuffer): DetectedSignal | null {
  const sampleRate = audioBuffer.sampleRate;
  const channelData = audioBuffer.getChannelData(0);
  const windowSize = FFT_WINDOW_SIZE;
  const hopSize = FFT_HOP_SIZE;
  const numWindows = Math.floor((channelData.length - windowSize) / hopSize);

  if (numWindows < 2) return null;

  const binResolution = sampleRate / windowSize; // Hz per bin
  const beepLowBin = Math.floor(BEEP_FREQUENCY_RANGE.low / binResolution);
  const beepHighBin = Math.ceil(BEEP_FREQUENCY_RANGE.high / binResolution);

  const frameTonality: number[] = new Array(numWindows);
  const frameDominantFreq: number[] = new Array(numWindows);
  const frameEnergy: number[] = new Array(numWindows);

  // Reuse a single window buffer across frames (avoids one Float32Array
  // allocation per STFT frame — thousands on a multi-minute clip).
  const windowData = new Float32Array(windowSize);

  for (let i = 0; i < numWindows; i++) {
    const feature = computeFrameFeature(
      channelData,
      i * hopSize,
      windowData,
      windowSize,
      beepLowBin,
      beepHighBin,
      binResolution,
    );
    frameTonality[i] = feature.tonality;
    frameDominantFreq[i] = feature.dominantFreq;
    frameEnergy[i] = feature.totalEnergy;
  }

  return selectBestRun(frameTonality, frameDominantFreq, frameEnergy, numWindows, sampleRate, hopSize);
}

/**
 * Chunked, non-blocking variant of {@link detectStartSignal}.
 *
 * The per-frame STFT loop is the expensive part (thousands of FFTs on a
 * multi-minute clip). Running it in one synchronous call freezes the main
 * thread for seconds. This version yields to the event loop periodically so
 * the UI stays responsive during detection, and reuses the window buffer.
 * The detection result is identical to the synchronous version.
 */
export async function detectStartSignalAsync(
  audioBuffer: AudioBuffer,
  onProgress?: (fraction: number) => void,
): Promise<DetectedSignal | null> {
  const sampleRate = audioBuffer.sampleRate;
  const channelData = audioBuffer.getChannelData(0);
  const windowSize = FFT_WINDOW_SIZE;
  const hopSize = FFT_HOP_SIZE;
  const numWindows = Math.floor((channelData.length - windowSize) / hopSize);

  if (numWindows < 2) return null;

  const binResolution = sampleRate / windowSize;
  const beepLowBin = Math.floor(BEEP_FREQUENCY_RANGE.low / binResolution);
  const beepHighBin = Math.ceil(BEEP_FREQUENCY_RANGE.high / binResolution);

  const frameTonality: number[] = new Array(numWindows);
  const frameDominantFreq: number[] = new Array(numWindows);
  const frameEnergy: number[] = new Array(numWindows);

  const windowData = new Float32Array(windowSize);
  const YIELD_EVERY = 256; // frames between event-loop yields

  for (let i = 0; i < numWindows; i++) {
    const feature = computeFrameFeature(
      channelData,
      i * hopSize,
      windowData,
      windowSize,
      beepLowBin,
      beepHighBin,
      binResolution,
    );
    frameTonality[i] = feature.tonality;
    frameDominantFreq[i] = feature.dominantFreq;
    frameEnergy[i] = feature.totalEnergy;

    if (i % YIELD_EVERY === 0) {
      onProgress?.(i / numWindows);
      // Real macrotask yield so pending input/paint can run between chunks.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return selectBestRun(frameTonality, frameDominantFreq, frameEnergy, numWindows, sampleRate, hopSize);
}

/** Compute tonality / dominant frequency / band energy for one STFT frame. */
function computeFrameFeature(
  channelData: Float32Array,
  offset: number,
  windowData: Float32Array,
  windowSize: number,
  beepLowBin: number,
  beepHighBin: number,
  binResolution: number,
): { tonality: number; dominantFreq: number; totalEnergy: number } {
  windowData.set(channelData.subarray(offset, offset + windowSize));

  applyHannWindow(windowData);
  const spectrum = computeMagnitudeSpectrum(windowData);

  // Find peak bin and total energy in beep band
  let peakBin = beepLowBin;
  let peakMag = 0;
  let totalEnergy = 0;

  for (let bin = beepLowBin; bin <= beepHighBin && bin < spectrum.length; bin++) {
    const mag = spectrum[bin];
    if (mag === undefined) continue; // bin < spectrum.length is enforced by the loop condition; guard is defensive only
    totalEnergy += mag;
    if (mag > peakMag) {
      peakMag = mag;
      peakBin = bin;
    }
  }

  // Tonality: energy within ±3 bins of peak / total energy in band
  // Pure tone → most energy near peak → high tonality
  const peakRadius = 3;
  let peakRegionEnergy = 0;
  for (
    let bin = Math.max(beepLowBin, peakBin - peakRadius);
    bin <= Math.min(beepHighBin, peakBin + peakRadius) && bin < spectrum.length;
    bin++
  ) {
    const mag = spectrum[bin];
    if (mag === undefined) continue; // bin < spectrum.length is enforced by the loop condition; guard is defensive only
    peakRegionEnergy += mag;
  }

  const tonality = totalEnergy > 0 ? peakRegionEnergy / totalEnergy : 0;
  const dominantFreq = peakBin * binResolution;

  return { tonality, dominantFreq, totalEnergy };
}

/** Steps 2-4: find sustained tone runs, reject whistles, pick the best. */
function selectBestRun(
  frameTonality: number[],
  frameDominantFreq: number[],
  frameEnergy: number[],
  numWindows: number,
  sampleRate: number,
  hopSize: number,
): DetectedSignal | null {
  // --- Step 2: Find sustained high-tonality runs ---
  // Adaptive tonality threshold: we want frames that are clearly tonal
  const tonalityThreshold = 0.35;

  // Also require minimum energy to ignore silence
  const sortedEnergy = [...frameEnergy].sort((a, b) => a - b);
  const medianEnergy = sortedEnergy[Math.floor(sortedEnergy.length / 2)];
  if (medianEnergy === undefined) return null; // sortedEnergy.length === numWindows, and numWindows >= 2
                                                  // is already checked by the caller; guard is defensive against drift
  const energyThreshold = medianEnergy * 0.5;

  // Minimum duration for a beep: ~150ms
  const minRunFrames = Math.ceil((0.15 * sampleRate) / hopSize);
  // Maximum gap allowed within a run (account for brief fluctuations)
  const maxGapFrames = 2;

  const runs: ToneRun[] = [];
  let runStart = -1;
  let gapCount = 0;

  for (let i = 0; i < numWindows; i++) {
    const tonality = frameTonality[i];
    const energy = frameEnergy[i];
    if (tonality === undefined || energy === undefined) continue; // frameTonality/frameEnergy are
      // pre-allocated with exactly numWindows entries and filled 1:1 by the caller; guard is defensive only
    const isTonal = tonality >= tonalityThreshold && energy >= energyThreshold;

    if (isTonal) {
      if (runStart === -1) {
        runStart = i;
        gapCount = 0;
      } else {
        gapCount = 0; // reset gap
      }
    } else {
      if (runStart !== -1) {
        gapCount++;
        if (gapCount > maxGapFrames) {
          // End of run
          const endFrame = i - gapCount;
          if (endFrame - runStart + 1 >= minRunFrames) {
            runs.push(buildRun(runStart, endFrame, frameDominantFreq, frameTonality, frameEnergy));
          }
          runStart = -1;
          gapCount = 0;
        }
      }
    }
  }
  // Flush last run
  if (runStart !== -1) {
    const endFrame = numWindows - 1 - gapCount;
    if (endFrame - runStart + 1 >= minRunFrames) {
      runs.push(buildRun(runStart, endFrame, frameDominantFreq, frameTonality, frameEnergy));
    }
  }

  if (runs.length === 0) return null;

  // --- Step 3: Filter out whistle runs (dominant freq > 2500Hz) ---
  const WHISTLE_FREQ_CUTOFF = 2500;
  const beepRuns = runs.filter((r) => r.avgFreq <= WHISTLE_FREQ_CUTOFF);

  // --- Step 4: Pick the best candidate ---
  // Prefer the last beep run (beep comes after whistles in the sequence)
  // But if there are multiple, pick the one with highest energy × tonality
  let bestRun: ToneRun | null = null;

  if (beepRuns.length > 0) {
    // Score = energy × tonality; among top scorers, prefer later ones
    const scored = beepRuns.map((r) => ({
      run: r,
      score: r.totalEnergy * r.avgTonality,
    }));
    const maxScore = Math.max(...scored.map((s) => s.score));
    // Candidates within 50% of max score
    const topCandidates = scored.filter((s) => s.score >= maxScore * 0.5);
    // Pick the latest among top candidates
    const top = topCandidates[topCandidates.length - 1];
    if (top) bestRun = top.run;
  }
  // If only whistle-range runs were found, do NOT fall back to a whistle — a
  // whistle is not the start beep. Return null so the user sets the start
  // manually, rather than presenting a confidently-wrong time.

  if (!bestRun) return null;

  // Return the start time of the tone run
  const timeInSeconds = (bestRun.startFrame * hopSize) / sampleRate;
  const confidence = bestRun.avgTonality;

  return { time: timeInSeconds, confidence };
}

interface ToneRun {
  startFrame: number;
  endFrame: number;
  avgFreq: number;
  avgTonality: number;
  totalEnergy: number;
}

function buildRun(
  startFrame: number,
  endFrame: number,
  frameDominantFreq: number[],
  frameTonality: number[],
  frameEnergy: number[],
): ToneRun {
  let freqSum = 0;
  let tonalSum = 0;
  let energySum = 0;
  let count = 0;
  for (let j = startFrame; j <= endFrame; j++) {
    const freq = frameDominantFreq[j];
    const tonal = frameTonality[j];
    const energy = frameEnergy[j];
    if (freq === undefined || tonal === undefined || energy === undefined) continue;
    // Caller guarantees startFrame/endFrame are within the arrays' bounds; guard is defensive only.
    freqSum += freq;
    tonalSum += tonal;
    energySum += energy;
    count++;
  }
  return {
    startFrame,
    endFrame,
    avgFreq: freqSum / count,
    avgTonality: tonalSum / count,
    totalEnergy: energySum,
  };
}
