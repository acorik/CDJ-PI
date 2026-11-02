import { KITS, BASS_REF_HZ, renderBass808, renderVoice } from "./kits";
import { dbGet, dbPut, dbDelete } from "../library/db";

export interface DrumParams {
  kickDecay: number; // 0..1
  kickTune: number; // 0..1 (0.5 = original)
  snareTone: number;
  hatDecay: number;
  bassDecay: number;
  bassGlide: number;
}

interface StoredSample { name: string; data: ArrayBuffer }

/**
 * Caja de ritmos (16 voces) + bajo 808 monofónico, con su propio bus:
 * filtro (LPF/HPF en un knob), saturación y volumen. El bus va al master
 * y, opcionalmente, a los auriculares (para preparar patrones sin que se oiga).
 */
export class DrumMachine {
  readonly bus: GainNode; // salida final -> master
  readonly cue: GainNode; // -> cueBus
  private input: GainNode;
  private lp: BiquadFilterNode;
  private hp: BiquadFilterNode;
  private drive: WaveShaperNode;
  private driveMix: GainNode;
  private cleanMix: GainNode;
  kitIdx = 0;
  private kits: (AudioBuffer | null)[][] = KITS.map((k) => k.voices.map(() => null));
  /** samples del usuario por pad (sustituyen a la voz del kit) */
  user: (AudioBuffer | null)[] = new Array(16).fill(null);
  userNames: string[] = new Array(16).fill("");
  private bassBuf: AudioBuffer | null = null;
  private chokes = new Map<number, { src: AudioBufferSourceNode; g: GainNode }>();
  private bassVoice: { src: AudioBufferSourceNode; g: GainNode; rate: number } | null = null;
  params: DrumParams = { kickDecay: 0.6, kickTune: 0.5, snareTone: 0.5, hatDecay: 0.5, bassDecay: 0.6, bassGlide: 0.25 };
  volume = 0.8;
  filter = 0.5;
  driveAmt = 0;
  cueOn = false;
  ready = false;
  /** para la UI: último disparo por voz (performance.now) */
  hitAt = new Float64Array(17);

  constructor(private ctx: AudioContext) {
    this.input = ctx.createGain();
    this.lp = ctx.createBiquadFilter(); this.lp.type = "lowpass"; this.lp.frequency.value = 22000; this.lp.Q.value = 1;
    this.hp = ctx.createBiquadFilter(); this.hp.type = "highpass"; this.hp.frequency.value = 10; this.hp.Q.value = 1;
    this.drive = ctx.createWaveShaper();
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(x * 3) / Math.tanh(3); }
    this.drive.curve = curve;
    this.drive.oversample = "2x";
    this.driveMix = ctx.createGain(); this.driveMix.gain.value = 0;
    this.cleanMix = ctx.createGain();
    this.bus = ctx.createGain();
    this.cue = ctx.createGain(); this.cue.gain.value = 0;
    this.input.connect(this.lp); this.lp.connect(this.hp);
    this.hp.connect(this.cleanMix); this.hp.connect(this.drive); this.drive.connect(this.driveMix);
    this.cleanMix.connect(this.bus); this.driveMix.connect(this.bus);
    this.bus.connect(this.cue);
    this.setVolume(this.volume);
  }

  async init(): Promise<void> {
    const sr = this.ctx.sampleRate;
    // primero el kit activo (para poder tocar ya), luego el resto
    for (let k = 0; k < KITS.length; k++) {
      for (let v = 0; v < 16; v++) {
        const def = KITS[k].voices[v];
        this.kits[k][v] = await renderVoice(sr, def.seconds, def.render);
      }
      if (k === 0) this.ready = true;
    }
    this.bassBuf = await renderVoice(sr, 3.2, renderBass808);
    for (let i = 0; i < 16; i++) {
      const s = await dbGet<StoredSample>("samples", `pad${i}`).catch(() => undefined);
      if (s) { try { this.user[i] = await this.ctx.decodeAudioData(s.data.slice(0)); this.userNames[i] = s.name; } catch { /* */ } }
    }
  }

  get kitName(): string { return KITS[this.kitIdx].name; }

  voiceName(i: number): string {
    return this.userNames[i] || KITS[this.kitIdx].voices[i].short;
  }

  async loadUserSample(i: number, file: File): Promise<void> {
    const data = await file.arrayBuffer();
    this.user[i] = await this.ctx.decodeAudioData(data.slice(0));
    this.userNames[i] = file.name.replace(/\.[^.]+$/, "").slice(0, 10);
    await dbPut("samples", `pad${i}`, { name: this.userNames[i], data } satisfies StoredSample);
  }

  async clearUserSample(i: number): Promise<void> {
    this.user[i] = null;
    this.userNames[i] = "";
    await dbDelete("samples", `pad${i}`);
  }

  setVolume(v: number): void { this.volume = v; this.bus.gain.setTargetAtTime(Math.pow(v, 1.5) * 1.2, this.ctx.currentTime, 0.02); }
  setCue(on: boolean): void { this.cueOn = on; this.cue.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.01); }

  setFilter(v: number): void {
    this.filter = v;
    const t = this.ctx.currentTime;
    if (v < 0.47) {
      const x = (0.47 - v) / 0.47;
      this.lp.frequency.setTargetAtTime(20000 * Math.pow(150 / 20000, x), t, 0.02);
      this.hp.frequency.setTargetAtTime(10, t, 0.02);
    } else if (v > 0.53) {
      const x = (v - 0.53) / 0.47;
      this.hp.frequency.setTargetAtTime(20 * Math.pow(4000 / 20, x), t, 0.02);
      this.lp.frequency.setTargetAtTime(22000, t, 0.02);
    } else {
      this.lp.frequency.setTargetAtTime(22000, t, 0.02);
      this.hp.frequency.setTargetAtTime(10, t, 0.02);
    }
  }

  setDrive(v: number): void {
    this.driveAmt = v;
    const t = this.ctx.currentTime;
    this.driveMix.gain.setTargetAtTime(v * 0.9, t, 0.02);
    this.cleanMix.gain.setTargetAtTime(1 - v * 0.6, t, 0.02);
  }

  /** Dispara la voz `v` (0..15) en el instante `when` (tiempo de AudioContext). */
  trigger(v: number, velocity: number, when = 0): void {
    const buf = this.user[v] ?? this.kits[this.kitIdx][v];
    if (!buf) return;
    const t = Math.max(this.ctx.currentTime, when);
    const def = KITS[this.kitIdx].voices[v];
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    const vel = Math.pow(Math.max(1, velocity) / 127, 1.4);
    g.gain.setValueAtTime(vel, t);
    const p = this.params;
    if (!this.user[v]) {
      // parámetros "de máquina" por tipo de voz
      if (def.short === "BD" || def.short === "SUB") {
        src.playbackRate.value = Math.pow(2, (p.kickTune - 0.5) * 1.0);
        const dec = 0.08 + p.kickDecay * buf.duration;
        g.gain.setTargetAtTime(0, t + dec * 0.6, dec * 0.25);
      } else if (def.short === "SD" || def.short === "CP") {
        src.playbackRate.value = Math.pow(2, (p.snareTone - 0.5) * 0.8);
      } else if (def.choke) {
        const dec = 0.02 + p.hatDecay * buf.duration * 1.4;
        g.gain.setTargetAtTime(0, t + dec * 0.5, dec * 0.3);
      }
    }
    src.connect(g); g.connect(this.input);
    if (def.choke && !this.user[v]) {
      const prev = this.chokes.get(def.choke);
      if (prev) { prev.g.gain.cancelScheduledValues(t); prev.g.gain.setTargetAtTime(0, t, 0.004); }
      this.chokes.set(def.choke, { src, g });
    }
    src.start(t);
    src.onended = () => { src.disconnect(); g.disconnect(); };
    const delay = (t - this.ctx.currentTime) * 1000;
    setTimeout(() => { this.hitAt[v] = performance.now(); }, Math.max(0, delay));
  }

  /** Bajo 808 monofónico con glide. `hz` = frecuencia de la nota. */
  bassOn(hz: number, velocity: number, when = 0): void {
    if (!this.bassBuf) return;
    const t = Math.max(this.ctx.currentTime, when);
    const rate = hz / BASS_REF_HZ;
    const src = this.ctx.createBufferSource();
    src.buffer = this.bassBuf;
    const g = this.ctx.createGain();
    const vel = Math.pow(Math.max(1, velocity) / 127, 1.2) * 0.9;
    g.gain.setValueAtTime(vel, t);
    const decay = 0.15 + this.params.bassDecay * 2.4;
    g.gain.setTargetAtTime(0, t + decay * 0.5, decay * 0.35);
    const prev = this.bassVoice;
    const glide = this.params.bassGlide * 0.25;
    if (prev && glide > 0.005) {
      src.playbackRate.setValueAtTime(prev.rate, t);
      src.playbackRate.exponentialRampToValueAtTime(rate, t + glide);
    } else src.playbackRate.setValueAtTime(rate, t);
    if (prev) { prev.g.gain.cancelScheduledValues(t); prev.g.gain.setTargetAtTime(0, t, 0.006); }
    src.connect(g); g.connect(this.input);
    src.start(t);
    src.onended = () => { src.disconnect(); g.disconnect(); if (this.bassVoice?.src === src) this.bassVoice = null; };
    this.bassVoice = { src, g, rate };
    setTimeout(() => { this.hitAt[16] = performance.now(); }, Math.max(0, (t - this.ctx.currentTime) * 1000));
  }

  /** Suelta el bajo (al soltar el pad) con un release corto. */
  bassOff(when = 0): void {
    const v = this.bassVoice;
    if (!v) return;
    const t = Math.max(this.ctx.currentTime, when);
    v.g.gain.cancelScheduledValues(t);
    v.g.gain.setTargetAtTime(0, t, 0.06);
    this.bassVoice = null;
  }
}
