// Sinte polifónico sustractivo/FM hecho con nodos nativos de Web Audio
// (los osciladores y filtros corren en C++ dentro de Chrome: barato en CPU).

import { midiToHz } from "./theory";

export type Wave = "sine" | "triangle" | "sawtooth" | "square" | "pulse" | "thin" | "supersaw" | "organ" | "vox" | "ep" | "noise";
export type LfoTarget = "none" | "pitch" | "filter" | "amp";
export type ArpMode = "" | "up" | "down" | "updown" | "random" | "chord";

export interface Preset {
  name: string;
  cat: string;
  w1: Wave; d1: number;
  w2: Wave | null; s2: number; d2: number; m2: number;
  o: number; // octava global
  sub: number; nz: number;
  fm: number; // índice FM (>0: el osc 2 modula al 1 y no suena)
  uni: number; spr: number;
  ft: BiquadFilterType; fc: number; fq: number; fe: number; fk: number; fp: 2 | 4;
  a: number; d: number; s: number; r: number;
  fa: number; fd: number; fs: number; fr: number;
  lt: LfoTarget; lr: number; ld: number; ldel: number;
  gl: number; mono: boolean; vs: number;
  dr: number; ch: number; dl: number; rv: number; vol: number;
  arp: ArpMode; ar: number; ao: number;
  pb: number;
}

export interface Clock {
  isRunning(): boolean;
  beatAt(t: number): number;
  timeOfBeat(b: number): number;
  beatSec(): number;
}

const MAX_VOICES = 10;

function periodic(ctx: BaseAudioContext, harmonics: number[]): PeriodicWave {
  const re = new Float32Array(harmonics.length + 1);
  const im = new Float32Array(harmonics.length + 1);
  harmonics.forEach((a, i) => { im[i + 1] = a; });
  return ctx.createPeriodicWave(re, im);
}

function pulseWave(ctx: BaseAudioContext, duty: number): PeriodicWave {
  const n = 64, re = new Float32Array(n), im = new Float32Array(n);
  for (let k = 1; k < n; k++) im[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
  return ctx.createPeriodicWave(re, im);
}

class Voice {
  readonly started: number;
  released = false;
  private srcs: AudioScheduledSourceNode[] = [];
  private detunes: AudioParam[] = [];
  private freqs: { p: AudioParam; mult: number }[] = [];
  private amp: GainNode;
  private filters: BiquadFilterNode[] = [];
  private nodes: AudioNode[] = [];
  private base: number;

  constructor(private syn: Synth, readonly midi: number, vel: number, t: number) {
    const p = syn.preset;
    const ctx = syn.ctx;
    this.started = t;
    const f0 = midiToHz(midi + 12 * p.o);
    const mix = ctx.createGain();
    mix.gain.value = 0.3;
    this.nodes.push(mix);
    // ---- osciladores
    const uni = Math.max(1, Math.min(5, Math.round(p.uni)));
    const layer = (wave: Wave, mult: number, cents: number, level: number, uniCount: number): AudioScheduledSourceNode[] => {
      const made: AudioScheduledSourceNode[] = [];
      const g = ctx.createGain(); g.gain.value = level; g.connect(mix); this.nodes.push(g);
      if (wave === "noise") {
        const s = ctx.createBufferSource(); s.buffer = syn.noise; s.loop = true;
        s.loopStart = Math.random(); s.connect(g); made.push(s); return made;
      }
      const count = wave === "supersaw" ? 7 : uniCount;
      const spread = wave === "supersaw" ? Math.max(14, p.spr) : p.spr;
      for (let k = 0; k < count; k++) {
        const o = ctx.createOscillator();
        const w = syn.wave(wave);
        if (typeof w === "string") o.type = w as OscillatorType; else o.setPeriodicWave(w);
        o.frequency.value = f0 * mult;
        const off = count > 1 ? (k / (count - 1) - 0.5) * 2 * spread : 0;
        o.detune.value = cents + off;
        let dest: AudioNode = g;
        if (count > 1) {
          const pan = ctx.createStereoPanner();
          pan.pan.value = count > 1 ? ((k % 2 ? 1 : -1) * Math.min(1, spread / 25) * (0.4 + 0.6 * Math.abs(k / (count - 1) - 0.5) * 2)) : 0;
          const lv = ctx.createGain(); lv.gain.value = 1 / Math.sqrt(count);
          o.connect(lv); lv.connect(pan); pan.connect(g); this.nodes.push(pan, lv);
          dest = lv;
        } else o.connect(dest);
        this.detunes.push(o.detune);
        this.freqs.push({ p: o.frequency, mult });
        made.push(o);
      }
      return made;
    };
    const m1 = layer(p.w1, 1, p.d1, p.fm > 0 ? 1 : 1 - p.m2 * 0.5, uni) as OscillatorNode[];
    if (p.w2 && p.fm > 0) {
      // FM: el osc 2 modula la frecuencia del 1
      const mod = ctx.createOscillator();
      const w = syn.wave(p.w2);
      if (typeof w === "string") mod.type = w as OscillatorType; else mod.setPeriodicWave(w);
      const ratio = Math.pow(2, p.s2 / 12);
      mod.frequency.value = f0 * ratio;
      mod.detune.value = p.d2;
      const idx = ctx.createGain();
      // índice con su propia envolvente (brillo del ataque, como un DX)
      const depth = p.fm * f0 * ratio;
      idx.gain.setValueAtTime(depth * (0.4 + 0.6 * (vel / 127)), t);
      idx.gain.setTargetAtTime(depth * Math.max(0.15, p.fs), t + 0.005, Math.max(0.02, p.fd / 3));
      mod.connect(idx);
      for (const o of m1) if (o instanceof OscillatorNode) idx.connect(o.frequency);
      this.detunes.push(mod.detune);
      this.freqs.push({ p: mod.frequency, mult: ratio });
      this.srcs.push(mod);
      this.nodes.push(idx);
    } else if (p.w2 && p.m2 > 0) {
      this.srcs.push(...layer(p.w2, Math.pow(2, p.s2 / 12), p.d2, p.m2, uni));
    }
    this.srcs.push(...m1);
    if (p.sub > 0) this.srcs.push(...layer("sine", 0.5, 0, p.sub, 1));
    if (p.nz > 0) this.srcs.push(...layer("noise", 1, 0, p.nz * 0.5, 1));

    // ---- filtro (2 o 4 polos) con envolvente y keytrack
    let last: AudioNode = mix;
    const nf = p.fp === 4 ? 2 : 1;
    for (let i = 0; i < nf; i++) {
      const f = ctx.createBiquadFilter();
      f.type = p.ft;
      f.Q.value = i === 0 ? p.fq + syn.macro.res : Math.min(p.fq, 1);
      last.connect(f); last = f; this.filters.push(f);
    }
    this.base = Math.max(20, Math.min(18000, p.fc * Math.pow(f0 / 261.63, p.fk) * syn.macro.cutoff));
    const fPeak = Math.max(20, Math.min(19000, this.base * Math.pow(2, p.fe)));
    const fSus = Math.max(20, Math.min(19000, this.base * Math.pow(2, p.fe * p.fs)));
    for (const f of this.filters) {
      f.frequency.setValueAtTime(this.base, t);
      f.frequency.linearRampToValueAtTime(fPeak, t + Math.max(0.002, p.fa));
      f.frequency.setTargetAtTime(fSus, t + Math.max(0.002, p.fa), Math.max(0.005, p.fd / 3));
    }

    // ---- amplificador
    this.amp = ctx.createGain();
    const peak = (1 - p.vs + p.vs * Math.pow(vel / 127, 1.3)) * p.vol;
    const att = Math.max(0.002, p.a * syn.macro.attack);
    this.amp.gain.setValueAtTime(0, t);
    this.amp.gain.linearRampToValueAtTime(peak, t + att);
    this.amp.gain.setTargetAtTime(peak * p.s, t + att, Math.max(0.005, p.d / 3));
    last.connect(this.amp);
    let out: AudioNode = this.amp;

    // ---- LFO
    const lfoDepth = p.ld * syn.macro.lfo;
    if (p.lt !== "none" && lfoDepth > 0) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = p.lr;
      const lg = ctx.createGain();
      lg.gain.setValueAtTime(0, t);
      lg.gain.linearRampToValueAtTime(p.lt === "amp" ? lfoDepth * 0.5 : lfoDepth, t + 0.01 + p.ldel);
      lfo.connect(lg);
      if (p.lt === "pitch") for (const d of this.detunes) lg.connect(d);
      else if (p.lt === "filter") for (const f of this.filters) lg.connect(f.detune);
      else {
        const trem = ctx.createGain(); trem.gain.value = 1 - lfoDepth * 0.5;
        lg.connect(trem.gain); this.amp.connect(trem); out = trem; this.nodes.push(trem);
      }
      this.srcs.push(lfo);
      this.nodes.push(lg);
    }
    out.connect(syn.voiceBus);
    this.nodes.push(this.amp, ...this.filters);
    for (const d of this.detunes) syn.bend.connect(d);
    for (const s of this.srcs) s.start(t);
  }

  glideTo(midi: number, t: number): void {
    const p = this.syn.preset;
    const f0 = midiToHz(midi + 12 * p.o);
    const tc = Math.max(0.003, p.gl / 3);
    for (const { p: fp, mult } of this.freqs) fp.setTargetAtTime(f0 * mult, t, tc);
    const base = Math.max(20, Math.min(18000, p.fc * Math.pow(f0 / 261.63, p.fk) * this.syn.macro.cutoff));
    void base;
  }

  release(t: number, fast = false): void {
    if (this.released) return;
    this.released = true;
    const p = this.syn.preset;
    const rel = fast ? 0.012 : Math.max(0.01, p.r * this.syn.macro.release);
    const g = this.amp.gain as any;
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t); else { this.amp.gain.cancelScheduledValues(t); }
    this.amp.gain.setTargetAtTime(0, t, rel / 4);
    if (!fast) {
      for (const f of this.filters) {
        const fq = f.frequency as any;
        if (fq.cancelAndHoldAtTime) fq.cancelAndHoldAtTime(t);
        f.frequency.setTargetAtTime(this.base, t, Math.max(0.01, p.fr / 4));
      }
    }
    const end = t + rel * 1.6 + 0.05;
    for (const s of this.srcs) { try { s.stop(end); } catch { /* */ } }
    const first = this.srcs[0];
    if (first) first.onended = () => this.dispose();
    else setTimeout(() => this.dispose(), (end - this.syn.ctx.currentTime) * 1000 + 50);
  }

  private dispose(): void {
    for (const d of this.detunes) { try { this.syn.bend.disconnect(d); } catch { /* */ } }
    for (const s of this.srcs) { try { s.disconnect(); } catch { /* */ } }
    for (const n of this.nodes) { try { n.disconnect(); } catch { /* */ } }
    this.syn.voiceGone(this);
  }
}

export class Synth {
  readonly voiceBus: GainNode;
  readonly out: GainNode;
  readonly bend: ConstantSourceNode;
  readonly noise: AudioBuffer;
  preset!: Preset;
  macro = { cutoff: 1, res: 0, attack: 1, release: 1, lfo: 1 };
  private voices: Voice[] = [];
  private held = new Map<number, Voice>();
  private monoStack: number[] = [];
  private waves = new Map<Wave, PeriodicWave | OscillatorType>();
  private driveNode: WaveShaperNode;
  private driveWet: GainNode;
  private driveDry: GainNode;
  private chorusWet: GainNode;
  private chorusD: DelayNode[] = [];
  private delaySend: GainNode;
  private delay: DelayNode;
  private delayFb: GainNode;
  private revSend: GainNode;
  // arpegiador
  private arpHeld: number[] = [];
  private arpTimer = 0;
  private arpLast = -Infinity;
  private arpFreeT0 = 0;
  private arpVel = 100;
  /** notas que están sonando (para la UI) */
  sounding = new Set<number>();

  constructor(readonly ctx: AudioContext, private clock: Clock) {
    const g = (v = 1) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    this.voiceBus = g(); this.out = g();
    this.bend = ctx.createConstantSource(); this.bend.offset.value = 0; this.bend.start();
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = nb;
    // drive
    this.driveNode = ctx.createWaveShaper();
    const n = 2048, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(x * 4) / Math.tanh(4); }
    this.driveNode.curve = curve; this.driveNode.oversample = "2x";
    this.driveWet = g(0); this.driveDry = g(1);
    const post = g();
    this.voiceBus.connect(this.driveDry); this.driveDry.connect(post);
    this.voiceBus.connect(this.driveNode); this.driveNode.connect(this.driveWet); this.driveWet.connect(post);
    // chorus estéreo (2 líneas moduladas)
    this.chorusWet = g(0);
    const merger = ctx.createChannelMerger(2);
    for (let c = 0; c < 2; c++) {
      const dl = ctx.createDelay(0.05); dl.delayTime.value = 0.012 + c * 0.006;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.6 + c * 0.23;
      const lg = g(0.0035); lfo.connect(lg); lg.connect(dl.delayTime); lfo.start();
      post.connect(dl); dl.connect(merger, 0, c);
      this.chorusD.push(dl);
    }
    merger.connect(this.chorusWet); this.chorusWet.connect(this.out);
    post.connect(this.out);
    // delay sincronizado (3/16) y reverb
    this.delaySend = g(0); this.delay = ctx.createDelay(4); this.delayFb = g(0.38);
    const dlp = ctx.createBiquadFilter(); dlp.frequency.value = 4500;
    this.out.connect(this.delaySend); this.delaySend.connect(this.delay); this.delay.connect(dlp); dlp.connect(this.delayFb); this.delayFb.connect(this.delay);
    this.fxOut = g();
    dlp.connect(this.fxOut);
    this.revSend = g(0);
    const conv = ctx.createConvolver();
    const len = ctx.sampleRate * 2.4, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const dd = ir.getChannelData(c); for (let i = 0; i < len; i++) dd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
    conv.buffer = ir;
    this.out.connect(this.revSend); this.revSend.connect(conv); conv.connect(this.fxOut);
  }
  /** salida de los envíos (delay/reverb): se mezcla con `out` en el bus de instrumentos */
  readonly fxOut: GainNode;

  wave(w: Wave): PeriodicWave | OscillatorType {
    const c = this.waves.get(w);
    if (c) return c;
    let v: PeriodicWave | OscillatorType;
    switch (w) {
      case "pulse": v = pulseWave(this.ctx, 0.25); break;
      case "thin": v = pulseWave(this.ctx, 0.125); break;
      case "organ": v = periodic(this.ctx, [1, 0.8, 0.6, 0.5, 0, 0.35, 0, 0.3, 0, 0, 0, 0.2]); break;
      case "vox": v = periodic(this.ctx, [0.6, 0.5, 1, 0.9, 0.4, 0.2, 0.15, 0.5, 0.45, 0.1, 0.05, 0.05]); break;
      case "ep": v = periodic(this.ctx, [1, 0.15, 0.4, 0.05, 0.12, 0, 0.04]); break;
      case "supersaw": v = "sawtooth"; break;
      case "noise": v = "sine"; break;
      default: v = w as OscillatorType;
    }
    this.waves.set(w, v);
    return v;
  }

  setPreset(p: Preset): void {
    this.allOff();
    this.preset = p;
    const t = this.ctx.currentTime;
    this.driveWet.gain.setTargetAtTime(p.dr * 0.9, t, 0.02);
    this.driveDry.gain.setTargetAtTime(1 - p.dr * 0.5, t, 0.02);
    this.chorusWet.gain.setTargetAtTime(p.ch * 0.9, t, 0.02);
    this.delaySend.gain.setTargetAtTime(p.dl * 0.6, t, 0.02);
    this.revSend.gain.setTargetAtTime(p.rv * 0.9, t, 0.02);
    this.updateTempo();
  }

  updateTempo(): void {
    this.delay.delayTime.setTargetAtTime(Math.min(3.9, this.clock.beatSec() * 0.75), this.ctx.currentTime, 0.05);
  }

  setBend(v: number): void {
    // v -1..1
    this.bend.offset.setTargetAtTime(v * this.preset.pb * 100, this.ctx.currentTime, 0.01);
  }

  voiceGone(v: Voice): void {
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
  }

  noteOn(midi: number, vel = 100, when = 0): void {
    const p = this.preset;
    if (p.arp) { this.arpOn(midi, vel); return; }
    this.play(midi, vel, when);
  }

  noteOff(midi: number, when = 0): void {
    if (this.preset.arp) { this.arpOff(midi); return; }
    this.stop(midi, when);
  }

  private play(midi: number, vel: number, when: number): void {
    const t = Math.max(this.ctx.currentTime, when);
    const p = this.preset;
    if (p.mono) {
      const cur = [...this.held.values()][0];
      this.monoStack = this.monoStack.filter((m) => m !== midi);
      this.monoStack.push(midi);
      if (cur && !cur.released && p.gl > 0) {
        cur.glideTo(midi, t);
        this.held.clear(); this.held.set(midi, cur);
        this.sounding.clear(); this.sounding.add(midi);
        return;
      }
      for (const v of this.voices) v.release(t, true);
      this.held.clear();
    } else {
      const prev = this.held.get(midi);
      if (prev) prev.release(t, true);
      const active = this.voices.filter((v) => !v.released);
      if (active.length >= MAX_VOICES) active.sort((a, b) => a.started - b.started)[0].release(t, true);
    }
    const v = new Voice(this, midi, vel, t);
    this.voices.push(v);
    this.held.set(midi, v);
    this.sounding.add(midi);
  }

  private stop(midi: number, when: number): void {
    const t = Math.max(this.ctx.currentTime, when);
    const p = this.preset;
    this.sounding.delete(midi);
    if (p.mono) {
      this.monoStack = this.monoStack.filter((m) => m !== midi);
      const cur = [...this.held.values()][0];
      if (!cur) return;
      const back = this.monoStack[this.monoStack.length - 1];
      if (back !== undefined && p.gl >= 0 && cur.midi !== back && !cur.released) {
        cur.glideTo(back, t); this.held.clear(); this.held.set(back, cur); this.sounding.add(back);
        return;
      }
      if (back === undefined || this.held.has(midi)) { cur.release(t); this.held.clear(); }
      return;
    }
    const v = this.held.get(midi);
    if (v) { v.release(t); this.held.delete(midi); }
  }

  allOff(): void {
    const t = this.ctx.currentTime;
    for (const v of this.voices) v.release(t, true);
    this.held.clear();
    this.monoStack = [];
    this.arpHeld = [];
    this.sounding.clear();
    clearInterval(this.arpTimer);
    this.arpTimer = 0;
  }

  // ------------------------------------------------------------- arpegiador
  private arpOn(midi: number, vel: number): void {
    if (!this.arpHeld.includes(midi)) this.arpHeld.push(midi);
    this.arpVel = vel;
    if (!this.arpTimer) {
      this.arpFreeT0 = this.ctx.currentTime;
      this.arpLast = -Infinity;
      this.arpTimer = window.setInterval(() => this.arpTick(), 20);
      this.arpTick();
    }
  }

  private arpOff(midi: number): void {
    this.arpHeld = this.arpHeld.filter((m) => m !== midi);
    if (!this.arpHeld.length) { clearInterval(this.arpTimer); this.arpTimer = 0; }
  }

  private arpTick(): void {
    const p = this.preset;
    if (!this.arpHeld.length) return;
    const now = this.ctx.currentTime;
    const rate = p.ar || 0.25;
    const beatSec = this.clock.beatSec();
    const beatAt = (t: number) => this.clock.isRunning() ? this.clock.beatAt(t) : (t - this.arpFreeT0) / beatSec;
    const timeOf = (b: number) => this.clock.isRunning() ? this.clock.timeOfBeat(b) : this.arpFreeT0 + b * beatSec;
    let k = Math.max(this.arpLast + 1, Math.ceil(beatAt(now) / rate - 0.02));
    const notes = [...this.arpHeld].sort((a, b) => a - b);
    const seq: number[] = [];
    for (let o = 0; o < Math.max(1, p.ao); o++) for (const n of notes) seq.push(n + 12 * o);
    for (; ; k++) {
      const t = timeOf(k * rate);
      if (t > now + 0.1) break;
      this.arpLast = k;
      if (t < now - 0.02) continue;
      const gate = rate * beatSec * 0.55;
      let chosen: number[];
      const L = seq.length;
      switch (p.arp) {
        case "down": chosen = [seq[L - 1 - (((k % L) + L) % L)]]; break;
        case "updown": { const per = Math.max(1, 2 * L - 2); const i = ((k % per) + per) % per; chosen = [seq[i < L ? i : per - i]]; break; }
        case "random": chosen = [seq[Math.floor(Math.random() * L)]]; break;
        case "chord": chosen = notes; break;
        default: chosen = [seq[((k % L) + L) % L]];
      }
      for (const n of chosen) {
        const v = new Voice(this, n, this.arpVel, t);
        this.voices.push(v);
        v.release(t + gate);
      }
    }
  }
}
