import { Biquad } from "./dsp";

export interface BeatInfo {
  /** BPM del grid (tempo constante, como rekordbox/Serato en modo normal). */
  bpm: number;
  /** Segundo del primer beat (>= 0, < 1 beat). */
  firstBeat: number;
  /** Índice 0..3: qué beat (desde firstBeat) es el "1" del compás. */
  downbeat: number;
  /** Confianza relativa (pico/media del plegado). */
  confidence: number;
}

interface Onsets {
  env: Float32Array;
  low: Float32Array;
  fps: number;
  hop: number;
}

/**
 * Envolvente de onsets multibanda: diferencia positiva del log de la energía
 * en graves (bombo), medios y agudos (hats). El bombo pesa más porque en
 * música electrónica es lo que define el beat.
 */
export function onsetEnvelope(x: Float32Array, sr: number): Onsets {
  const hop = Math.max(32, Math.round(sr / 172));
  const fps = sr / hop;
  const frames = Math.floor(x.length / hop);

  let ss = 0;
  for (let i = 0; i < x.length; i++) ss += x[i] * x[i];
  const rms = Math.sqrt(ss / Math.max(1, x.length));
  const g = rms > 1e-6 ? 1 / rms : 1;

  const lowF = Biquad.lowpass(sr, 130);
  const highF = Biquad.highpass(sr, 2500);
  const eL = new Float32Array(frames);
  const eM = new Float32Array(frames);
  const eH = new Float32Array(frames);
  let idx = 0;
  for (let f = 0; f < frames; f++) {
    let sl = 0, sm = 0, sh = 0;
    for (let k = 0; k < hop; k++) {
      const s = x[idx++] * g;
      const l = lowF.process(s);
      const h = highF.process(s);
      const m = s - l - h;
      sl += l * l; sm += m * m; sh += h * h;
    }
    eL[f] = sl / hop; eM[f] = sm / hop; eH[f] = sh / hop;
  }

  const env = new Float32Array(frames);
  const low = new Float32Array(frames);
  const C = 100;
  let pL = Math.log1p(C * eL[0]), pM = Math.log1p(C * eM[0]), pH = Math.log1p(C * eH[0]);
  for (let f = 1; f < frames; f++) {
    const cL = Math.log1p(C * eL[f]);
    const cM = Math.log1p(C * eM[f]);
    const cH = Math.log1p(C * eH[f]);
    const oL = Math.max(0, cL - pL);
    const oM = Math.max(0, cM - pM);
    const oH = Math.max(0, cH - pH);
    low[f] = oL;
    env[f] = oL + 0.6 * oM + 0.35 * oH;
    pL = cL; pM = cM; pH = cH;
  }

  // Umbral adaptativo: resta la media local (~0.2 s) y rectifica.
  const W = Math.max(2, Math.round(fps * 0.1));
  const out = new Float32Array(frames);
  let acc = 0;
  for (let f = 0; f < Math.min(frames, W); f++) acc += env[f];
  for (let f = 0; f < frames; f++) {
    const add = f + W < frames ? env[f + W] : 0;
    const sub = f - W - 1 >= 0 ? env[f - W - 1] : 0;
    acc += add - sub;
    const lo = Math.max(0, f - W);
    const hi = Math.min(frames - 1, f + W);
    const mean = acc / (hi - lo + 1);
    out[f] = Math.max(0, env[f] - mean);
  }
  return { env: out, low, fps, hop };
}

/** Pliega la envolvente módulo `period` (en frames, fraccional). Devuelve pico y fase. */
function fold(env: Float32Array, period: number, hist: Float64Array): { peak: number; phase: number } {
  const B = Math.ceil(period);
  hist.fill(0, 0, B + 1);
  const inv = 1 / period;
  for (let i = 0; i < env.length; i++) {
    const e = env[i];
    if (e === 0) continue;
    let ph = i * inv;
    ph -= Math.floor(ph);
    hist[Math.floor(ph * period)] += e;
  }
  let best = -1, bestIdx = 0;
  const sm = (b: number) => hist[(b + B) % B];
  for (let b = 0; b < B; b++) {
    const v = sm(b) + 0.5 * (sm(b - 1) + sm(b + 1));
    if (v > best) { best = v; bestIdx = b; }
  }
  // refinamiento parabólico
  const y0 = sm(bestIdx - 1) + 0.5 * (sm(bestIdx - 2) + sm(bestIdx));
  const y2 = sm(bestIdx + 1) + 0.5 * (sm(bestIdx) + sm(bestIdx + 2));
  const den = y0 - 2 * best + y2;
  const delta = den !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / den)) : 0;
  let phase = bestIdx + delta;
  if (phase < 0) phase += period;
  if (phase >= period) phase -= period;
  return { peak: best, phase };
}

export function detectBeats(x: Float32Array, sr: number, minBpm = 88): BeatInfo {
  const { env, low, fps, hop } = onsetEnvelope(x, sr);
  const N = env.length;
  const fallback: BeatInfo = { bpm: 0, firstBeat: 0, downbeat: 0, confidence: 0 };
  if (N < fps * 8) return fallback; // < 8 s: no hay suficiente material

  const maxBpm = minBpm * 2;
  const minLag = Math.floor((fps * 60) / maxBpm);
  const maxLag = Math.ceil((fps * 60) / minBpm);

  // 1) Autocorrelación con refuerzo armónico -> estimación gruesa.
  const lagTop = Math.min(N - 1, maxLag * 4 + 2);
  const acf = new Float64Array(lagTop + 1);
  for (let lag = minLag; lag <= lagTop; lag++) {
    let s = 0;
    for (let i = 0; i + lag < N; i++) s += env[i] * env[i + lag];
    acf[lag] = s / (N - lag);
  }
  let bestLag = minLag, bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const s = acf[lag] + 0.5 * (acf[2 * lag] ?? 0) + 0.25 * (acf[4 * lag] ?? 0);
    if (s > bestScore) { bestScore = s; bestLag = lag; }
  }
  const sc = (l: number) => acf[l] + 0.5 * (acf[2 * l] ?? 0) + 0.25 * (acf[4 * l] ?? 0);
  let lagF = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const y0 = sc(bestLag - 1), y1 = sc(bestLag), y2 = sc(bestLag + 1);
    const den = y0 - 2 * y1 + y2;
    if (den !== 0) lagF = bestLag + Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / den));
  }
  let bpm = (60 * fps) / lagF;

  // 2) Refinado fino por plegado (beat-synchronous folding) a 0.05 y luego 0.005 BPM.
  const hist = new Float64Array(Math.ceil((fps * 60) / (minBpm * 0.9)) + 4);
  const score = (b: number) => fold(env, (60 * fps) / b, hist).peak;
  const search = (center: number, span: number, step: number) => {
    let bb = center, bs = -Infinity;
    for (let b = center - span; b <= center + span + 1e-9; b += step) {
      if (b < minBpm * 0.97 || b > maxBpm * 1.03) continue;
      const s = score(b);
      if (s > bs) { bs = s; bb = b; }
    }
    return { bpm: bb, score: bs };
  };
  let r = search(bpm, bpm * 0.02, 0.05);
  r = search(r.bpm, 0.06, 0.005);
  bpm = r.bpm;

  // 3) Redondeo a entero si es prácticamente igual de bueno (la mayoría de
  //    temas electrónicos están a BPM entero).
  const rounded = Math.round(bpm);
  if (Math.abs(bpm - rounded) < 0.08 && score(rounded) >= 0.97 * r.score) bpm = rounded;
  else {
    const half = Math.round(bpm * 2) / 2;
    if (Math.abs(bpm - half) < 0.03 && score(half) >= 0.985 * r.score) bpm = half;
  }

  // 4) Fase del grid.
  const period = (60 * fps) / bpm;
  const { peak, phase } = fold(env, period, hist);
  const beatSec = 60 / bpm;
  let firstBeat = (phase * hop) / sr;
  firstBeat = ((firstBeat % beatSec) + beatSec) % beatSec;

  // 5) Downbeat: el beat (mod 4) con más energía de bombo de entrada.
  const acc4 = [0, 0, 0, 0];
  for (let k = 0; ; k++) {
    const f = Math.round(phase + k * period);
    if (f >= N - 1) break;
    acc4[k % 4] += low[f] + 0.5 * (low[f - 1] ?? 0) + 0.5 * low[f + 1];
  }
  let downbeat = 0;
  for (let j = 1; j < 4; j++) if (acc4[j] > acc4[downbeat]) downbeat = j;

  let mean = 0;
  for (let i = 0; i < N; i++) mean += env[i];
  mean = (mean / N) * (N / Math.max(1, N / period)); // energía esperada por bin si fuese uniforme
  const confidence = mean > 0 ? peak / mean : 0;

  return { bpm, firstBeat, downbeat, confidence };
}
