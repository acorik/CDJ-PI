import { Biquad } from "./dsp";

/** Resolución del waveform de detalle (bins por segundo). */
export const WF_RATE = 150;

/**
 * Waveform de 3 bandas: por cada bin guarda [pico, graves, medios, agudos]
 * en un Uint8Array (4 bytes/bin -> ~220 KB para 6 min). Es lo único que se
 * guarda del audio en la base de datos; el PCM nunca se cachea.
 */
export function computeWaveform(x: Float32Array, sr: number, rate = WF_RATE): Uint8Array {
  const hop = sr / rate;
  const n = Math.floor(x.length / hop);
  const out = new Uint8Array(n * 4);
  const lowF = Biquad.lowpass(sr, 200);
  const highF = Biquad.highpass(sr, 2500);
  const peak = new Float32Array(n);
  const lo = new Float32Array(n);
  const mi = new Float32Array(n);
  const hi = new Float32Array(n);
  let maxPeak = 1e-9, maxLo = 1e-9, maxMi = 1e-9, maxHi = 1e-9;
  let idx = 0;
  for (let b = 0; b < n; b++) {
    const end = Math.floor((b + 1) * hop);
    let p = 0, sl = 0, sm = 0, sh = 0;
    const cnt = Math.max(1, end - idx);
    for (; idx < end; idx++) {
      const s = x[idx];
      const l = lowF.process(s);
      const h = highF.process(s);
      const m = s - l - h;
      const a = s < 0 ? -s : s;
      if (a > p) p = a;
      sl += l * l; sm += m * m; sh += h * h;
    }
    peak[b] = p;
    lo[b] = Math.sqrt(sl / cnt);
    mi[b] = Math.sqrt(sm / cnt);
    hi[b] = Math.sqrt(sh / cnt);
    if (p > maxPeak) maxPeak = p;
    if (lo[b] > maxLo) maxLo = lo[b];
    if (mi[b] > maxMi) maxMi = mi[b];
    if (hi[b] > maxHi) maxHi = hi[b];
  }
  // Normalización por banda con la misma referencia (evita que unos agudos
  // flojos parezcan saturados) pero con algo de realce para medios/agudos.
  const ref = Math.max(maxLo, maxMi * 1.4, maxHi * 2.2);
  for (let b = 0; b < n; b++) {
    out[b * 4] = Math.min(255, Math.round((peak[b] / maxPeak) * 255));
    out[b * 4 + 1] = Math.min(255, Math.round(Math.sqrt(lo[b] / ref) * 255));
    out[b * 4 + 2] = Math.min(255, Math.round(Math.sqrt((mi[b] * 1.4) / ref) * 255));
    out[b * 4 + 3] = Math.min(255, Math.round(Math.sqrt((hi[b] * 2.2) / ref) * 255));
  }
  return out;
}
