import type { DetectedSignal } from "@swimhub-timer/shared";
import { BEEP_FREQUENCY_RANGE, FFT_WINDOW_SIZE, FFT_HOP_SIZE } from "@swimhub-timer/shared";
import { applyHannWindow, computeMagnitudeSpectrum } from "./audio-utils";

interface AudioData {
  pcmData: Float32Array;
  sampleRate: number;
  duration: number;
}

/**
 * Detect the electronic start beep in swimming race audio.
 *
 * Race sequence: whistles -> "Take your mark" -> Electronic beep (START).
 *
 * Detection strategy - look for a **sustained pure tone** in 800-3500Hz:
 *   1. For each STFT frame, find the dominant frequency in the beep band.
 *   2. Compute "tonality" - how much energy is concentrated around that peak.
 *      Pure tones (beep) score high; broadband sounds (speech, crowd) score low.
 *   3. Find consecutive runs of high-tonality frames lasting >= 150ms.
 *   4. Reject runs whose dominant frequency sits in the whistle range (> 2500Hz).
 *   5. Return the last qualifying run (beep comes after whistles).
 */
export function detectStartSignal(audioData: AudioData): DetectedSignal | null {
  const { pcmData, sampleRate } = audioData;
  const windowSize = FFT_WINDOW_SIZE;
  const hopSize = FFT_HOP_SIZE;
  const numWindows = Math.floor((pcmData.length - windowSize) / hopSize);

  if (numWindows < 2) return null;

  const binResolution = sampleRate / windowSize;
  const beepLowBin = Math.floor(BEEP_FREQUENCY_RANGE.low / binResolution);
  const beepHighBin = Math.ceil(BEEP_FREQUENCY_RANGE.high / binResolution);

  // --- Step 1: Compute per-frame tonality and dominant frequency ---
  const frameTonality: number[] = [];
  const frameDominantFreq: number[] = [];
  const frameEnergy: number[] = [];

  for (let i = 0; i < numWindows; i++) {
    const offset = i * hopSize;
    const windowData = new Float32Array(windowSize);
    windowData.set(pcmData.subarray(offset, offset + windowSize));

    applyHannWindow(windowData);
    const spectrum = computeMagnitudeSpectrum(windowData);

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

    frameTonality.push(tonality);
    frameDominantFreq.push(dominantFreq);
    frameEnergy.push(totalEnergy);
  }

  // --- Step 2: Find sustained high-tonality runs ---
  const tonalityThreshold = 0.35;

  const sortedEnergy = [...frameEnergy].sort((a, b) => a - b);
  const medianEnergy = sortedEnergy[Math.floor(sortedEnergy.length / 2)];
  if (medianEnergy === undefined) return null; // sortedEnergy.length === numWindows, and numWindows >= 2
                                                  // is already checked above; guard is defensive against drift
  const energyThreshold = medianEnergy * 0.5;

  const minRunFrames = Math.ceil((0.15 * sampleRate) / hopSize);
  const maxGapFrames = 2;

  interface ToneRun {
    startFrame: number;
    endFrame: number;
    avgFreq: number;
    avgTonality: number;
    totalEnergy: number;
  }

  const runs: ToneRun[] = [];
  let runStart = -1;
  let gapCount = 0;

  for (let i = 0; i < numWindows; i++) {
    const tonality = frameTonality[i];
    const energy = frameEnergy[i];
    if (tonality === undefined || energy === undefined) continue; // frameTonality/frameEnergy have
      // exactly numWindows entries pushed in the loop above; guard is defensive only
    const isTonal = tonality >= tonalityThreshold && energy >= energyThreshold;

    if (isTonal) {
      if (runStart === -1) {
        runStart = i;
        gapCount = 0;
      } else {
        gapCount = 0;
      }
    } else {
      if (runStart !== -1) {
        gapCount++;
        if (gapCount > maxGapFrames) {
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
  let bestRun: ToneRun | null = null;

  if (beepRuns.length > 0) {
    const scored = beepRuns.map((r) => ({
      run: r,
      score: r.totalEnergy * r.avgTonality,
    }));
    const maxScore = Math.max(...scored.map((s) => s.score));
    const topCandidates = scored.filter((s) => s.score >= maxScore * 0.5);
    const top = topCandidates[topCandidates.length - 1];
    if (top) bestRun = top.run;
  }
  // If only whistle-range runs were found, do NOT fall back to a whistle — it's
  // not the start beep. Return null so the user sets the start manually.

  if (!bestRun) return null;

  const timeInSeconds = (bestRun.startFrame * hopSize) / sampleRate;
  const confidence = bestRun.avgTonality;

  return { time: timeInSeconds, confidence };
}

function buildRun(
  startFrame: number,
  endFrame: number,
  frameDominantFreq: number[],
  frameTonality: number[],
  frameEnergy: number[],
) {
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
