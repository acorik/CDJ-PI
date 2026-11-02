// Generador de pistas sintéticas para los tests (bombo 4x4 + hats + acorde).
export interface SynthOpts { bpm: number; seconds: number; sr: number; offset: number; rootHz: number; minor: boolean }

export function synthTrack(o: SynthOpts): Float32Array {
  const n = Math.floor(o.seconds * o.sr);
  const x = new Float32Array(n);
  const beat = 60 / o.bpm;
  let seed = 1234;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  // bombo en cada beat
  for (let t = o.offset; t < o.seconds; t += beat) {
    const s0 = Math.floor(t * o.sr);
    let ph = 0;
    for (let k = 0; k < o.sr * 0.25 && s0 + k < n; k++) {
      const tt = k / o.sr;
      const f = 50 + 90 * Math.exp(-tt * 30);
      ph += (2 * Math.PI * f) / o.sr;
      x[s0 + k] += 0.9 * Math.sin(ph) * Math.exp(-tt * 12);
    }
    // hat a contratiempo
    const h0 = Math.floor((t + beat / 2) * o.sr);
    for (let k = 0; k < o.sr * 0.04 && h0 + k < n; k++) x[h0 + k] += 0.15 * rnd() * Math.exp(-(k / o.sr) * 120);
  }
  // acorde sostenido (tríada) en varias octavas
  const third = o.minor ? 3 : 4;
  const notes = [0, third, 7, 12, 12 + third, 19, -12];
  for (let i = 0; i < n; i++) {
    const t = i / o.sr;
    let s = 0;
    for (const semi of notes) s += Math.sin(2 * Math.PI * o.rootHz * Math.pow(2, semi / 12) * t);
    x[i] += 0.05 * s;
  }
  return x;
}
