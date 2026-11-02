import type { Preset } from "./synth";

// Banco de presets. Cada uno es una variación compacta sobre DEF.
// Unidades: fc Hz · fe octavas de envolvente de filtro · ld en cents (pitch/filtro) o 0..1 (amp)
// tiempos en segundos · ar = paso del arpegiador en beats (0.25 = semicorchea).

const DEF: Omit<Preset, "name" | "cat"> = {
  w1: "sawtooth", d1: 0, w2: null, s2: 0, d2: 0, m2: 0, o: 0, sub: 0, nz: 0, fm: 0, uni: 1, spr: 10,
  ft: "lowpass", fc: 2000, fq: 1, fe: 2, fk: 0.5, fp: 2,
  a: 0.005, d: 0.3, s: 0.7, r: 0.25, fa: 0.005, fd: 0.3, fs: 0.3, fr: 0.3,
  lt: "none", lr: 5, ld: 0, ldel: 0, gl: 0, mono: false, vs: 0.6,
  dr: 0, ch: 0, dl: 0, rv: 0.1, vol: 0.6, arp: "", ar: 0.25, ao: 1, pb: 2,
};

type Spec = Partial<Omit<Preset, "name" | "cat">>;
const out: Preset[] = [];
function cat(name: string, list: [string, Spec][]): void {
  for (const [n, s] of list) out.push({ ...DEF, ...s, name: n, cat: name });
}

cat("Bajos", [
  ["Sub Sine", { w1: "sine", o: -1, fc: 400, fe: 0, a: 0.004, s: 1, r: 0.12, vs: 0.3, vol: 0.8 }],
  ["Sub 808", { w1: "sine", o: -1, fc: 500, fe: 0, a: 0.003, d: 1.6, s: 0, r: 0.4, dr: 0.35, mono: true, gl: 0.06, vol: 0.85 }],
  ["Reese", { w1: "sawtooth", w2: "sawtooth", d2: 18, m2: 1, o: -1, uni: 2, spr: 12, fc: 500, fq: 2, fe: 1.2, fd: 0.4, mono: true, dr: 0.3, vol: 0.55 }],
  ["Acid 303", { w1: "sawtooth", o: -1, fc: 300, fq: 14, fe: 3.6, fd: 0.18, fs: 0, mono: true, gl: 0.05, dr: 0.45, s: 0.8, vol: 0.5 }],
  ["Acid Square", { w1: "square", o: -1, fc: 260, fq: 15, fe: 3.8, fd: 0.15, fs: 0, mono: true, gl: 0.06, dr: 0.5, vol: 0.45 }],
  ["Moog Bass", { w1: "sawtooth", w2: "square", s2: -12, m2: 0.6, o: -1, fc: 400, fq: 3, fe: 2.2, fd: 0.25, fs: 0.2, fp: 4, mono: true, gl: 0.03, vol: 0.6 }],
  ["Funk Pluck Bass", { w1: "square", o: -1, fc: 500, fq: 5, fe: 2.8, fd: 0.12, fs: 0, d: 0.3, s: 0.4, fp: 4, vol: 0.6 }],
  ["Wobble", { w1: "sawtooth", w2: "square", m2: 0.7, s2: -12, o: -1, fc: 350, fq: 8, fe: 0.5, lt: "filter", lr: 4, ld: 3000, fp: 4, mono: true, dr: 0.4, vol: 0.5 }],
  ["Growl", { w1: "sawtooth", w2: "sine", fm: 2.5, s2: 7, o: -1, fc: 900, fq: 6, fe: 1, lt: "filter", lr: 2, ld: 2000, mono: true, dr: 0.6, vol: 0.45 }],
  ["Deep House", { w1: "triangle", w2: "sine", s2: 12, m2: 0.3, o: -1, fc: 700, fe: 1, fd: 0.2, fs: 0.2, s: 0.6, sub: 0.4, vol: 0.7 }],
  ["Garage Organ Bass", { w1: "organ", o: -1, fc: 1500, fe: 0.5, s: 0.9, r: 0.08, vol: 0.6 }],
  ["Rubber", { w1: "sine", w2: "sine", fm: 1.5, s2: 0, o: -1, fc: 1200, fe: 0, d: 0.25, s: 0.3, fd: 0.15, fs: 0.1, mono: true, gl: 0.04, vol: 0.7 }],
  ["FM Slap", { w1: "sine", w2: "sine", fm: 4, s2: 12, o: -1, fc: 4000, fe: 0, d: 0.35, s: 0.2, fd: 0.08, fs: 0.05, vol: 0.65 }],
  ["Picked Bass", { w1: "sawtooth", w2: "triangle", m2: 0.5, o: -1, fc: 800, fq: 1.5, fe: 2, fd: 0.1, fs: 0.15, d: 0.6, s: 0.3, r: 0.1, fp: 4, vol: 0.6 }],
  ["Synthwave Bass", { w1: "sawtooth", w2: "sawtooth", d2: 8, m2: 1, o: -1, fc: 600, fq: 2, fe: 2, fd: 0.18, fs: 0.1, fp: 4, ch: 0.3, vol: 0.5 }],
  ["Dubstep Mid", { w1: "sawtooth", w2: "pulse", m2: 1, s2: 12, o: -1, uni: 3, spr: 15, fc: 900, fq: 9, lt: "filter", lr: 6, ld: 2400, dr: 0.7, mono: true, vol: 0.4 }],
  ["Trap Glide", { w1: "sine", o: -1, sub: 0.2, fc: 900, fe: 0, a: 0.003, d: 2.2, s: 0.2, r: 0.3, mono: true, gl: 0.12, dr: 0.55, vol: 0.85 }],
  ["Fat Saw Bass", { w1: "supersaw", o: -1, spr: 14, fc: 700, fq: 1.5, fe: 1.5, fd: 0.2, fs: 0.3, mono: true, vol: 0.45 }],
  ["Hollow Pulse", { w1: "thin", o: -1, fc: 1000, fq: 4, fe: 1.5, fd: 0.2, s: 0.6, vol: 0.55 }],
  ["Jazz Upright", { w1: "triangle", w2: "sine", s2: 12, m2: 0.2, o: -1, fc: 700, fe: 1.5, fd: 0.08, fs: 0.1, a: 0.008, d: 0.9, s: 0.0, r: 0.15, nz: 0.03, vol: 0.75 }],
  ["Neuro", { w1: "sawtooth", w2: "square", fm: 3, s2: 5, o: -1, fc: 1100, fq: 10, lt: "filter", lr: 8, ld: 1800, mono: true, dr: 0.8, vol: 0.35 }],
  ["Detroit", { w1: "pulse", w2: "sawtooth", m2: 0.5, s2: -12, o: -1, fc: 450, fq: 8, fe: 2.5, fd: 0.15, fs: 0.05, vol: 0.55 }],
]);

cat("Leads", [
  ["Supersaw Lead", { w1: "supersaw", spr: 22, fc: 5000, fe: 0.5, s: 0.9, ch: 0.3, dl: 0.25, rv: 0.25, vol: 0.4 }],
  ["Mono Saw Lead", { w1: "sawtooth", w2: "sawtooth", d2: 9, m2: 1, fc: 2500, fq: 2, fe: 1.5, fd: 0.3, mono: true, gl: 0.05, lt: "pitch", lr: 5.5, ld: 18, ldel: 0.35, dl: 0.2, vol: 0.4 }],
  ["Square Lead", { w1: "square", fc: 3000, fe: 1, s: 0.8, mono: true, gl: 0.04, lt: "pitch", lr: 5, ld: 15, ldel: 0.4, dl: 0.25, vol: 0.4 }],
  ["G-Funk Whistle", { w1: "sine", w2: "triangle", m2: 0.3, s2: 12, fc: 6000, fe: 0, a: 0.04, s: 1, mono: true, gl: 0.12, lt: "pitch", lr: 5.5, ld: 30, ldel: 0.2, pb: 12, rv: 0.25, vol: 0.5 }],
  ["Lucky Lead", { w1: "pulse", w2: "sawtooth", d2: 6, m2: 0.6, fc: 2800, fq: 3, fe: 1, fd: 0.4, mono: true, gl: 0.08, ch: 0.4, dl: 0.3, vol: 0.4 }],
  ["Trance Lead", { w1: "supersaw", w2: "sawtooth", s2: 12, m2: 0.4, spr: 26, fc: 4500, fe: 1, fd: 0.2, s: 0.8, dl: 0.35, rv: 0.3, vol: 0.35 }],
  ["Chiptune Lead", { w1: "pulse", fc: 12000, fe: 0, s: 0.9, r: 0.05, mono: true, lt: "pitch", lr: 7, ld: 25, ldel: 0.15, vol: 0.4 }],
  ["Sync Scream", { w1: "sawtooth", w2: "square", fm: 1.2, s2: 19, fc: 4000, fq: 4, fe: 1.5, fd: 0.5, dr: 0.5, mono: true, gl: 0.03, vol: 0.35 }],
  ["Flute Lead", { w1: "sine", w2: "triangle", s2: 12, m2: 0.15, nz: 0.06, fc: 3000, fe: 0, a: 0.06, s: 0.9, r: 0.2, lt: "pitch", lr: 5, ld: 12, ldel: 0.3, rv: 0.3, vol: 0.55 }],
  ["Sax-ish", { w1: "sawtooth", w2: "square", m2: 0.3, fc: 1400, fq: 3, fe: 1.3, fa: 0.06, fd: 0.4, fs: 0.6, a: 0.03, s: 0.85, nz: 0.04, lt: "pitch", lr: 5, ld: 10, ldel: 0.3, mono: true, gl: 0.03, vol: 0.45 }],
  ["Hoover", { w1: "supersaw", w2: "pulse", s2: -12, m2: 0.7, spr: 30, fc: 2500, fq: 2, a: 0.02, mono: true, gl: 0.15, pb: 12, lt: "pitch", lr: 6, ld: 20, ch: 0.5, vol: 0.35 }],
  ["Sine Lead", { w1: "sine", fc: 8000, fe: 0, a: 0.01, s: 0.9, mono: true, gl: 0.05, lt: "pitch", lr: 5, ld: 20, ldel: 0.3, dl: 0.3, rv: 0.3, vol: 0.55 }],
  ["Acid Lead", { w1: "sawtooth", fc: 600, fq: 13, fe: 3.2, fd: 0.2, fs: 0.1, mono: true, gl: 0.06, dr: 0.5, dl: 0.2, vol: 0.4 }],
  ["Distorted Lead", { w1: "sawtooth", w2: "square", m2: 0.8, d2: 12, fc: 3500, fq: 2, dr: 0.8, mono: true, gl: 0.03, vol: 0.3 }],
  ["Talkbox-ish", { w1: "vox", w2: "sawtooth", m2: 0.4, ft: "bandpass", fc: 900, fq: 4, fe: 1.4, fa: 0.08, fd: 0.3, fs: 0.4, mono: true, gl: 0.06, vol: 0.6 }],
  ["Pure Pulse", { w1: "thin", fc: 5000, fe: 0, s: 0.85, mono: true, gl: 0.02, dl: 0.25, vol: 0.4 }],
  ["Saw Arp Lead", { w1: "sawtooth", w2: "sawtooth", d2: 7, m2: 1, fc: 3500, fe: 1.5, fd: 0.15, fs: 0.2, d: 0.2, s: 0.5, dl: 0.3, rv: 0.2, vol: 0.4 }],
  ["Funk Lead", { w1: "square", w2: "sawtooth", m2: 0.5, fc: 1800, fq: 5, fe: 1.8, fd: 0.2, mono: true, gl: 0.04, pb: 7, vol: 0.4 }],
  ["Dreamy Lead", { w1: "triangle", w2: "sine", s2: 12, m2: 0.4, fc: 4000, a: 0.04, s: 0.9, r: 0.5, lt: "pitch", lr: 4.5, ld: 14, ldel: 0.4, ch: 0.5, dl: 0.4, rv: 0.45, vol: 0.5 }],
  ["Bright Brass Lead", { w1: "sawtooth", w2: "sawtooth", d2: 5, m2: 1, fc: 1200, fq: 1.5, fe: 2.2, fa: 0.06, fd: 0.3, fs: 0.6, a: 0.03, mono: true, gl: 0.02, vol: 0.4 }],
]);

cat("Pads", [
  ["Warm Pad", { w1: "sawtooth", w2: "sawtooth", d2: 10, m2: 1, uni: 2, spr: 8, fc: 1200, fe: 0.8, fa: 0.8, fd: 1, fs: 0.5, a: 0.8, s: 0.9, r: 1.5, ch: 0.5, rv: 0.4, vol: 0.35 }],
  ["String Pad", { w1: "supersaw", spr: 18, fc: 2500, fe: 0.5, fa: 0.5, a: 0.5, s: 0.9, r: 1.2, ch: 0.6, rv: 0.5, vol: 0.3 }],
  ["Glass Pad", { w1: "triangle", w2: "sine", s2: 19, m2: 0.5, fc: 6000, a: 0.6, s: 0.9, r: 2, lt: "amp", lr: 3, ld: 0.3, ch: 0.5, dl: 0.3, rv: 0.6, vol: 0.45 }],
  ["Choir Pad", { w1: "vox", w2: "vox", d2: 9, m2: 1, uni: 2, spr: 10, ft: "bandpass", fc: 1100, fq: 1.2, fe: 0, a: 0.7, s: 0.95, r: 1.6, lt: "pitch", lr: 5, ld: 8, ch: 0.6, rv: 0.6, vol: 0.5 }],
  ["Analog Brass Pad", { w1: "sawtooth", w2: "pulse", m2: 0.6, d2: 6, fc: 900, fe: 1.8, fa: 0.4, fd: 0.8, fs: 0.5, a: 0.25, s: 0.85, r: 0.9, ch: 0.4, rv: 0.35, vol: 0.4 }],
  ["Dark Drone", { w1: "sawtooth", w2: "sawtooth", s2: -12, d2: 7, m2: 1, fc: 380, fq: 4, lt: "filter", lr: 0.15, ld: 1500, a: 1.5, s: 1, r: 3, rv: 0.6, vol: 0.4 }],
  ["Sweep Pad", { w1: "supersaw", spr: 20, fc: 600, fq: 6, lt: "filter", lr: 0.12, ld: 2400, a: 1, s: 1, r: 2, ch: 0.4, rv: 0.5, vol: 0.3 }],
  ["Lo-Fi Pad", { w1: "triangle", w2: "sawtooth", m2: 0.3, d2: 15, fc: 1300, a: 0.4, s: 0.85, r: 1.2, lt: "pitch", lr: 0.6, ld: 14, ch: 0.7, rv: 0.4, dr: 0.15, vol: 0.45 }],
  ["Airy Pad", { w1: "sine", w2: "noise", m2: 0.15, fc: 5000, ft: "lowpass", a: 1.2, s: 1, r: 2.5, ch: 0.3, rv: 0.7, vol: 0.5 }],
  ["80s Poly Pad", { w1: "pulse", w2: "sawtooth", m2: 0.8, d2: 8, fc: 1800, fe: 1, fa: 0.3, fd: 1.2, fs: 0.4, a: 0.15, s: 0.8, r: 1, ch: 0.8, rv: 0.4, vol: 0.35 }],
  ["Hollow Pad", { w1: "square", w2: "square", d2: 12, m2: 0.8, fc: 1500, fq: 2, a: 0.5, s: 0.9, r: 1.5, lt: "filter", lr: 0.3, ld: 600, ch: 0.5, rv: 0.5, vol: 0.35 }],
  ["Shimmer", { w1: "sine", w2: "triangle", s2: 24, m2: 0.4, fc: 9000, a: 0.9, s: 1, r: 3, dl: 0.5, rv: 0.85, ch: 0.4, vol: 0.45 }],
  ["Sad Strings", { w1: "sawtooth", w2: "sawtooth", d2: 14, m2: 1, uni: 3, spr: 9, fc: 1700, fe: 0.6, fa: 0.6, a: 0.9, s: 0.9, r: 1.6, lt: "pitch", lr: 5.2, ld: 8, ldel: 0.6, rv: 0.6, vol: 0.28 }],
  ["Ambient Wash", { w1: "triangle", w2: "sine", s2: 7, m2: 0.6, fc: 2500, a: 2, s: 1, r: 4, lt: "amp", lr: 0.4, ld: 0.4, ch: 0.6, dl: 0.4, rv: 0.9, vol: 0.45 }],
  ["Vox Pad", { w1: "vox", fc: 1400, ft: "bandpass", fq: 2, lt: "filter", lr: 0.25, ld: 900, a: 0.6, s: 1, r: 1.5, ch: 0.5, rv: 0.5, vol: 0.55 }],
  ["Trance Pad", { w1: "supersaw", w2: "supersaw", s2: 12, m2: 0.5, spr: 24, fc: 3000, a: 0.3, s: 0.9, r: 1.2, rv: 0.5, vol: 0.25 }],
  ["Organ Pad", { w1: "organ", fc: 3000, a: 0.3, s: 1, r: 0.8, lt: "amp", lr: 6, ld: 0.2, ch: 0.6, rv: 0.4, vol: 0.45 }],
  ["PWM Pad", { w1: "pulse", w2: "thin", d2: 7, m2: 1, fc: 2200, a: 0.4, s: 0.9, r: 1.3, lt: "pitch", lr: 0.5, ld: 10, ch: 0.8, rv: 0.45, vol: 0.35 }],
]);

cat("Keys", [
  ["Electric Piano", { w1: "sine", w2: "sine", fm: 1.8, s2: 12, fc: 6000, fe: 0, a: 0.003, d: 1.6, s: 0.15, r: 0.5, fd: 0.6, fs: 0.1, lt: "amp", lr: 4.5, ld: 0.15, ch: 0.3, rv: 0.25, vol: 0.6 }],
  ["Rhodes Soft", { w1: "ep", w2: "sine", fm: 0.8, s2: 12, fc: 3500, a: 0.004, d: 2, s: 0.2, r: 0.6, fd: 0.8, fs: 0.2, lt: "amp", lr: 4, ld: 0.2, ch: 0.4, rv: 0.3, vol: 0.65 }],
  ["Wurli", { w1: "ep", w2: "square", fm: 0.6, s2: 0, fc: 2800, fq: 1.5, a: 0.003, d: 1.2, s: 0.25, r: 0.3, fd: 0.4, fs: 0.2, lt: "amp", lr: 5.5, ld: 0.2, vol: 0.55 }],
  ["Lo-Fi Keys", { w1: "triangle", w2: "sine", s2: 12, m2: 0.4, fc: 1800, fe: 1, fd: 0.4, fs: 0.2, a: 0.005, d: 1.4, s: 0.2, r: 0.4, lt: "pitch", lr: 0.7, ld: 16, ch: 0.5, rv: 0.3, dr: 0.15, vol: 0.6 }],
  ["Digital Piano", { w1: "triangle", w2: "sawtooth", s2: 12, m2: 0.2, fc: 4000, fe: 1, fd: 0.5, fs: 0.1, a: 0.002, d: 1.8, s: 0.1, r: 0.5, rv: 0.3, vol: 0.6 }],
  ["Clavinet", { w1: "thin", w2: "sawtooth", m2: 0.4, fc: 2500, fq: 4, fe: 1.5, fd: 0.12, fs: 0.2, a: 0.002, d: 0.5, s: 0.3, r: 0.08, vol: 0.5 }],
  ["Toy Piano", { w1: "sine", w2: "sine", fm: 3, s2: 31, fc: 8000, a: 0.002, d: 0.5, s: 0, r: 0.3, fd: 0.2, fs: 0, rv: 0.25, vol: 0.55 }],
  ["Harpsichord", { w1: "sawtooth", w2: "pulse", s2: 12, m2: 0.6, fc: 5000, fq: 2, fe: 1, fd: 0.2, fs: 0.1, a: 0.001, d: 0.9, s: 0, r: 0.25, vol: 0.45 }],
  ["Vibraphone", { w1: "sine", w2: "sine", s2: 24, m2: 0.25, fc: 6000, a: 0.002, d: 2.5, s: 0, r: 1, lt: "amp", lr: 5, ld: 0.35, rv: 0.35, vol: 0.65 }],
  ["Neo Soul Keys", { w1: "ep", w2: "triangle", s2: 12, m2: 0.3, fc: 2500, fe: 0.8, fd: 0.6, fs: 0.3, a: 0.004, d: 1.5, s: 0.3, r: 0.5, ch: 0.5, rv: 0.35, lt: "amp", lr: 3.5, ld: 0.15, vol: 0.6 }],
  ["House Stab", { w1: "sawtooth", w2: "square", m2: 0.7, s2: 12, fc: 1800, fq: 3, fe: 2, fd: 0.15, fs: 0.1, a: 0.002, d: 0.3, s: 0.2, r: 0.15, dl: 0.3, rv: 0.3, vol: 0.4 }],
  ["Organ Stab", { w1: "organ", fc: 4000, a: 0.002, d: 0.25, s: 0.2, r: 0.12, dl: 0.3, rv: 0.3, vol: 0.5 }],
  ["Dub Chord", { w1: "sawtooth", w2: "sawtooth", d2: 10, m2: 1, fc: 900, fq: 4, fe: 1.5, fd: 0.2, fs: 0.1, a: 0.003, d: 0.4, s: 0.2, r: 0.2, dl: 0.6, rv: 0.4, vol: 0.4 }],
  ["Bell Piano", { w1: "sine", w2: "sine", fm: 2.5, s2: 19, fc: 7000, a: 0.002, d: 1.8, s: 0.1, r: 0.7, fd: 0.5, fs: 0.05, rv: 0.4, vol: 0.55 }],
]);

cat("Plucks", [
  ["Pluck Classic", { w1: "sawtooth", fc: 500, fq: 3, fe: 3.5, fd: 0.12, fs: 0, a: 0.001, d: 0.4, s: 0, r: 0.2, dl: 0.3, rv: 0.3, vol: 0.5 }],
  ["Marimba-ish", { w1: "sine", w2: "sine", s2: 24, m2: 0.3, fc: 4000, a: 0.001, d: 0.45, s: 0, r: 0.2, rv: 0.25, vol: 0.7 }],
  ["Kalimba", { w1: "sine", w2: "sine", fm: 2.2, s2: 24, fc: 6000, a: 0.001, d: 0.8, s: 0, r: 0.4, fd: 0.06, fs: 0, rv: 0.35, vol: 0.6 }],
  ["Koto-ish", { w1: "sawtooth", w2: "triangle", s2: 12, m2: 0.4, fc: 1800, fq: 2, fe: 2.5, fd: 0.15, fs: 0, a: 0.001, d: 1, s: 0, r: 0.3, rv: 0.3, vol: 0.5 }],
  ["Future Pluck", { w1: "supersaw", spr: 16, fc: 800, fq: 2, fe: 3, fd: 0.15, fs: 0, a: 0.001, d: 0.35, s: 0, r: 0.25, dl: 0.35, rv: 0.4, vol: 0.4 }],
  ["Harp Pluck", { w1: "triangle", w2: "sine", s2: 12, m2: 0.3, fc: 3000, fe: 1, fd: 0.2, fs: 0, a: 0.002, d: 1.2, s: 0, r: 0.6, rv: 0.45, vol: 0.6 }],
  ["Guitar Pluck", { w1: "sawtooth", w2: "pulse", m2: 0.5, d2: 4, fc: 1200, fq: 1.5, fe: 2, fd: 0.25, fs: 0.05, a: 0.001, d: 1.2, s: 0, r: 0.2, nz: 0.04, vol: 0.5 }],
  ["Pizzicato", { w1: "sawtooth", fc: 1500, fe: 1.5, fd: 0.08, fs: 0, a: 0.002, d: 0.25, s: 0, r: 0.15, rv: 0.35, vol: 0.5 }],
  ["Water Drop", { w1: "sine", fc: 5000, fe: 0, a: 0.001, d: 0.2, s: 0, r: 0.1, lt: "pitch", lr: 18, ld: 300, dl: 0.4, rv: 0.4, vol: 0.6 }],
  ["Steel Drum", { w1: "sine", w2: "sine", fm: 1.6, s2: 7, fc: 5000, a: 0.002, d: 0.7, s: 0.05, r: 0.3, fd: 0.2, fs: 0.1, rv: 0.3, vol: 0.55 }],
  ["Chip Pluck", { w1: "square", fc: 9000, fe: 0, a: 0.001, d: 0.15, s: 0, r: 0.05, vol: 0.35 }],
  ["Mallet", { w1: "triangle", w2: "sine", fm: 1, s2: 12, fc: 3000, a: 0.001, d: 0.6, s: 0, r: 0.3, rv: 0.3, vol: 0.65 }],
  ["Short Stab", { w1: "sawtooth", w2: "sawtooth", d2: 12, m2: 1, fc: 2200, fq: 2, fe: 1.5, fd: 0.06, fs: 0, a: 0.001, d: 0.15, s: 0, r: 0.08, dl: 0.25, vol: 0.4 }],
  ["Nylon-ish", { w1: "triangle", w2: "sawtooth", m2: 0.15, fc: 1600, fe: 1.4, fd: 0.3, fs: 0, a: 0.002, d: 1.4, s: 0, r: 0.3, rv: 0.25, vol: 0.65 }],
]);

cat("Campanas", [
  ["FM Bell", { w1: "sine", w2: "sine", fm: 3.5, s2: 18.6, fc: 8000, a: 0.001, d: 2.5, s: 0, r: 1.2, fd: 1.2, fs: 0, rv: 0.45, vol: 0.5 }],
  ["Tubular", { w1: "sine", w2: "sine", fm: 2, s2: 27.5, fc: 7000, a: 0.002, d: 4, s: 0, r: 2, fd: 2, fs: 0.1, rv: 0.5, vol: 0.5 }],
  ["Music Box", { w1: "sine", w2: "triangle", s2: 24, m2: 0.4, o: 1, fc: 9000, a: 0.001, d: 1.2, s: 0, r: 0.8, rv: 0.45, vol: 0.55 }],
  ["Glockenspiel", { w1: "sine", w2: "sine", fm: 1.2, s2: 36, o: 1, fc: 10000, a: 0.001, d: 1.5, s: 0, r: 0.8, fd: 0.4, rv: 0.4, vol: 0.5 }],
  ["Crystal", { w1: "triangle", w2: "sine", fm: 2.8, s2: 31, fc: 9000, a: 0.002, d: 2, s: 0.1, r: 1.5, fd: 0.6, fs: 0.1, dl: 0.4, rv: 0.6, vol: 0.45 }],
  ["Gamelan", { w1: "sine", w2: "sine", fm: 4, s2: 14.2, fc: 6000, a: 0.002, d: 3, s: 0, r: 1.5, fd: 1, fs: 0.05, rv: 0.4, vol: 0.45 }],
  ["Celesta", { w1: "sine", w2: "sine", s2: 12, m2: 0.4, o: 1, fc: 8000, a: 0.002, d: 1, s: 0, r: 0.5, rv: 0.35, vol: 0.6 }],
  ["Dark Bell", { w1: "sine", w2: "square", fm: 1.8, s2: 7.2, fc: 2500, a: 0.002, d: 3, s: 0, r: 1.5, fd: 1.5, fs: 0, rv: 0.55, vol: 0.45 }],
]);

cat("Brass y cuerdas", [
  ["Synth Brass", { w1: "sawtooth", w2: "sawtooth", d2: 7, m2: 1, fc: 700, fe: 2.4, fa: 0.08, fd: 0.4, fs: 0.55, a: 0.04, s: 0.85, r: 0.25, vol: 0.4 }],
  ["Jump Brass", { w1: "sawtooth", w2: "pulse", d2: 5, m2: 1, fc: 900, fq: 1.5, fe: 2.6, fa: 0.03, fd: 0.25, fs: 0.5, a: 0.015, s: 0.8, r: 0.2, ch: 0.4, vol: 0.38 }],
  ["Horn Section", { w1: "sawtooth", w2: "sawtooth", d2: 12, m2: 1, uni: 2, spr: 6, fc: 800, fe: 2, fa: 0.1, fd: 0.5, fs: 0.6, a: 0.06, s: 0.9, r: 0.3, rv: 0.3, vol: 0.32 }],
  ["Strings Ensemble", { w1: "sawtooth", w2: "sawtooth", d2: 11, m2: 1, uni: 3, spr: 10, fc: 2200, fe: 0.4, fa: 0.4, a: 0.35, s: 0.9, r: 0.8, lt: "pitch", lr: 5.5, ld: 7, ldel: 0.4, ch: 0.5, rv: 0.45, vol: 0.28 }],
  ["Staccato Strings", { w1: "sawtooth", w2: "sawtooth", d2: 9, m2: 1, uni: 2, spr: 8, fc: 2500, fe: 0.8, fd: 0.1, a: 0.008, d: 0.2, s: 0.1, r: 0.15, rv: 0.4, vol: 0.32 }],
  ["Cello-ish", { w1: "sawtooth", w2: "pulse", m2: 0.4, o: -1, fc: 1100, fq: 1.5, fe: 0.8, fa: 0.15, a: 0.12, s: 0.9, r: 0.4, lt: "pitch", lr: 5, ld: 12, ldel: 0.3, rv: 0.4, vol: 0.4 }],
  ["Orchestra Hit", { w1: "supersaw", w2: "square", s2: -12, m2: 0.7, spr: 20, fc: 3000, fe: 1, fd: 0.2, fs: 0.2, a: 0.002, d: 0.5, s: 0, r: 0.4, nz: 0.1, rv: 0.5, vol: 0.35 }],
  ["Tuba-ish", { w1: "sawtooth", w2: "sine", m2: 0.5, o: -1, fc: 350, fe: 2, fa: 0.06, fd: 0.3, fs: 0.5, a: 0.04, s: 0.85, r: 0.2, mono: true, gl: 0.04, vol: 0.55 }],
]);

cat("Órganos", [
  ["Drawbar Organ", { w1: "organ", fc: 6000, fe: 0, a: 0.003, s: 1, r: 0.06, lt: "amp", lr: 6.5, ld: 0.15, ch: 0.5, vol: 0.45 }],
  ["Gospel Organ", { w1: "organ", w2: "sine", s2: 19, m2: 0.3, fc: 7000, a: 0.003, s: 1, r: 0.08, lt: "pitch", lr: 6.8, ld: 6, ch: 0.6, dr: 0.25, rv: 0.25, vol: 0.4 }],
  ["Church Organ", { w1: "organ", w2: "square", s2: 12, m2: 0.3, fc: 4500, a: 0.06, s: 1, r: 0.6, rv: 0.7, vol: 0.4 }],
  ["Farfisa-ish", { w1: "square", w2: "pulse", s2: 12, m2: 0.5, fc: 4000, a: 0.003, s: 1, r: 0.05, lt: "pitch", lr: 6, ld: 10, vol: 0.38 }],
  ["Perc Organ", { w1: "organ", w2: "sine", s2: 24, m2: 0.6, fc: 6000, a: 0.002, d: 0.25, s: 0.75, r: 0.06, ch: 0.4, vol: 0.45 }],
]);

cat("Arps", [
  ["Arp Saw 1/16", { w1: "sawtooth", w2: "sawtooth", d2: 8, m2: 1, fc: 1500, fq: 3, fe: 2, fd: 0.12, fs: 0.1, a: 0.002, d: 0.15, s: 0.3, r: 0.1, arp: "up", ar: 0.25, ao: 2, dl: 0.3, rv: 0.25, vol: 0.4 }],
  ["Arp Pluck Up-Down", { w1: "pulse", fc: 1800, fq: 2, fe: 2, fd: 0.1, fs: 0, a: 0.001, d: 0.2, s: 0, r: 0.15, arp: "updown", ar: 0.25, ao: 2, dl: 0.35, rv: 0.3, vol: 0.45 }],
  ["Arp Bell 1/8", { w1: "sine", w2: "sine", fm: 2.4, s2: 12, fc: 8000, a: 0.001, d: 0.6, s: 0, r: 0.3, fd: 0.3, arp: "up", ar: 0.5, ao: 2, dl: 0.4, rv: 0.45, vol: 0.5 }],
  ["Arp Acid", { w1: "sawtooth", o: -1, fc: 350, fq: 13, fe: 3.4, fd: 0.15, fs: 0, a: 0.002, d: 0.2, s: 0.5, arp: "up", ar: 0.25, ao: 2, dr: 0.4, vol: 0.4 }],
  ["Arp Chip 1/32", { w1: "square", fc: 9000, fe: 0, a: 0.001, d: 0.06, s: 0, r: 0.03, arp: "up", ar: 0.125, ao: 3, vol: 0.32 }],
  ["Arp Random Glass", { w1: "triangle", w2: "sine", s2: 24, m2: 0.4, fc: 7000, a: 0.002, d: 0.4, s: 0, r: 0.4, arp: "random", ar: 0.25, ao: 2, dl: 0.45, rv: 0.55, vol: 0.5 }],
  ["Arp Down Saw", { w1: "supersaw", spr: 14, fc: 2200, fe: 1.4, fd: 0.12, fs: 0.1, a: 0.002, d: 0.2, s: 0.2, r: 0.15, arp: "down", ar: 0.25, ao: 2, dl: 0.3, rv: 0.3, vol: 0.32 }],
  ["Arp Chord Stabs", { w1: "sawtooth", w2: "square", m2: 0.6, s2: 12, fc: 2000, fq: 2, fe: 1.8, fd: 0.1, fs: 0, a: 0.002, d: 0.18, s: 0, r: 0.1, arp: "chord", ar: 0.5, dl: 0.4, rv: 0.35, vol: 0.32 }],
  ["Arp Trance Gate", { w1: "supersaw", spr: 22, fc: 3500, a: 0.002, d: 0.12, s: 0.3, r: 0.08, arp: "chord", ar: 0.25, rv: 0.4, vol: 0.28 }],
  ["Arp Synthwave", { w1: "sawtooth", w2: "pulse", m2: 0.6, d2: 6, fc: 1600, fq: 2, fe: 2, fd: 0.15, fs: 0.1, a: 0.002, d: 0.2, s: 0.2, r: 0.12, arp: "updown", ar: 0.25, ao: 2, ch: 0.6, dl: 0.4, rv: 0.4, vol: 0.38 }],
]);

cat("8-bit", [
  ["NES Pulse 25", { w1: "pulse", fc: 14000, fe: 0, a: 0.001, s: 0.85, r: 0.03, vol: 0.32 }],
  ["NES Pulse 12", { w1: "thin", fc: 14000, fe: 0, a: 0.001, s: 0.85, r: 0.03, vol: 0.32 }],
  ["NES Triangle Bass", { w1: "triangle", o: -1, fc: 14000, fe: 0, a: 0.001, s: 1, r: 0.03, vol: 0.7 }],
  ["Gameboy Wave", { w1: "square", w2: "triangle", m2: 0.5, s2: 12, fc: 6000, fe: 0, a: 0.001, d: 0.3, s: 0.6, r: 0.05, vol: 0.35 }],
  ["Coin", { w1: "square", fc: 14000, fe: 0, a: 0.001, d: 0.25, s: 0, r: 0.05, lt: "pitch", lr: 12, ld: 500, vol: 0.3 }],
  ["Power Up", { w1: "pulse", fc: 14000, fe: 0, a: 0.001, d: 0.5, s: 0.4, r: 0.1, lt: "pitch", lr: 16, ld: 700, vol: 0.3 }],
  ["Chip Vibrato", { w1: "pulse", fc: 14000, fe: 0, a: 0.001, s: 0.9, r: 0.06, lt: "pitch", lr: 6, ld: 35, ldel: 0.2, mono: true, gl: 0.03, vol: 0.32 }],
]);

cat("FX", [
  ["Riser Noise", { w1: "noise", ft: "bandpass", fc: 400, fq: 3, fe: 4.5, fa: 4, fd: 1, fs: 1, a: 3, s: 1, r: 0.6, rv: 0.5, vol: 0.5 }],
  ["Laser Zap", { w1: "sawtooth", fc: 6000, a: 0.001, d: 0.25, s: 0, r: 0.1, lt: "pitch", lr: 20, ld: 1200, dl: 0.3, vol: 0.35 }],
  ["Sci-Fi Sweep", { w1: "sawtooth", w2: "square", fm: 5, s2: 3, fc: 1200, fq: 8, lt: "filter", lr: 0.5, ld: 3600, a: 0.5, s: 1, r: 1.5, dl: 0.5, rv: 0.6, vol: 0.3 }],
  ["Siren", { w1: "square", fc: 4000, a: 0.01, s: 1, r: 0.2, lt: "pitch", lr: 1.5, ld: 700, vol: 0.3 }],
  ["Downlifter", { w1: "noise", w2: "sawtooth", m2: 0.3, ft: "lowpass", fc: 9000, fe: -4, fa: 0.01, fd: 2, fs: 0, a: 0.01, d: 2, s: 0, r: 0.5, rv: 0.5, vol: 0.5 }],
  ["Wind", { w1: "noise", ft: "bandpass", fc: 800, fq: 5, lt: "filter", lr: 0.2, ld: 1800, a: 1, s: 1, r: 2, rv: 0.6, vol: 0.5 }],
  ["Alarm", { w1: "square", w2: "square", s2: 7, m2: 1, fc: 5000, a: 0.002, s: 1, r: 0.05, lt: "amp", lr: 8, ld: 1, vol: 0.25 }],
  ["Drone Sub Rumble", { w1: "sine", w2: "noise", m2: 0.2, o: -2, fc: 200, a: 1.5, s: 1, r: 2, lt: "amp", lr: 0.3, ld: 0.5, vol: 0.8 }],
  ["Impact Boom", { w1: "sine", o: -2, nz: 0.3, fc: 3000, fe: -3, fd: 0.8, fs: 0, a: 0.001, d: 2, s: 0, r: 0.5, lt: "pitch", lr: 0.4, ld: -900, rv: 0.6, vol: 0.85 }],
]);

cat("Voces", [
  ["Aah Choir", { w1: "vox", w2: "vox", d2: 12, m2: 1, uni: 3, spr: 10, ft: "bandpass", fc: 1000, fq: 1.5, fe: 0, a: 0.25, s: 0.95, r: 0.9, lt: "pitch", lr: 5.5, ld: 9, ldel: 0.3, ch: 0.5, rv: 0.6, vol: 0.45 }],
  ["Ooh Vox", { w1: "vox", ft: "lowpass", fc: 700, fq: 3, fe: 0.3, a: 0.15, s: 0.9, r: 0.6, lt: "pitch", lr: 5, ld: 10, ldel: 0.25, ch: 0.4, rv: 0.5, vol: 0.6 }],
  ["Vocoder-ish", { w1: "sawtooth", w2: "vox", m2: 1, ft: "bandpass", fc: 1300, fq: 5, lt: "filter", lr: 0.35, ld: 1100, a: 0.02, s: 0.9, r: 0.3, ch: 0.5, rv: 0.3, vol: 0.5 }],
  ["Vox Chop", { w1: "vox", w2: "sawtooth", m2: 0.3, ft: "bandpass", fc: 1600, fq: 3, fe: 1, fd: 0.1, fs: 0.2, a: 0.002, d: 0.18, s: 0, r: 0.1, dl: 0.4, rv: 0.4, vol: 0.55 }],
]);

export const PRESETS: Preset[] = out;
export const CATEGORIES: string[] = [...new Set(out.map((p) => p.cat))];
