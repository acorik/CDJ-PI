// Beat FX con nodos nativos de Web Audio (se procesan en el hilo de audio
// de Chrome, en C++: coste de CPU mínimo en un Chromebook).

export const BEATS = [0.125, 0.25, 0.5, 0.75, 1, 2, 4, 8, 16];
export const BEAT_LABELS = ["1/8", "1/4", "1/2", "3/4", "1", "2", "4", "8", "16"];

export interface FxDef {
  id: string;
  name: string;
  /** send: los "tails" siguen sonando al apagar (eco, reverb). insert: sustituye la señal. */
  mode: "send" | "insert";
  beatsIdx: number | null;
  paramName: string;
  param: number;
}

export const FX_LIST: FxDef[] = [
  { id: "echo", name: "Echo", mode: "send", beatsIdx: 3, paramName: "Feedback", param: 0.5 },
  { id: "pingpong", name: "Ping Pong", mode: "send", beatsIdx: 2, paramName: "Feedback", param: 0.45 },
  { id: "reverb", name: "Reverb", mode: "send", beatsIdx: null, paramName: "Tamaño", param: 0.5 },
  { id: "flanger", name: "Flanger", mode: "insert", beatsIdx: 6, paramName: "Feedback", param: 0.6 },
  { id: "phaser", name: "Phaser", mode: "insert", beatsIdx: 6, paramName: "Profundidad", param: 0.7 },
  { id: "filter", name: "Filter LFO", mode: "insert", beatsIdx: 6, paramName: "Resonancia", param: 0.5 },
  { id: "trans", name: "Trans", mode: "insert", beatsIdx: 1, paramName: "Profundidad", param: 1 },
  { id: "crush", name: "Crush", mode: "insert", beatsIdx: null, paramName: "Bits", param: 0.4 },
  { id: "noise", name: "Noise", mode: "send", beatsIdx: null, paramName: "Color", param: 0.5 },
  { id: "roll", name: "Roll", mode: "insert", beatsIdx: 1, paramName: "—", param: 0 },
];

export interface Effect {
  input: AudioNode;
  output: AudioNode;
  setTime(sec: number): void;
  setParam(x: number): void;
  setOn?(on: boolean): void;
  align?(t0: number, sec: number): void;
  dispose(): void;
}

function makeImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  return b;
}

class LFO {
  osc: OscillatorNode | null = null;
  readonly out: GainNode;
  constructor(private ctx: AudioContext, private type: OscillatorType, depth: number) {
    this.out = ctx.createGain();
    this.out.gain.value = depth;
    this.restart(ctx.currentTime, 2);
  }
  restart(t0: number, period: number) {
    const old = this.osc;
    const o = this.ctx.createOscillator();
    o.type = this.type;
    o.frequency.value = 1 / Math.max(0.02, period);
    o.connect(this.out);
    const start = Math.max(this.ctx.currentTime, t0);
    o.start(start);
    if (old) { try { old.stop(start); } catch { /* */ } }
    this.osc = o;
  }
  setPeriod(p: number) { this.osc?.frequency.setTargetAtTime(1 / Math.max(0.02, p), this.ctx.currentTime, 0.05); }
  dispose() { try { this.osc?.stop(); } catch { /* */ } this.out.disconnect(); }
}

export function buildEffect(ctx: AudioContext, id: string): Effect {
  const now = () => ctx.currentTime;
  switch (id) {
    case "echo": {
      const inp = ctx.createGain(), out = ctx.createGain();
      const dl = ctx.createDelay(8), fb = ctx.createGain(), lp = ctx.createBiquadFilter();
      lp.frequency.value = 5000;
      inp.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); dl.connect(out);
      return {
        input: inp, output: out,
        setTime: (s) => dl.delayTime.setTargetAtTime(Math.min(7.9, s), now(), 0.03),
        setParam: (x) => fb.gain.setTargetAtTime(0.2 + x * 0.68, now(), 0.03),
        dispose: () => { inp.disconnect(); dl.disconnect(); lp.disconnect(); fb.disconnect(); },
      };
    }
    case "pingpong": {
      const inp = ctx.createGain();
      inp.channelCount = 1; inp.channelCountMode = "explicit";
      const dL = ctx.createDelay(8), dR = ctx.createDelay(8), fb = ctx.createGain();
      const merger = ctx.createChannelMerger(2);
      inp.connect(dL); dL.connect(dR); dR.connect(fb); fb.connect(dL);
      dL.connect(merger, 0, 0); dR.connect(merger, 0, 1);
      return {
        input: inp, output: merger,
        setTime: (s) => { const t = Math.min(7.9, s); dL.delayTime.setTargetAtTime(t, now(), 0.03); dR.delayTime.setTargetAtTime(t, now(), 0.03); },
        setParam: (x) => fb.gain.setTargetAtTime(0.2 + x * 0.65, now(), 0.03),
        dispose: () => { inp.disconnect(); dL.disconnect(); dR.disconnect(); fb.disconnect(); merger.disconnect(); },
      };
    }
    case "reverb": {
      const inp = ctx.createGain(), conv = ctx.createConvolver(), hp = ctx.createBiquadFilter();
      hp.type = "highpass"; hp.frequency.value = 200;
      inp.connect(hp); hp.connect(conv);
      let timer = 0, last = -1;
      const setParam = (x: number) => {
        const secs = 1 + x * 4;
        if (Math.abs(secs - last) < 0.2) return;
        last = secs;
        clearTimeout(timer);
        timer = window.setTimeout(() => { conv.buffer = makeImpulse(ctx, secs); }, last < 0 ? 0 : 150);
      };
      conv.buffer = makeImpulse(ctx, 3);
      return { input: inp, output: conv, setTime: () => {}, setParam, dispose: () => { inp.disconnect(); hp.disconnect(); conv.disconnect(); } };
    }
    case "flanger": {
      const inp = ctx.createGain(), out = ctx.createGain(), dl = ctx.createDelay(0.05), fb = ctx.createGain();
      dl.delayTime.value = 0.004;
      const lfo = new LFO(ctx, "triangle", 0.0035);
      lfo.out.connect(dl.delayTime);
      inp.connect(out); inp.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(out);
      out.gain.value = 0.7;
      return {
        input: inp, output: out,
        setTime: (s) => lfo.setPeriod(s), setParam: (x) => fb.gain.setTargetAtTime(x * 0.85, now(), 0.03),
        align: (t0, s) => lfo.restart(t0, s),
        dispose: () => { lfo.dispose(); inp.disconnect(); dl.disconnect(); fb.disconnect(); },
      };
    }
    case "phaser": {
      const inp = ctx.createGain(), out = ctx.createGain();
      const lfo = new LFO(ctx, "sine", 600);
      let prev: AudioNode = inp;
      const aps: BiquadFilterNode[] = [];
      for (let i = 0; i < 4; i++) {
        const ap = ctx.createBiquadFilter();
        ap.type = "allpass"; ap.frequency.value = 900; ap.Q.value = 0.6;
        lfo.out.connect(ap.frequency);
        prev.connect(ap); prev = ap; aps.push(ap);
      }
      inp.connect(out); prev.connect(out);
      out.gain.value = 0.6;
      return {
        input: inp, output: out,
        setTime: (s) => lfo.setPeriod(s), setParam: (x) => lfo.out.gain.setTargetAtTime(150 + x * 750, now(), 0.05),
        align: (t0, s) => lfo.restart(t0, s),
        dispose: () => { lfo.dispose(); inp.disconnect(); aps.forEach((a) => a.disconnect()); },
      };
    }
    case "filter": {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass"; f.frequency.value = 1600;
      const lfo = new LFO(ctx, "sine", 1400);
      lfo.out.connect(f.frequency);
      return {
        input: f, output: f,
        setTime: (s) => lfo.setPeriod(s), setParam: (x) => f.Q.setTargetAtTime(0.7 + x * 14, now(), 0.05),
        align: (t0, s) => lfo.restart(t0, s),
        dispose: () => { lfo.dispose(); f.disconnect(); },
      };
    }
    case "trans": {
      const g = ctx.createGain();
      g.gain.value = 0.5;
      const lfo = new LFO(ctx, "square", 0.5);
      lfo.out.connect(g.gain);
      return {
        input: g, output: g,
        setTime: (s) => lfo.setPeriod(s), setParam: (x) => lfo.out.gain.setTargetAtTime(0.5 * x, now(), 0.02),
        align: (t0, s) => lfo.restart(t0, s),
        dispose: () => { lfo.dispose(); g.disconnect(); },
      };
    }
    case "crush": {
      const ws = ctx.createWaveShaper(), lp = ctx.createBiquadFilter();
      lp.frequency.value = 9000;
      const setParam = (x: number) => {
        const steps = Math.pow(2, Math.round(2 + (1 - x) * 6));
        const n = 4096, c = new Float32Array(n);
        for (let i = 0; i < n; i++) { const v = (i / (n - 1)) * 2 - 1; c[i] = Math.round(v * steps) / steps; }
        ws.curve = c;
      };
      ws.connect(lp);
      return { input: ws, output: lp, setTime: () => {}, setParam, dispose: () => { ws.disconnect(); lp.disconnect(); } };
    }
    case "noise": {
      const inp = ctx.createGain(); // la entrada no se usa: el ruido se añade encima
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; }
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const hp = ctx.createBiquadFilter(); hp.type = "bandpass"; hp.Q.value = 0.8;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(hp); hp.connect(g); src.start();
      return {
        input: inp, output: g,
        setTime: () => {}, setParam: (x) => hp.frequency.setTargetAtTime(200 * Math.pow(40, x), now(), 0.05),
        setOn: (on) => g.gain.setTargetAtTime(on ? 0.25 : 0, now(), on ? 0.05 : 0.3),
        dispose: () => { try { src.stop(); } catch { /* */ } src.disconnect(); hp.disconnect(); g.disconnect(); },
      };
    }
    default: {
      // "roll" y desconocidos: sin audio propio (el roll lo hace el motor de decks)
      const g = ctx.createGain();
      return { input: g, output: g, setTime: () => {}, setParam: () => {}, dispose: () => g.disconnect() };
    }
  }
}

export interface BeatSource {
  /** duración de 1 beat en segundos de reloj (tempo efectivo) y próximo beat en tiempo de AudioContext */
  (): { beatSec: number; nextBeat: number } | null;
}

export class FxUnit {
  readonly input: GainNode;
  readonly output: GainNode;
  private dry: GainNode;
  private send: GainNode;
  private wet: GainNode;
  private effect: Effect | null = null;
  def: FxDef = FX_LIST[0];
  on = false;
  level = 0.6;
  beatsIdx = 3;
  param = 0.5;
  tapBpm = 0;
  /** callback para el roll (lo implementa el deck destino) */
  onRoll: ((on: boolean, beats: number) => void) | null = null;
  private timer: number;

  constructor(private ctx: AudioContext, public beatSource: BeatSource) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dry = ctx.createGain();
    this.send = ctx.createGain();
    this.wet = ctx.createGain();
    this.input.connect(this.dry); this.dry.connect(this.output);
    this.input.connect(this.send);
    this.wet.connect(this.output);
    this.send.gain.value = 0;
    this.wet.gain.value = 0;
    this.select("echo");
    // sigue al tempo del deck (sync/pitch) cada 250 ms
    this.timer = window.setInterval(() => this.updateTime(false), 250);
  }

  select(id: string): void {
    const def = FX_LIST.find((f) => f.id === id) ?? FX_LIST[0];
    const wasOn = this.on;
    if (wasOn) this.setOn(false);
    if (this.effect) {
      const old = this.effect;
      // deja sonar las colas un momento antes de destruir
      setTimeout(() => old.dispose(), def.mode === "send" ? 50 : 0);
      try { this.send.disconnect(); } catch { /* */ }
      try { old.output.disconnect(this.wet); } catch { /* */ }
    }
    this.def = def;
    this.effect = buildEffect(this.ctx, def.id);
    this.send.connect(this.effect.input);
    this.effect.output.connect(this.wet);
    if (def.beatsIdx !== null) this.beatsIdx = def.beatsIdx;
    this.param = def.param;
    this.effect.setParam(this.param);
    this.updateTime(true);
    if (wasOn) this.setOn(true);
  }

  private beatSec(): { beatSec: number; nextBeat: number } {
    if (this.tapBpm > 0) return { beatSec: 60 / this.tapBpm, nextBeat: this.ctx.currentTime };
    return this.beatSource() ?? { beatSec: 0.5, nextBeat: this.ctx.currentTime };
  }

  private updateTime(align: boolean): void {
    if (!this.effect) return;
    const { beatSec, nextBeat } = this.beatSec();
    const sec = beatSec * BEATS[this.beatsIdx];
    this.effect.setTime(sec);
    if (align && this.effect.align) this.effect.align(nextBeat, sec);
  }

  setOn(on: boolean): void {
    if (this.on === on) return;
    this.on = on;
    const t = this.ctx.currentTime;
    if (this.def.id === "roll") { this.onRoll?.(on, BEATS[this.beatsIdx]); return; }
    if (on) this.updateTime(true);
    this.effect?.setOn?.(on);
    this.applyMix(t);
  }

  setLevel(v: number): void {
    this.level = Math.max(0, Math.min(1, v));
    this.applyMix(this.ctx.currentTime);
  }

  private applyMix(t: number): void {
    const tc = 0.012;
    if (this.def.mode === "send") {
      this.dry.gain.setTargetAtTime(1, t, tc);
      this.send.gain.setTargetAtTime(this.on ? 1 : 0, t, tc);
      this.wet.gain.setTargetAtTime(this.level, t, tc); // colas siguen al apagar
    } else {
      this.send.gain.setTargetAtTime(this.on ? 1 : 0, t, tc);
      this.wet.gain.setTargetAtTime(this.on ? this.level : 0, t, tc);
      this.dry.gain.setTargetAtTime(this.on ? 1 - this.level : 1, t, tc);
    }
  }

  stepBeats(dir: number): void {
    if (this.def.beatsIdx === null) { this.setParam(this.param + dir * 0.05); return; }
    this.beatsIdx = Math.max(0, Math.min(BEATS.length - 1, this.beatsIdx + dir));
    this.updateTime(false);
  }

  setParam(x: number): void {
    this.param = Math.max(0, Math.min(1, x));
    this.effect?.setParam(this.param);
  }

  get beatsLabel(): string {
    return this.def.beatsIdx === null ? `${Math.round(this.param * 100)}%` : BEAT_LABELS[this.beatsIdx];
  }

  dispose(): void {
    clearInterval(this.timer);
    this.effect?.dispose();
  }
}
