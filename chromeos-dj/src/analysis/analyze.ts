import { Biquad } from "./dsp";
import { detectBeats } from "./bpm";
import { detectKey } from "./key";
import { computeWaveform, WF_RATE } from "./waveform";

export const ANALYSIS_VERSION = 1;

export interface AnalysisResult {
  version: number;
  duration: number;
  bpm: number;
  firstBeat: number;
  downbeat: number;
  bpmConfidence: number;
  key: number;
  keyConfidence: number;
  /** Loudness integrado aproximado (estilo LUFS, ponderación K simplificada). */
  loudness: number;
  /** Primer instante con sonido (> -40 dBFS) para el auto-cue. */
  firstSound: number;
  wfRate: number;
  wf: Uint8Array;
}

export function approxLoudness(x: Float32Array, sr: number): number {
  const hs = Biquad.highshelf(sr, 1500, 4);
  const hp = Biquad.highpass(sr, 38, 0.5);
  const block = Math.round(sr * 0.4);
  const step = Math.round(sr * 0.1);
  const n = Math.floor(x.length / step);
  const ms = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < step; k++) {
      const v = hp.process(hs.process(x[i * step + k]));
      s += v * v;
    }
    ms[i] = s / step;
  }
  const blocks: number[] = [];
  const per = Math.round(block / step);
  for (let i = 0; i + per <= n; i++) {
    let s = 0;
    for (let k = 0; k < per; k++) s += ms[i + k];
    blocks.push(s / per);
  }
  const lufs = (m: number) => -0.691 + 10 * Math.log10(m + 1e-12);
  const abs = blocks.filter((m) => lufs(m) > -70);
  if (!abs.length) return -70;
  const meanAbs = abs.reduce((a, b) => a + b, 0) / abs.length;
  const rel = abs.filter((m) => lufs(m) > lufs(meanAbs) - 10);
  const meanRel = rel.reduce((a, b) => a + b, 0) / Math.max(1, rel.length);
  // +3 dB: compensa que analizamos la mezcla mono (L+R)/2 en vez de sumar
  // la potencia de ambos canales como hace BS.1770.
  return lufs(meanRel) + 3;
}

export function firstSoundTime(x: Float32Array, sr: number): number {
  const th = Math.pow(10, -40 / 20);
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > th) return Math.max(0, i / sr - 0.005);
  return 0;
}

export function analyzeMono(x: Float32Array, sr: number, minBpm = 88): AnalysisResult {
  const beats = detectBeats(x, sr, minBpm);
  const key = detectKey(x, sr);
  return {
    version: ANALYSIS_VERSION,
    duration: x.length / sr,
    bpm: beats.bpm,
    firstBeat: beats.firstBeat,
    downbeat: beats.downbeat,
    bpmConfidence: beats.confidence,
    key: key.key,
    keyConfidence: key.confidence,
    loudness: approxLoudness(x, sr),
    firstSound: firstSoundTime(x, sr),
    wfRate: WF_RATE,
    wf: computeWaveform(x, sr, WF_RATE),
  };
}
