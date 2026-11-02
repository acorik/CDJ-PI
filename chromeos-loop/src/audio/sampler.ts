// Sampler de 8 slots. Trae sonidos sintetizados (sin archivos que
// descargar) y se pueden sustituir por cualquier audio del usuario.

export interface Slot {
  name: string;
  buffer: AudioBuffer | null;
  source: AudioBufferSourceNode | null;
  color: string;
}

export type SynthFn = (c: OfflineAudioContext) => void;

function env(c: OfflineAudioContext, g: GainNode, a: number, peak: number, d: number, t0 = 0) {
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  void c;
}

function noise(c: OfflineAudioContext, seconds: number): AudioBufferSourceNode {
  const b = c.createBuffer(1, Math.ceil(c.sampleRate * seconds), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = c.createBufferSource();
  s.buffer = b;
  return s;
}

export const SYNTHS: [string, number, SynthFn][] = [
  ["Air horn", 1.6, (c) => {
    for (const t0 of [0, 0.32, 0.64]) {
      const g = c.createGain();
      env(c, g, 0.01, 0.18, t0 === 0.64 ? 0.9 : 0.28, t0);
      g.connect(c.destination);
      for (const f of [466, 587, 698, 932]) {
        const o = c.createOscillator(); o.type = "sawtooth"; o.frequency.value = f;
        o.frequency.setValueAtTime(f * 0.97, t0); o.frequency.linearRampToValueAtTime(f, t0 + 0.05);
        o.connect(g); o.start(t0); o.stop(t0 + 1.6);
      }
    }
  }],
  ["Siren", 2.4, (c) => {
    const o = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain(), g = c.createGain();
    o.type = "square"; o.frequency.value = 800; lfo.frequency.value = 2.2; lg.gain.value = 350;
    lfo.connect(lg); lg.connect(o.frequency); o.connect(g); g.connect(c.destination);
    env(c, g, 0.05, 0.12, 2.3); o.start(); lfo.start();
  }],
  ["Laser", 0.6, (c) => {
    const o = c.createOscillator(), g = c.createGain();
    o.type = "sawtooth"; o.frequency.setValueAtTime(3200, 0); o.frequency.exponentialRampToValueAtTime(120, 0.5);
    o.connect(g); g.connect(c.destination); env(c, g, 0.005, 0.3, 0.55); o.start();
  }],
  ["Riser", 4, (c) => {
    const n = noise(c, 4), f = c.createBiquadFilter(), g = c.createGain();
    f.type = "bandpass"; f.Q.value = 3; f.frequency.setValueAtTime(300, 0); f.frequency.exponentialRampToValueAtTime(9000, 3.9);
    g.gain.setValueAtTime(0.001, 0); g.gain.exponentialRampToValueAtTime(0.5, 3.8); g.gain.linearRampToValueAtTime(0, 4);
    n.connect(f); f.connect(g); g.connect(c.destination); n.start();
  }],
  ["Impact", 2.5, (c) => {
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(110, 0); o.frequency.exponentialRampToValueAtTime(32, 1.5);
    o.connect(g); g.connect(c.destination); env(c, g, 0.002, 0.9, 2.3); o.start();
    const n = noise(c, 2.5), f = c.createBiquadFilter(), ng = c.createGain();
    f.type = "lowpass"; f.frequency.setValueAtTime(6000, 0); f.frequency.exponentialRampToValueAtTime(200, 2);
    n.connect(f); f.connect(ng); ng.connect(c.destination); env(c, ng, 0.002, 0.35, 2.2); n.start();
  }],
  ["Kick", 0.5, (c) => {
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(150, 0); o.frequency.exponentialRampToValueAtTime(45, 0.12);
    o.connect(g); g.connect(c.destination); env(c, g, 0.001, 1, 0.45); o.start();
  }],
  ["Clap", 0.5, (c) => {
    for (const t0 of [0, 0.012, 0.024, 0.04]) {
      const n = noise(c, 0.4), f = c.createBiquadFilter(), g = c.createGain();
      f.type = "bandpass"; f.frequency.value = 1400; f.Q.value = 1.2;
      n.connect(f); f.connect(g); g.connect(c.destination);
      env(c, g, 0.001, 0.6, t0 === 0.04 ? 0.3 : 0.02, t0); n.start(t0);
    }
  }],
  ["Rewind", 1.2, (c) => {
    const o = c.createOscillator(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
    o.type = "sawtooth"; o.frequency.setValueAtTime(200, 0); o.frequency.exponentialRampToValueAtTime(2400, 1.1);
    lfo.frequency.setValueAtTime(8, 0); lfo.frequency.linearRampToValueAtTime(40, 1.1); lg.gain.value = 150;
    lfo.connect(lg); lg.connect(o.frequency); o.connect(g); g.connect(c.destination);
    env(c, g, 0.02, 0.15, 1.15); o.start(); lfo.start();
  }],
];

const COLORS = ["#e8384f", "#fd9a00", "#f5d200", "#30c94c", "#21b8c9", "#3a7bff", "#a35cff", "#ff5fb0"];

export class Sampler {
  readonly output: GainNode;
  slots: Slot[] = [];

  constructor(private ctx: AudioContext) {
    this.output = ctx.createGain();
    this.output.gain.value = 0.8;
    for (let i = 0; i < 8; i++) this.slots.push({ name: SYNTHS[i][0], buffer: null, source: null, color: COLORS[i] });
    void this.renderDefaults();
  }

  private async renderDefaults(): Promise<void> {
    for (let i = 0; i < SYNTHS.length; i++) {
      const [, secs, fn] = SYNTHS[i];
      const off = new OfflineAudioContext(1, Math.ceil(this.ctx.sampleRate * secs), this.ctx.sampleRate);
      fn(off);
      if (!this.slots[i].buffer) this.slots[i].buffer = await off.startRendering();
    }
  }

  async loadFile(i: number, file: File): Promise<void> {
    const buf = await this.ctx.decodeAudioData(await file.arrayBuffer());
    this.slots[i].buffer = buf;
    this.slots[i].name = file.name.replace(/\.[^.]+$/, "").slice(0, 16);
  }

  play(i: number): void {
    const s = this.slots[i];
    if (!s?.buffer) return;
    this.stop(i);
    const src = this.ctx.createBufferSource();
    src.buffer = s.buffer;
    src.connect(this.output);
    src.onended = () => { if (s.source === src) s.source = null; };
    src.start();
    s.source = src;
  }

  stop(i: number): void {
    const s = this.slots[i];
    if (s?.source) { try { s.source.stop(); } catch { /* */ } s.source = null; }
  }

  isPlaying(i: number): boolean {
    return !!this.slots[i]?.source;
  }

  setVolume(v: number): void {
    this.output.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }
}
