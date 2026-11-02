// Kits de batería sintetizados al arrancar (OfflineAudioContext): nada que
// descargar, ~1 MB de RAM por kit. Inspirados en la arquitectura clásica de
// las cajas analógicas (osciladores + ruido + envolventes), no son samples.

export interface KitDef {
  id: string;
  name: string;
  voices: VoiceDef[];
}

export interface VoiceDef {
  name: string;
  short: string;
  seconds: number;
  /** grupo de choke: una voz corta a las demás del mismo grupo (hats) */
  choke?: number;
  render: (c: OfflineAudioContext) => void;
}

type C = OfflineAudioContext;

function noiseBuf(c: C, seconds: number): AudioBufferSourceNode {
  const b = c.createBuffer(1, Math.ceil(c.sampleRate * seconds), c.sampleRate);
  const d = b.getChannelData(0);
  let seed = 22222;
  for (let i = 0; i < d.length; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; d[i] = seed / 2147483648 - 1; }
  const s = c.createBufferSource();
  s.buffer = b;
  return s;
}

function envGain(c: C, peak: number, attack: number, decay: number, t0 = 0, curve = 0.001): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(curve, t0 + attack + decay);
  return g;
}

function filt(c: C, type: BiquadFilterType, f: number, q = 0.7): BiquadFilterNode {
  const b = c.createBiquadFilter();
  b.type = type; b.frequency.value = f; b.Q.value = q;
  return b;
}

function shaper(c: C, drive: number): WaveShaperNode {
  const w = c.createWaveShaper();
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(x * drive) / Math.tanh(drive); }
  w.curve = curve;
  return w;
}

/** Bombo: seno con caída de pitch. */
function kick(f0: number, fEnd: number, pitchTime: number, decay: number, click: number, drive = 1.2) {
  return (c: C) => {
    const o = c.createOscillator();
    o.frequency.setValueAtTime(f0, 0);
    o.frequency.exponentialRampToValueAtTime(fEnd, pitchTime);
    const g = envGain(c, 1, 0.001, decay);
    const sh = shaper(c, drive);
    o.connect(g); g.connect(sh); sh.connect(c.destination);
    o.start();
    if (click > 0) {
      const n = noiseBuf(c, 0.02), hp = filt(c, "highpass", 2000), ng = envGain(c, click, 0.0005, 0.012);
      n.connect(hp); hp.connect(ng); ng.connect(c.destination); n.start();
    }
  };
}

function snare(tone1: number, tone2: number, toneDecay: number, noiseDecay: number, noiseLevel: number, hp = 1200) {
  return (c: C) => {
    for (const [f, lv] of [[tone1, 0.5], [tone2, 0.3]]) {
      const o = c.createOscillator(); o.frequency.value = f;
      o.frequency.setValueAtTime(f * 1.3, 0); o.frequency.exponentialRampToValueAtTime(f, 0.02);
      const g = envGain(c, lv, 0.001, toneDecay);
      o.connect(g); g.connect(c.destination); o.start();
    }
    const n = noiseBuf(c, noiseDecay + 0.1), f = filt(c, "highpass", hp), g = envGain(c, noiseLevel, 0.001, noiseDecay);
    n.connect(f); f.connect(g); g.connect(c.destination); n.start();
  };
}

function clap(decay: number, freq = 1100) {
  return (c: C) => {
    const bursts = [0, 0.011, 0.022, 0.034];
    bursts.forEach((t0, i) => {
      const n = noiseBuf(c, decay + 0.2), f = filt(c, "bandpass", freq, 1.4);
      const g = envGain(c, i === 3 ? 0.9 : 0.7, 0.0008, i === 3 ? decay : 0.012, t0);
      n.connect(f); f.connect(g); g.connect(c.destination); n.start(t0);
    });
  };
}

/** Hats/platos metálicos: 6 cuadradas inarmónicas (como la 808) + filtros. */
function metal(decay: number, level: number, bp = 10000, hp = 7000) {
  return (c: C) => {
    const freqs = [205.3, 304.4, 369.6, 522.7, 540, 800];
    const sum = c.createGain(); sum.gain.value = 0.18;
    for (const f of freqs) { const o = c.createOscillator(); o.type = "square"; o.frequency.value = f; o.connect(sum); o.start(); }
    const b = filt(c, "bandpass", bp, 0.8), h = filt(c, "highpass", hp), g = envGain(c, level, 0.001, decay);
    sum.connect(b); b.connect(h); h.connect(g); g.connect(c.destination);
  };
}

function noiseHat(decay: number, level: number, hp = 8000) {
  return (c: C) => {
    const n = noiseBuf(c, decay + 0.1), f = filt(c, "highpass", hp), f2 = filt(c, "peaking", 11000, 1);
    f2.gain.value = 6;
    const g = envGain(c, level, 0.001, decay);
    n.connect(f); f.connect(f2); f2.connect(g); g.connect(c.destination); n.start();
  };
}

function tom(f: number, decay: number) {
  return (c: C) => {
    const o = c.createOscillator();
    o.frequency.setValueAtTime(f * 1.6, 0); o.frequency.exponentialRampToValueAtTime(f, 0.08);
    const g = envGain(c, 0.85, 0.001, decay);
    o.connect(g); g.connect(c.destination); o.start();
  };
}

function cowbell() {
  return (c: C) => {
    const sum = c.createGain(); sum.gain.value = 0.35;
    for (const f of [540, 800]) { const o = c.createOscillator(); o.type = "square"; o.frequency.value = f; o.connect(sum); o.start(); }
    const b = filt(c, "bandpass", 2640, 1.2), g = envGain(c, 0.9, 0.001, 0.35);
    sum.connect(b); b.connect(g); g.connect(c.destination);
  };
}

function blip(f: number, decay: number, type: OscillatorType = "sine", level = 0.8) {
  return (c: C) => {
    const o = c.createOscillator(); o.type = type; o.frequency.value = f;
    const g = envGain(c, level, 0.0005, decay);
    o.connect(g); g.connect(c.destination); o.start();
  };
}

function shaker(decay: number) {
  return (c: C) => {
    const n = noiseBuf(c, decay + 0.05), f = filt(c, "highpass", 5000), g = envGain(c, 0.5, 0.008, decay);
    n.connect(f); f.connect(g); g.connect(c.destination); n.start();
  };
}

function snap() {
  return (c: C) => {
    const n = noiseBuf(c, 0.2), f = filt(c, "bandpass", 2200, 2.5), g = envGain(c, 1, 0.0005, 0.07);
    n.connect(f); f.connect(g); g.connect(c.destination); n.start();
    blip(1800, 0.01, "sine", 0.4)(c);
  };
}

export const KITS: KitDef[] = [
  {
    id: "808", name: "TR-808 style",
    voices: [
      { name: "Kick", short: "BD", seconds: 1.0, render: kick(150, 48, 0.07, 0.9, 0.25, 1.1) },
      { name: "Snare", short: "SD", seconds: 0.4, render: snare(180, 330, 0.12, 0.2, 0.55) },
      { name: "Clap", short: "CP", seconds: 0.5, render: clap(0.28) },
      { name: "Closed hat", short: "CH", seconds: 0.15, choke: 1, render: metal(0.06, 0.8) },
      { name: "Open hat", short: "OH", seconds: 0.8, choke: 1, render: metal(0.55, 0.7) },
      { name: "Rim", short: "RS", seconds: 0.1, render: blip(1700, 0.03, "triangle", 0.7) },
      { name: "Low tom", short: "LT", seconds: 0.6, render: tom(95, 0.45) },
      { name: "Mid tom", short: "MT", seconds: 0.5, render: tom(140, 0.38) },
      { name: "Hi tom", short: "HT", seconds: 0.45, render: tom(200, 0.32) },
      { name: "Cowbell", short: "CB", seconds: 0.5, render: cowbell() },
      { name: "Conga", short: "CG", seconds: 0.35, render: tom(330, 0.22) },
      { name: "Clave", short: "CL", seconds: 0.1, render: blip(2500, 0.04, "sine", 0.7) },
      { name: "Cymbal", short: "CY", seconds: 2.2, render: metal(1.8, 0.55, 8000, 5000) },
      { name: "Shaker", short: "MA", seconds: 0.12, render: shaker(0.06) },
      { name: "Snap", short: "SN", seconds: 0.25, render: snap() },
      { name: "Sub boom", short: "SUB", seconds: 2.6, render: kick(110, 46, 0.12, 2.4, 0.15, 1.6) },
    ],
  },
  {
    id: "909", name: "TR-909 style",
    voices: [
      { name: "Kick", short: "BD", seconds: 0.7, render: kick(260, 52, 0.035, 0.5, 0.6, 2.2) },
      { name: "Snare", short: "SD", seconds: 0.35, render: snare(190, 290, 0.08, 0.22, 0.8, 900) },
      { name: "Clap", short: "CP", seconds: 0.45, render: clap(0.22, 1300) },
      { name: "Closed hat", short: "CH", seconds: 0.12, choke: 1, render: noiseHat(0.05, 0.7) },
      { name: "Open hat", short: "OH", seconds: 0.6, choke: 1, render: noiseHat(0.4, 0.6) },
      { name: "Rim", short: "RS", seconds: 0.1, render: blip(1900, 0.025, "square", 0.4) },
      { name: "Low tom", short: "LT", seconds: 0.5, render: tom(110, 0.35) },
      { name: "Mid tom", short: "MT", seconds: 0.45, render: tom(160, 0.3) },
      { name: "Hi tom", short: "HT", seconds: 0.4, render: tom(230, 0.26) },
      { name: "Ride", short: "RD", seconds: 1.6, render: metal(1.3, 0.4, 9000, 6000) },
      { name: "Crash", short: "CR", seconds: 2.0, render: noiseHat(1.6, 0.6, 4000) },
      { name: "Clave", short: "CL", seconds: 0.1, render: blip(2500, 0.04, "sine", 0.7) },
      { name: "Shaker", short: "SH", seconds: 0.12, render: shaker(0.07) },
      { name: "Snap", short: "SN", seconds: 0.25, render: snap() },
      { name: "Perc", short: "PC", seconds: 0.2, render: blip(620, 0.12, "triangle", 0.7) },
      { name: "Sub boom", short: "SUB", seconds: 2.6, render: kick(110, 46, 0.12, 2.4, 0.15, 1.6) },
    ],
  },
  {
    id: "trap", name: "Trap",
    voices: [
      { name: "808 largo", short: "808", seconds: 3.0, render: kick(120, 44, 0.09, 2.8, 0.2, 2.2) },
      { name: "Snare trap", short: "SD", seconds: 0.35, render: snare(210, 340, 0.06, 0.18, 0.9, 1800) },
      { name: "Clap", short: "CP", seconds: 0.4, render: clap(0.2, 1250) },
      { name: "Hat", short: "HH", seconds: 0.08, choke: 1, render: metal(0.03, 0.8, 11000, 8000) },
      { name: "Open hat", short: "OH", seconds: 0.5, choke: 1, render: metal(0.32, 0.6, 11000, 8000) },
      { name: "Rim", short: "RIM", seconds: 0.1, render: blip(1700, 0.03, "triangle", 0.7) },
      { name: "Kick punch", short: "BD", seconds: 0.4, render: kick(220, 55, 0.04, 0.3, 0.5, 2.0) },
      { name: "Perc", short: "PC", seconds: 0.2, render: blip(820, 0.08, "triangle", 0.7) },
      { name: "Snap", short: "SN", seconds: 0.25, render: snap() },
      { name: "Tom", short: "TM", seconds: 0.5, render: tom(150, 0.35) },
      { name: "Shaker", short: "SH", seconds: 0.12, render: shaker(0.05) },
      { name: "Cowbell", short: "CB", seconds: 0.5, render: cowbell() },
      { name: "Crash", short: "CR", seconds: 2.0, render: noiseHat(1.6, 0.55, 5000) },
      { name: "Clave", short: "CL", seconds: 0.1, render: blip(2500, 0.04, "sine", 0.7) },
      { name: "Sub 808 bajo", short: "SUB", seconds: 3.0, render: kick(90, 38, 0.1, 2.8, 0.1, 2.6) },
      { name: "Snare roll", short: "SR", seconds: 0.2, render: snare(230, 360, 0.04, 0.09, 0.8, 2000) },
    ],
  },
  {
    id: "boombap", name: "Boom Bap",
    voices: [
      { name: "Kick gordo", short: "BD", seconds: 0.6, render: kick(140, 50, 0.06, 0.45, 0.45, 3.0) },
      { name: "Snare seca", short: "SD", seconds: 0.35, render: snare(185, 260, 0.1, 0.2, 1.0, 700) },
      { name: "Rim", short: "RIM", seconds: 0.12, render: blip(1500, 0.04, "triangle", 0.8) },
      { name: "Hat cerrado", short: "HH", seconds: 0.12, choke: 1, render: noiseHat(0.045, 0.6, 7000) },
      { name: "Hat abierto", short: "OH", seconds: 0.45, choke: 1, render: noiseHat(0.3, 0.5, 7000) },
      { name: "Kick 2", short: "BD2", seconds: 0.5, render: kick(110, 48, 0.05, 0.35, 0.3, 2.5) },
      { name: "Snare 2", short: "SD2", seconds: 0.3, render: snare(200, 300, 0.08, 0.16, 0.9, 1100) },
      { name: "Shaker", short: "SH", seconds: 0.12, render: shaker(0.06) },
      { name: "Tom bajo", short: "LT", seconds: 0.5, render: tom(100, 0.4) },
      { name: "Tom alto", short: "HT", seconds: 0.4, render: tom(180, 0.3) },
      { name: "Ride", short: "RD", seconds: 1.4, render: metal(1.1, 0.35, 9000, 6000) },
      { name: "Clap", short: "CP", seconds: 0.4, render: clap(0.25, 1000) },
      { name: "Snap", short: "SN", seconds: 0.25, render: snap() },
      { name: "Conga", short: "CG", seconds: 0.35, render: tom(300, 0.22) },
      { name: "Crash", short: "CR", seconds: 1.8, render: noiseHat(1.4, 0.5, 4500) },
      { name: "Vinyl hit", short: "VNL", seconds: 0.3, render: shaker(0.2) },
    ],
  },
  {
    id: "house", name: "House / Techno",
    voices: [
      { name: "Kick 4x4", short: "BD", seconds: 0.6, render: kick(200, 50, 0.05, 0.42, 0.5, 2.0) },
      { name: "Clap", short: "CP", seconds: 0.45, render: clap(0.24, 1200) },
      { name: "Snare", short: "SD", seconds: 0.3, render: snare(200, 320, 0.07, 0.18, 0.7, 1300) },
      { name: "Hat cerrado", short: "CH", seconds: 0.1, choke: 1, render: noiseHat(0.04, 0.65, 9000) },
      { name: "Hat abierto", short: "OH", seconds: 0.5, choke: 1, render: noiseHat(0.32, 0.55, 8500) },
      { name: "Kick techno", short: "BDT", seconds: 0.7, render: kick(170, 45, 0.06, 0.55, 0.35, 4.0) },
      { name: "Rumble", short: "RMB", seconds: 1.2, render: kick(80, 40, 0.2, 1.1, 0, 3.0) },
      { name: "Ride", short: "RD", seconds: 1.4, render: metal(1.2, 0.4, 9500, 6500) },
      { name: "Shaker", short: "SH", seconds: 0.12, render: shaker(0.05) },
      { name: "Rim", short: "RIM", seconds: 0.1, render: blip(1800, 0.03, "triangle", 0.7) },
      { name: "Perc alta", short: "PC1", seconds: 0.15, render: blip(1200, 0.06, "triangle", 0.6) },
      { name: "Perc baja", short: "PC2", seconds: 0.2, render: blip(520, 0.1, "triangle", 0.7) },
      { name: "Tom", short: "TM", seconds: 0.5, render: tom(140, 0.35) },
      { name: "Cowbell", short: "CB", seconds: 0.5, render: cowbell() },
      { name: "Crash", short: "CR", seconds: 2.0, render: noiseHat(1.6, 0.55, 5000) },
      { name: "Snap", short: "SN", seconds: 0.25, render: snap() },
    ],
  },
];

/** Frecuencia de referencia del bajo 808 (La1). */
export const BASS_REF_HZ = 55;

/** 808 "boom" sostenido para tocar notas (se re-afina con playbackRate). */
export function renderBass808(c: C): void {
  const o = c.createOscillator();
  o.frequency.setValueAtTime(BASS_REF_HZ * 1.5, 0);
  o.frequency.exponentialRampToValueAtTime(BASS_REF_HZ, 0.04);
  const g = c.createGain();
  g.gain.setValueAtTime(0, 0);
  g.gain.linearRampToValueAtTime(1, 0.003);
  g.gain.setTargetAtTime(0.55, 0.01, 0.4);
  g.gain.setTargetAtTime(0.0, 2.6, 0.4);
  const sh = shaper(c, 1.8);
  o.connect(g); g.connect(sh); sh.connect(c.destination);
  o.start();
}

export async function renderVoice(sr: number, seconds: number, fn: (c: C) => void): Promise<AudioBuffer> {
  const off = new OfflineAudioContext(1, Math.ceil(sr * seconds), sr);
  fn(off);
  return off.startRendering();
}
