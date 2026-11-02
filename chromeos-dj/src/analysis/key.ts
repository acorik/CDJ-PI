import { FFT, decimate } from "./dsp";

// Perfiles de Krumhansl-Kessler.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export interface KeyInfo {
  /** 0..11 = mayor con tónica en esa clase de altura (C=0); 12..23 = menor. -1 = desconocida. */
  key: number;
  confidence: number;
  chroma: number[];
}

function pearson(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

export function keyFromChroma(chroma: number[]): { key: number; confidence: number } {
  let best = -2, bestKey = -1, second = -2;
  const rot = new Array<number>(12);
  for (let t = 0; t < 12; t++) {
    for (const [profile, offset] of [[MAJOR, 0], [MINOR, 12]] as const) {
      for (let pc = 0; pc < 12; pc++) rot[pc] = profile[(pc - t + 12) % 12];
      const c = pearson(chroma, rot);
      if (c > best) { second = best; best = c; bestKey = t + offset; }
      else if (c > second) second = c;
    }
  }
  return { key: bestKey, confidence: Math.max(0, best - second) };
}

export function detectKey(x: Float32Array, sr: number): KeyInfo {
  const factor = Math.max(1, Math.floor(sr / 11025));
  const y = decimate(x, factor);
  const fs = sr / factor;
  const N = 4096;
  const fft = new FFT(N);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);

  // Precalcula a qué clase de altura va cada bin útil (80 Hz .. 2.5 kHz).
  const kMin = Math.ceil((80 * N) / fs);
  const kMax = Math.min(N / 2 - 1, Math.floor((2500 * N) / fs));
  const binPc = new Int8Array(kMax + 1).fill(-1);
  const binW = new Float64Array(kMax + 1);
  for (let k = kMin; k <= kMax; k++) {
    const f = (k * fs) / N;
    const midi = 69 + 12 * Math.log2(f / 440);
    const r = Math.round(midi);
    const dev = Math.abs(midi - r); // 0..0.5
    binPc[k] = ((r % 12) + 12) % 12;
    binW[k] = Math.max(0, 1 - 2 * dev); // los bins entre dos semitonos cuentan menos
  }

  const total = new Float64Array(12);
  const frame = new Float64Array(12);
  const hop = N; // sin solape: suficiente para un perfil global y barato
  for (let start = 0; start + N <= y.length; start += hop) {
    let energy = 0;
    for (let i = 0; i < N; i++) {
      const v = y[start + i] * win[i];
      re[i] = v; im[i] = 0; energy += v * v;
    }
    if (energy < 1e-4) continue; // silencio
    fft.transform(re, im);
    frame.fill(0);
    for (let k = kMin; k <= kMax; k++) {
      const pc = binPc[k];
      if (pc < 0) continue;
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      frame[pc] += mag * binW[k];
    }
    let s = 0;
    for (let p = 0; p < 12; p++) s += frame[p];
    if (s <= 0) continue;
    for (let p = 0; p < 12; p++) total[p] += frame[p] / s;
  }
  const chroma = Array.from(total);
  if (chroma.every((v) => v === 0)) return { key: -1, confidence: 0, chroma };
  const { key, confidence } = keyFromChroma(chroma);
  return { key, confidence, chroma };
}
