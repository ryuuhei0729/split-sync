/**
 * Apply a Hann window function to the input data in-place.
 */
export function applyHannWindow(data: Float32Array): void {
  const N = data.length;
  for (let i = 0; i < N; i++) {
    const v = data[i];
    if (v === undefined) continue; // i < N === data.length is enforced by the loop condition; guard is defensive only
    data[i] = v * (0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1))));
  }
}

/**
 * Compute the magnitude spectrum using a radix-2 FFT.
 * Input must have a power-of-2 length.
 * Returns magnitude array of length N/2.
 */
export function computeMagnitudeSpectrum(data: Float32Array): Float32Array {
  const N = data.length;
  const real = new Float32Array(N);
  const imag = new Float32Array(N);
  real.set(data);

  fftInPlace(real, imag);

  const halfN = N / 2;
  const magnitudes = new Float32Array(halfN);
  for (let i = 0; i < halfN; i++) {
    const re = real[i];
    const im = imag[i];
    if (re === undefined || im === undefined) continue; // i < halfN <= N === real.length === imag.length; guard is defensive only
    magnitudes[i] = Math.sqrt(re * re + im * im);
  }
  return magnitudes;
}

/**
 * In-place iterative radix-2 FFT (Cooley-Tukey).
 */
function fftInPlace(real: Float32Array, imag: Float32Array): void {
  const N = real.length;
  const logN = Math.log2(N);

  // Bit-reversal permutation
  for (let i = 0; i < N; i++) {
    const j = bitReverse(i, logN);
    if (j > i) {
      const ri = real[i];
      const rj = real[j];
      const ii = imag[i];
      const ij = imag[j];
      // i, j are both < N: bitReverse mirrors the logN bits of a value < N,
      // which always stays < N; guard is defensive only.
      if (ri === undefined || rj === undefined || ii === undefined || ij === undefined) continue;
      real[i] = rj;
      real[j] = ri;
      imag[i] = ij;
      imag[j] = ii;
    }
  }

  // Butterfly stages
  for (let s = 1; s <= logN; s++) {
    const m = 1 << s;
    const halfM = m >> 1;
    const wReal = Math.cos((2 * Math.PI) / m);
    const wImag = -Math.sin((2 * Math.PI) / m);

    for (let k = 0; k < N; k += m) {
      let curReal = 1;
      let curImag = 0;

      for (let j = 0; j < halfM; j++) {
        const idxHi = k + j + halfM;
        const idxLo = k + j;
        const realHi = real[idxHi];
        const imagHi = imag[idxHi];
        const realLo = real[idxLo];
        const imagLo = imag[idxLo];
        // idxLo/idxHi stay within [0, N) for a power-of-2-length input
        // (the documented FFT precondition); guard is defensive only.
        if (
          realHi === undefined ||
          imagHi === undefined ||
          realLo === undefined ||
          imagLo === undefined
        ) {
          continue;
        }

        const tReal = curReal * realHi - curImag * imagHi;
        const tImag = curReal * imagHi + curImag * realHi;

        real[idxHi] = realLo - tReal;
        imag[idxHi] = imagLo - tImag;
        real[idxLo] = realLo + tReal;
        imag[idxLo] = imagLo + tImag;

        const nextReal = curReal * wReal - curImag * wImag;
        const nextImag = curReal * wImag + curImag * wReal;
        curReal = nextReal;
        curImag = nextImag;
      }
    }
  }
}

function bitReverse(x: number, bits: number): number {
  let result = 0;
  for (let i = 0; i < bits; i++) {
    result = (result << 1) | (x & 1);
    x >>= 1;
  }
  return result;
}

/**
 * Find peaks in an array that exceed the given threshold.
 * Returns indices of peaks.
 */
export function findPeaks(data: number[], threshold: number, minDistance: number = 10): number[] {
  const peaks: number[] = [];
  for (let i = 1; i < data.length - 1; i++) {
    const prev = data[i - 1];
    const curr = data[i];
    const next = data[i + 1];
    // 1 <= i <= data.length - 2, so i-1/i/i+1 stay within [0, data.length); guard is defensive only.
    if (prev === undefined || curr === undefined || next === undefined) continue;
    if (curr > threshold && curr > prev && curr >= next) {
      // peaks.length === 0 is checked in this same condition before the index access.
      if (peaks.length === 0 || i - peaks[peaks.length - 1]! >= minDistance) {
        peaks.push(i);
      }
    }
  }
  return peaks;
}
