import type { App } from "../app";
import type { LiveClock } from "./clock";
import { buildEffect, type Effect } from "../audio/fx";
import { SYNTHS } from "../audio/sampler";

export interface PerfPad { label: string; kind: string; arg?: number }

/** Banco B del MPD218: FX de directo sobre TODO el master (decks + batería). */
export const PERF_PADS: PerfPad[] = [
  // fila inferior (pads 1-4)
  { label: "ECHO ½", kind: "echo", arg: 0.5 },
  { label: "ECHO ¾", kind: "echo", arg: 0.75 },
  { label: "REVERB", kind: "reverb" },
  { label: "HPF ↑", kind: "hpf" },
  // pads 5-8
  { label: "REPEAT ¼", kind: "repeat", arg: 1 },
  { label: "REPEAT ⅛", kind: "repeat", arg: 0.5 },
  { label: "REPEAT 1/16", kind: "repeat", arg: 0.25 },
  { label: "LPF ↓", kind: "lpf" },
  // pads 9-12
  { label: "GATE ⅛", kind: "gate", arg: 0.5 },
  { label: "CRUSH", kind: "crush" },
  { label: "FLANGER", kind: "flanger" },
  { label: "TAPE STOP", kind: "tapestop" },
  // pads 13-16
  { label: "BASS KILL", kind: "basskill" },
  { label: "RISER", kind: "riser" },
  { label: "IMPACT", kind: "oneshot", arg: 4 },
  { label: "AIR HORN", kind: "oneshot", arg: 0 },
];

export class PerfBus {
  readonly input: GainNode;
  readonly output: GainNode;
  private dry: GainNode;
  private hpf: BiquadFilterNode;
  private hpf2: BiquadFilterNode;
  private lpf: BiquadFilterNode;
  private killA: BiquadFilterNode;
  private killB: BiquadFilterNode;
  private gate: GainNode;
  // echo throw
  private echoSend: GainNode;
  private echoDelay: DelayNode;
  private echoFb: GainNode;
  // reverb throw
  private revSend: GainNode;
  // beat repeat (congelación de delay)
  private repCapture: GainNode;
  private repDelay: DelayNode;
  private repFb: GainNode;
  private repOut: GainNode;
  // inserts (crush, flanger)
  private inserts = new Map<string, { fx: Effect; wet: GainNode }>();
  private oneshots: (AudioBuffer | null)[] = [];
  private riserNodes: { src: AudioBufferSourceNode; g: GainNode } | null = null;
  private gateTimer = 0;
  private tapeStopped: number[] = [];
  /** pads de banco B activos (para LEDs/UI) */
  active = new Set<number>();
  /** knob "macro": filtro del master (0..1, 0.5 = off) */
  masterFilter = 0.5;
  private lastFilterKnob = 0.5;

  constructor(private app: App, private clock: LiveClock) {
    const ctx = app.engine.ctx;
    const g = (v = 1) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const bq = (type: BiquadFilterType, f: number, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    this.input = g(); this.output = g(); this.dry = g();
    this.hpf = bq("highpass", 10, 0.9); this.hpf2 = bq("highpass", 10, 0.9);
    this.lpf = bq("lowpass", 22000, 0.9);
    this.killA = bq("highpass", 10); this.killB = bq("highpass", 10);
    this.gate = g();
    // cadena seca: in -> dry -> HPF -> LPF -> kill -> gate -> out
    this.input.connect(this.dry);
    this.dry.connect(this.hpf); this.hpf.connect(this.hpf2); this.hpf2.connect(this.lpf);
    this.lpf.connect(this.killA); this.killA.connect(this.killB); this.killB.connect(this.gate);
    this.gate.connect(this.output);
    // echo throw (las colas siguen al soltar)
    this.echoSend = g(0); this.echoDelay = ctx.createDelay(4); this.echoFb = g(0.55);
    const echoLp = bq("lowpass", 4500); const echoHp = bq("highpass", 250);
    this.input.connect(this.echoSend); this.echoSend.connect(this.echoDelay);
    this.echoDelay.connect(echoLp); echoLp.connect(echoHp); echoHp.connect(this.echoFb); this.echoFb.connect(this.echoDelay);
    echoHp.connect(this.output);
    // reverb throw
    this.revSend = g(0);
    const rev = buildEffect(ctx, "reverb");
    rev.setParam(0.75);
    this.input.connect(this.revSend); this.revSend.connect(rev.input);
    const revOut = g(0.8); rev.output.connect(revOut); revOut.connect(this.output);
    // beat repeat
    this.repCapture = g(0); this.repDelay = ctx.createDelay(2); this.repFb = g(0); this.repOut = g(0);
    this.input.connect(this.repCapture); this.repCapture.connect(this.repDelay);
    this.repDelay.connect(this.repFb); this.repFb.connect(this.repDelay);
    this.repDelay.connect(this.repOut); this.repOut.connect(this.hpf);
    void this.loadOneshots();
  }

  private async loadOneshots(): Promise<void> {
    const ctx = this.app.engine.ctx;
    for (const [, secs, fn] of SYNTHS) {
      const off = new OfflineAudioContext(1, Math.ceil(ctx.sampleRate * secs), ctx.sampleRate);
      fn(off);
      this.oneshots.push(await off.startRendering());
    }
  }

  private get t(): number { return this.app.engine.ctx.currentTime; }
  private beatSec(): number { this.clock.update(); return this.clock.ref.dur * 4; }

  /** Próximo instante que cae en una subdivisión `beats` del grid. */
  private nextGrid(beats: number): number {
    const now = this.t;
    const steps = beats * 4;
    const s = this.clock.stepAt(now);
    const target = Math.ceil(s / steps - 1e-6) * steps;
    const at = this.clock.timeOf(target);
    // si cae muy lejos (> media subdivisión), empieza ya: la respuesta importa más
    return at - now > this.clock.ref.dur * steps * 0.5 ? now : at;
  }

  press(i: number, velocity = 127): void {
    const p = PERF_PADS[i];
    if (!p) return;
    this.active.add(i);
    const now = this.t;
    const depth = 0.4 + 0.6 * (velocity / 127);
    switch (p.kind) {
      case "echo": {
        this.echoDelay.delayTime.setTargetAtTime(Math.min(3.9, this.beatSec() * (p.arg ?? 0.5)), now, 0.01);
        this.echoFb.gain.setTargetAtTime(0.6, now, 0.01);
        this.echoSend.gain.setTargetAtTime(depth, now, 0.005);
        break;
      }
      case "reverb": this.revSend.gain.setTargetAtTime(depth * 1.2, now, 0.01); break;
      case "hpf": {
        const bars = this.beatSec() * 4;
        for (const f of [this.hpf, this.hpf2]) {
          f.frequency.cancelScheduledValues(now); f.frequency.setValueAtTime(Math.max(20, f.frequency.value), now);
          f.frequency.exponentialRampToValueAtTime(5000, now + bars);
        }
        break;
      }
      case "lpf": {
        const bars = this.beatSec() * 4;
        this.lpf.frequency.cancelScheduledValues(now); this.lpf.frequency.setValueAtTime(this.lpf.frequency.value, now);
        this.lpf.frequency.exponentialRampToValueAtTime(180, now + bars);
        break;
      }
      case "repeat": {
        const slice = Math.min(1.9, this.beatSec() * (p.arg ?? 0.25));
        const t0 = this.nextGrid(p.arg ?? 0.25);
        this.repDelay.delayTime.setValueAtTime(slice, t0);
        // captura una "rebanada" y la congela realimentando el delay al 100 %
        this.repCapture.gain.cancelScheduledValues(now); this.repFb.gain.cancelScheduledValues(now);
        this.repOut.gain.cancelScheduledValues(now); this.dry.gain.cancelScheduledValues(now);
        this.repCapture.gain.setValueAtTime(1, t0);
        this.repCapture.gain.setValueAtTime(0, t0 + slice);
        this.repFb.gain.setValueAtTime(0, t0);
        this.repFb.gain.setValueAtTime(1, t0 + slice);
        this.dry.gain.setValueAtTime(1, t0 + slice - 0.003);
        this.dry.gain.linearRampToValueAtTime(0, t0 + slice);
        this.repOut.gain.setValueAtTime(0, t0 + slice - 0.003);
        this.repOut.gain.linearRampToValueAtTime(1, t0 + slice);
        break;
      }
      case "gate": this.startGate(p.arg ?? 0.5); break;
      case "crush": case "flanger": this.insertOn(p.kind, depth); break;
      case "tapestop": {
        this.tapeStopped = this.app.decks.filter((d) => d.playing).map((d) => d.i);
        for (const i2 of this.tapeStopped) this.app.decks[i2].brake(this.beatSec() * 2);
        break;
      }
      case "basskill":
        for (const f of [this.killA, this.killB]) f.frequency.setTargetAtTime(220, now, 0.005);
        break;
      case "riser": this.startRiser(); break;
      case "oneshot": {
        const buf = this.oneshots[p.arg ?? 0];
        if (!buf) break;
        const src = this.app.engine.ctx.createBufferSource();
        src.buffer = buf;
        const gg = this.app.engine.ctx.createGain(); gg.gain.value = depth;
        src.connect(gg); gg.connect(this.output); src.start();
        setTimeout(() => this.active.delete(i), 300);
        break;
      }
    }
  }

  release(i: number): void {
    const p = PERF_PADS[i];
    if (!p) return;
    this.active.delete(i);
    const now = this.t;
    switch (p.kind) {
      case "echo": this.echoSend.gain.setTargetAtTime(0, now, 0.01); break; // las colas siguen
      case "reverb": this.revSend.gain.setTargetAtTime(0, now, 0.02); break;
      case "hpf":
        for (const f of [this.hpf, this.hpf2]) { f.frequency.cancelScheduledValues(now); f.frequency.setTargetAtTime(10, now, 0.04); }
        this.applyMasterFilter();
        break;
      case "lpf":
        this.lpf.frequency.cancelScheduledValues(now); this.lpf.frequency.setTargetAtTime(22000, now, 0.04);
        this.applyMasterFilter();
        break;
      case "repeat":
        for (const n of [this.repCapture, this.repFb, this.repOut, this.dry]) n.gain.cancelScheduledValues(now);
        this.repCapture.gain.setValueAtTime(0, now);
        this.repFb.gain.setValueAtTime(0, now);
        this.repOut.gain.setTargetAtTime(0, now, 0.003);
        this.dry.gain.setTargetAtTime(1, now, 0.003);
        break;
      case "gate":
        clearInterval(this.gateTimer);
        this.gate.gain.cancelScheduledValues(now); this.gate.gain.setTargetAtTime(1, now, 0.003);
        break;
      case "crush": case "flanger": this.insertOff(p.kind); break;
      case "tapestop":
        for (const i2 of this.tapeStopped) this.app.decks[i2].play();
        this.tapeStopped = [];
        break;
      case "basskill": for (const f of [this.killA, this.killB]) f.frequency.setTargetAtTime(10, now, 0.005); break;
      case "riser": this.stopRiser(); break;
    }
  }

  private startGate(beats: number): void {
    clearInterval(this.gateTimer);
    let last = -Infinity;
    const steps = beats * 4;
    const sched = () => {
      this.clock.update();
      const now = this.t;
      let k = Math.max(last + 1, Math.ceil(this.clock.stepAt(now) / steps * 2));
      for (; ; k++) {
        const at = this.clock.timeOf((k * steps) / 2);
        if (at > now + 0.12) break;
        last = k;
        this.gate.gain.setTargetAtTime(k % 2 === 0 ? 1 : 0, Math.max(now, at), 0.002);
      }
    };
    sched();
    this.gateTimer = window.setInterval(sched, 25);
  }

  private insertOn(id: string, depth: number): void {
    const ctx = this.app.engine.ctx;
    let ins = this.inserts.get(id);
    if (!ins) {
      const fx = buildEffect(ctx, id);
      const wet = ctx.createGain(); wet.gain.value = 0;
      this.input.connect(fx.input); fx.output.connect(wet); wet.connect(this.hpf);
      fx.setParam(id === "crush" ? 0.75 : 0.7);
      fx.setTime(this.beatSec() * 4);
      ins = { fx, wet };
      this.inserts.set(id, ins);
    }
    const now = this.t;
    ins.fx.align?.(this.nextGrid(1), this.beatSec() * 4);
    ins.wet.gain.setTargetAtTime(depth, now, 0.01);
    this.dry.gain.setTargetAtTime(1 - depth * 0.9, now, 0.01);
  }

  private insertOff(id: string): void {
    const ins = this.inserts.get(id);
    if (!ins) return;
    const now = this.t;
    ins.wet.gain.setTargetAtTime(0, now, 0.01);
    if (![...this.inserts.keys()].some((k) => k !== id && this.active.has(PERF_PADS.findIndex((p) => p.kind === k))))
      this.dry.gain.setTargetAtTime(1, now, 0.01);
  }

  private startRiser(): void {
    const ctx = this.app.engine.ctx;
    this.stopRiser();
    const len = this.beatSec() * 8; // 2 compases
    const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 2), ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = b; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 2.5;
    const g = ctx.createGain();
    const now = this.t;
    f.frequency.setValueAtTime(300, now); f.frequency.exponentialRampToValueAtTime(9000, now + len);
    g.gain.setValueAtTime(0.001, now); g.gain.exponentialRampToValueAtTime(0.35, now + len);
    src.connect(f); f.connect(g); g.connect(this.output); src.start();
    this.riserNodes = { src, g };
  }

  private stopRiser(): void {
    const r = this.riserNodes;
    if (!r) return;
    const now = this.t;
    r.g.gain.cancelScheduledValues(now);
    r.g.gain.setTargetAtTime(0, now, 0.05);
    setTimeout(() => { try { r.src.stop(); } catch { /* */ } r.src.disconnect(); }, 400);
    this.riserNodes = null;
  }

  /** Knob: filtro del master (izq. LPF, der. HPF), como el Color FX de un DJM. */
  setMasterFilter(v: number): void {
    this.masterFilter = v;
    this.lastFilterKnob = v;
    this.applyMasterFilter();
  }

  private applyMasterFilter(): void {
    const v = this.lastFilterKnob;
    const now = this.t;
    if (this.active.has(3) || this.active.has(7)) return; // un sweep manda
    if (v < 0.47) {
      const x = (0.47 - v) / 0.47;
      this.lpf.frequency.setTargetAtTime(20000 * Math.pow(120 / 20000, x), now, 0.02);
      for (const f of [this.hpf, this.hpf2]) f.frequency.setTargetAtTime(10, now, 0.02);
    } else if (v > 0.53) {
      const x = (v - 0.53) / 0.47;
      for (const f of [this.hpf, this.hpf2]) f.frequency.setTargetAtTime(20 * Math.pow(6000 / 20, x), now, 0.02);
      this.lpf.frequency.setTargetAtTime(22000, now, 0.02);
    } else {
      this.lpf.frequency.setTargetAtTime(22000, now, 0.02);
      for (const f of [this.hpf, this.hpf2]) f.frequency.setTargetAtTime(10, now, 0.02);
    }
  }

  /** Knobs de envío continuo (echo / reverb) además de los pads. */
  setEchoSend(v: number): void { if (!this.active.has(0) && !this.active.has(1)) { this.echoDelay.delayTime.setTargetAtTime(this.beatSec() * 0.75, this.t, 0.05); this.echoSend.gain.setTargetAtTime(v * 0.8, this.t, 0.02); } }
  setReverbSend(v: number): void { if (!this.active.has(2)) this.revSend.gain.setTargetAtTime(v, this.t, 0.02); }
}
