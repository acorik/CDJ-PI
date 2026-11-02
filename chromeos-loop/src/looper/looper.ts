import type { Transport } from "./transport";

export const NTRACKS = 8;

export type TrackState = "empty" | "armed" | "rec" | "play" | "dub" | "stopped" | "playArmed" | "stopArmed";

export interface TrackView {
  state: TrackState;
  len: number; // frames
  offset: number;
  recStart: number;
  recEnd: number;
  free: boolean;
  canUndo: boolean;
  canRedo: boolean;
  rev: boolean;
  vol: number;
  peaks: Float32Array | null;
}

export interface LooperOptions {
  /** compases del primer loop (0 = libre: se cierra al volver a pulsar) */
  loopBars(): number;
  afterRec(): "play" | "dub";
  countIn(): boolean;
  /** margen para pulsar un poco tarde y que cuente desde el compás que acaba de empezar */
  lateSec: number;
}

/** Controlador estilo loop station (RC-505): un botón por pista que hace REC → PLAY/DUB → … */
export class Looper {
  readonly tracks: TrackView[] = [];
  gridNow = 0;
  selected = 0;
  private listeners: (() => void)[] = [];
  private dumpWaiters = new Map<number, (d: any) => void>();
  private dumpSeq = 0;
  onStartTransport: ((countIn: boolean) => void) | null = null;

  constructor(readonly node: AudioWorkletNode, private tr: Transport, private ctx: AudioContext, private opt: LooperOptions) {
    for (let i = 0; i < NTRACKS; i++) {
      this.tracks.push({ state: "empty", len: 0, offset: 0, recStart: 0, recEnd: 0, free: false, canUndo: false, canRedo: false, rev: false, vol: 0.9, peaks: null });
    }
    node.port.onmessage = (e) => this.onMsg(e.data);
    tr.onChange(() => this.syncTransport());
    this.syncTransport();
  }

  onChange(l: () => void): void { this.listeners.push(l); }
  private emit(): void { for (const l of this.listeners) l(); }
  private post(m: Record<string, unknown>): void { this.node.port.postMessage(m); }

  syncTransport(): void {
    this.post({ t: "transport", t0: this.tr.t0Frame(), bar: this.tr.barFrames, running: this.tr.running, maxBars: 16 });
  }

  setComp(liveSec: number, micSec: number): void {
    this.post({ t: "comp", live: Math.round(liveSec * this.ctx.sampleRate), mic: Math.round(micSec * this.ctx.sampleRate) });
  }

  get hasContent(): boolean { return this.tracks.some((t) => t.state !== "empty"); }

  /** Compás cuantizado para empezar/terminar: el siguiente, o el actual si se pulsó justo después del "1". */
  private qBar(minBar = -Infinity): number {
    const now = this.ctx.currentTime;
    const b = this.tr.barAt(now);
    let fl = Math.floor(b);
    if ((b - fl) * this.tr.barSec > this.opt.lateSec) fl += 1;
    return Math.max(fl, minBar) * this.tr.barFrames;
  }

  private nowFrame(): number { return this.tr.gridFrame(this.ctx.currentTime); }

  /** Botón principal de la pista. */
  press(i: number): void {
    const t = this.tracks[i];
    this.selected = i;
    if (!this.tr.running) {
      if (t.state === "empty") {
        const ci = this.opt.countIn();
        this.onStartTransport?.(ci);
        this.startRec(i, 0);
      } else {
        this.onStartTransport?.(false);
        if (t.state === "stopped") this.post({ t: "play", tr: i, at: 0 });
      }
      this.emit();
      return;
    }
    switch (t.state) {
      case "empty": this.startRec(i, this.qBar()); break;
      case "armed": this.post({ t: "cancel", tr: i }); break;
      case "rec": {
        const startBar = Math.round(t.recStart / this.tr.barFrames);
        this.post({ t: "recEnd", tr: i, end: this.qBar(startBar + 1) });
        break;
      }
      case "play": case "stopArmed": this.post({ t: "dub", tr: i, start: this.nowFrame() }); break;
      case "dub": this.post({ t: "dubEnd", tr: i, end: this.nowFrame() }); break;
      case "stopped": this.post({ t: "play", tr: i, at: this.qBar() }); break;
      case "playArmed": this.post({ t: "stop", tr: i, at: this.nowFrame() }); break;
    }
    this.emit();
  }

  private startRec(i: number, start: number): void {
    const bars = this.opt.loopBars();
    const end = bars > 0 ? start + bars * this.tr.barFrames : -1;
    this.post({ t: "rec", tr: i, start, end, then: this.opt.afterRec() });
  }

  stop(i: number): void {
    const t = this.tracks[i];
    if (t.state === "rec" || t.state === "armed") { this.post({ t: "clear", tr: i }); return; }
    this.post({ t: "stop", tr: i, at: this.nowFrame() });
  }

  /** Para todas las pistas (inmediato) sin borrar nada. */
  stopAll(): void { for (let i = 0; i < NTRACKS; i++) if (this.tracks[i].state !== "empty") this.stop(i); }

  /** Arranca en el siguiente compás todas las pistas paradas. */
  playAll(): void {
    if (!this.tr.running) { this.onStartTransport?.(false); }
    const at = this.tr.running ? this.qBar() : 0;
    for (let i = 0; i < NTRACKS; i++) if (this.tracks[i].len) this.post({ t: "play", tr: i, at });
  }

  clear(i: number): void { this.post({ t: "clear", tr: i }); this.tracks[i].peaks = null; }
  clearAll(): void { for (let i = 0; i < NTRACKS; i++) this.clear(i); }
  undo(i: number): void { this.post({ t: "undo", tr: i }); }
  redo(i: number): void { this.post({ t: "redo", tr: i }); }

  setVol(i: number, v: number): void { this.tracks[i].vol = v; this.post({ t: "vol", tr: i, v }); this.emit(); }
  toggleRev(i: number): void { const t = this.tracks[i]; t.rev = !t.rev; this.post({ t: "rev", tr: i, on: t.rev }); this.emit(); }
  tapeStop(on: boolean): void { this.post({ t: "tape", on }); }

  /** Copia de todos los buffers (guardar sesión / exportar). */
  dump(): Promise<({ L: Float32Array; R: Float32Array; offset: number; vol: number; rev: boolean; playing: boolean } | null)[]> {
    const id = ++this.dumpSeq;
    return new Promise((res) => { this.dumpWaiters.set(id, (d) => res(d.tracks)); this.post({ t: "dump", id }); });
  }

  load(i: number, L: Float32Array, R: Float32Array, offset: number, play: boolean): void {
    this.node.port.postMessage({ t: "load", tr: i, L, R, offset, play }, [L.buffer, R.buffer]);
  }

  private onMsg(m: any): void {
    if (m.t === "s") {
      this.gridNow = m.frame - this.tr.t0Frame();
      let changed = false;
      for (let i = 0; i < NTRACKS; i++) {
        const t = this.tracks[i];
        const o = i * 5;
        const len = m.s[o], off = m.s[o + 1], f = m.s[o + 2];
        const rec = (f & 2) !== 0;
        let st: TrackState;
        if (rec) st = this.gridNow < m.s[o + 3] ? "armed" : "rec";
        else if (!len) st = "empty";
        else if (f & 4) st = "dub";
        else if (f & 64) st = "playArmed";
        else if (f & 128) st = "stopArmed";
        else st = f & 1 ? "play" : "stopped";
        if (st !== t.state || len !== t.len) changed = true;
        t.state = st; t.len = len; t.offset = off;
        t.recStart = m.s[o + 3]; t.recEnd = m.s[o + 4]; t.free = (f & 256) !== 0;
        t.canUndo = (f & 8) !== 0; t.canRedo = (f & 16) !== 0; t.rev = (f & 32) !== 0;
        if (st === "empty") t.peaks = null;
      }
      if (changed) this.emit();
    } else if (m.t === "peaks") {
      this.tracks[m.tr].peaks = m.peaks;
      this.emit();
    } else if (m.t === "dump") {
      this.dumpWaiters.get(m.id)?.(m);
      this.dumpWaiters.delete(m.id);
    }
  }

  /** Fase 0..1 de la pista (para el anillo de progreso). */
  phase(i: number, gridFrame = this.gridNow): number {
    const t = this.tracks[i];
    if (t.state === "rec") {
      if (t.recEnd > 0) return Math.max(0, Math.min(1, (gridFrame - t.recStart) / (t.recEnd - t.recStart)));
      return ((gridFrame - t.recStart) / this.tr.barFrames) % 1;
    }
    if (!t.len) return 0;
    const p = (((gridFrame - t.offset) % t.len) + t.len) % t.len / t.len;
    return t.rev ? 1 - p : p;
  }

  bars(i: number): number {
    const t = this.tracks[i];
    const len = t.state === "rec" && t.recEnd > 0 ? t.recEnd - t.recStart : t.len;
    return Math.round(len / this.tr.barFrames);
  }
}
