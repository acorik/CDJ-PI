import { AudioEngine, NDECK } from "./audio/engine";
import { AnalyzerClient, decodeForAnalysis } from "./audio/decode";
import { ANALYSIS_VERSION, type AnalysisResult } from "./analysis/analyze";
import { Deck } from "./deck";
import { Library } from "./library/library";
import { settings } from "./settings";
import type { Track } from "./types";
import { LiveRig } from "./live/live";

type Listener = () => void;

/** Lo que la UI expone a la controladora (navegador de la biblioteca). */
export interface UiHooks {
  loadSelected(deck: number): void;
  browse(delta: number, shift: boolean): void;
  browsePush(shift: boolean): void;
  dropOnDeck?(deck: number, e: DragEvent): void;
}

export interface MidiHooks {
  requirePickup(deck: number): void;
}

export interface Toast { text: string; kind: "info" | "error"; at: number }

export class App {
  engine!: AudioEngine;
  readonly decks: Deck[] = [];
  readonly library = new Library();
  readonly analyzer = new AnalyzerClient();
  master = -1;
  /** deck activo en cada lado (capa de la controladora): izq 0|2, der 1|3 */
  side: [number, number] = [0, 1];
  outLatency = 0;
  shift = false;
  ui: UiHooks | null = null;
  midi: MidiHooks | null = null;
  live!: LiveRig;
  toasts: Toast[] = [];
  batch: { queue: string[]; done: number; total: number; current: string } | null = null;
  private listeners: Listener[] = [];
  private emitQueued = false;
  private faderPrev = [0, 0, 0, 0];

  async init(): Promise<void> {
    for (let i = 0; i < NDECK; i++) this.decks.push(new Deck(i, this));
    const beatSource = (u: number) => () => {
      const d = this.decks[this.side[u]];
      if (!d.loaded || d.bpm <= 0) {
        // si el deck del lado no tiene grid, usa el master
        const m = this.decks[this.master];
        if (!m?.loaded || m.bpm <= 0) return null;
        return this.beatInfo(m);
      }
      return this.beatInfo(d);
    };
    this.engine = await AudioEngine.create([beatSource(0), beatSource(1)]);
    this.engine.onState = (m) => this.onEngine(m);
    for (let u = 0; u < 2; u++) {
      this.engine.attachFx(u, this.side[u]);
      this.engine.fx[u].onRoll = (on, beats) => {
        const d = this.decks[this.side[u]];
        if (on) d.rollDown(beats); else d.rollUp();
      };
    }
    for (const d of this.decks) this.engine.post({ t: "ramp", d: d.i, start: settings.startTime, brake: settings.brakeTime });
    this.live = new LiveRig(this);
    await this.library.init();
    this.library.onChange(() => this.emit());
    setInterval(() => this.tick(), 100);
  }

  beatInfo(d: Deck): { beatSec: number; nextBeat: number } {
    const beatSec = 60 / Math.max(1, d.effBpm);
    const p = d.now();
    const bl = d.beatLen;
    const next = d.firstBeat + Math.ceil((p - d.firstBeat) / bl) * bl;
    const speed = Math.max(0.05, Math.abs(d.speed) || d.effTempo);
    return { beatSec, nextBeat: this.engine.ctx.currentTime + (next - p) / speed + this.outLatency };
  }

  onChange(l: Listener): void { this.listeners.push(l); }

  /** Notifica a la UI (agrupado por frame). */
  emit(): void {
    if (this.emitQueued) return;
    this.emitQueued = true;
    requestAnimationFrame(() => { this.emitQueued = false; for (const l of this.listeners) l(); });
  }

  toast(text: string, kind: "info" | "error" = "info"): void {
    this.toasts.push({ text, kind, at: Date.now() });
    if (this.toasts.length > 4) this.toasts.shift();
    this.emit();
  }

  private onEngine(m: any): void {
    if (m.t === "s") {
      for (let i = 0; i < NDECK; i++) this.decks[i].applyState(m.s, i * 6, m.ct);
      const c = this.engine.ctx as any;
      this.outLatency = (c.outputLatency ?? 0) + (c.baseLatency ?? 0);
    } else if (m.t === "end") {
      this.onDeckStopped(this.decks[m.d]);
      this.emit();
    }
  }

  // ------------------------------------------------------------- capas
  setSide(side: 0 | 1, deck: number): void {
    if (this.side[side] === deck) return;
    this.side[side] = deck;
    this.engine.attachFx(side, deck);
    // al cambiar de capa, los controles físicos deben "recoger" el valor
    this.decks[deck].pitchPickup = true;
    this.midi?.requirePickup(deck);
    this.emit();
  }

  sideOf(deck: number): 0 | 1 { return (deck % 2) as 0 | 1; }

  // ------------------------------------------------------------- sync / master
  setMaster(d: Deck | null): void {
    const prev = this.master;
    if (d && d.sync && prev !== d.i) {
      // al pasar a master, conserva el tempo que llevaba sincronizado
      d.fader = Math.max(-1, Math.min(1, ((d.syncTempo - 1) * 100) / d.range));
      d.pitchPickup = true;
      this.engine.post({ t: "tempo", d: d.i, v: d.tempo });
    }
    this.master = d ? d.i : -1;
    this.engine.post({ t: "master", d: this.master });
    this.emit();
  }

  syncOn(d: Deck): void {
    d.sync = true;
    if (this.master < 0 || this.master === d.i || !this.decks[this.master].loaded) {
      const cands = this.decks.filter((x) => x !== d && x.loaded && x.bpm > 0)
        .sort((a, b) => Number(b.playing) - Number(a.playing));
      this.setMaster(cands[0] ?? d);
    }
    this.engine.post({ t: "sync", d: d.i, on: true });
    this.emit();
  }

  syncOff(d: Deck): void {
    if (!d.sync) return;
    const t = d.syncTempo;
    d.sync = false;
    this.engine.post({ t: "sync", d: d.i, on: false });
    if (this.master !== d.i) {
      d.fader = Math.max(-1, Math.min(1, ((t - 1) * 100) / d.range));
      d.pitchPickup = true;
      this.engine.post({ t: "tempo", d: d.i, v: d.tempo });
    }
    this.emit();
  }

  /** Deck de referencia para key sync / filtros de compatibilidad. */
  keyReference(d: Deck | null): Deck | null {
    const m = this.decks[this.master];
    if (m && m !== d && m.loaded) return m;
    const other = this.decks.find((x) => x !== d && x.loaded && x.playing) ?? this.decks.find((x) => x !== d && x.loaded);
    return other ?? null;
  }

  onDeckPlay(d: Deck): void {
    if (this.master < 0 && d.bpm > 0) this.setMaster(d);
  }

  private onDeckStopped(d: Deck): void {
    if (this.master === d.i) this.handoverMaster(d);
  }

  onDeckEjected(d: Deck): void {
    if (this.master === d.i) this.handoverMaster(d);
  }

  private handoverMaster(from: Deck): void {
    const next = this.decks.find((x) => x !== from && x.loaded && x.playing && x.bpm > 0);
    if (next) this.setMaster(next);
    else if (!from.loaded) this.setMaster(null);
  }

  // ------------------------------------------------------------- análisis
  applyAnalysis(t: Track, r: AnalysisResult): void {
    t.duration = r.duration;
    if (r.bpm > 0) {
      t.bpm = r.bpm;
      t.grid = { bpm: r.bpm, firstBeat: r.firstBeat, downbeat: r.downbeat };
    }
    t.key = r.key;
    t.loudness = r.loudness;
    t.firstSound = r.firstSound;
    t.analyzed = ANALYSIS_VERSION;
    this.library.saveTrack(t, true);
    this.library.putWave(t.id, r.wf).catch(() => {});
    this.library.emit();
  }

  async analyzeBatch(ids: string[]): Promise<void> {
    const todo = ids.filter((id) => {
      const t = this.library.tracks.get(id);
      return t && t.analyzed !== ANALYSIS_VERSION && this.library.isAvailable(t);
    });
    if (!todo.length) { this.toast("Nada que analizar"); return; }
    if (this.batch) { this.batch.queue.push(...todo); this.batch.total += todo.length; return; }
    this.batch = { queue: todo, done: 0, total: todo.length, current: "" };
    this.emit();
    while (this.batch.queue.length) {
      const id = this.batch.queue.shift()!;
      const t = this.library.tracks.get(id);
      if (!t) continue;
      this.batch.current = t.title;
      this.emit();
      try {
        // una pista cada vez: decodificar a 22 kHz mono -> ~30 MB pico por pista
        const file = await this.library.getFile(t);
        const { mono, sr } = await decodeForAnalysis(file);
        const r = await this.analyzer.analyze(mono, sr, settings.minBpm);
        this.applyAnalysis(t, r);
      } catch (e) {
        console.warn("análisis falló", t.name, e);
      }
      this.batch.done++;
      // respiro para la UI/audio en equipos lentos
      await new Promise((res) => setTimeout(res, 30));
    }
    this.batch = null;
    this.toast("Análisis terminado");
    this.emit();
  }

  // ------------------------------------------------------------- carga
  async loadTrack(deckIdx: number, t: Track): Promise<void> {
    try {
      await this.decks[deckIdx].load(t);
    } catch (e) {
      this.toast((e as Error).message, "error");
    }
  }

  /** Carga doble pulsación = instant doubles desde el deck del otro lado. */
  instantDouble(deckIdx: number): void {
    const d = this.decks[deckIdx];
    const other = this.decks[this.side[1 - this.sideOf(deckIdx)]];
    if (other.loaded) { d.cloneFrom(other); this.toast(`Instant double → deck ${deckIdx + 1}`); }
  }

  // ------------------------------------------------------------- tick 10 Hz
  private tick(): void {
    const chs = this.engine.channels;
    for (const d of this.decks) {
      const ch = chs[d.i];
      // fader start (CDJ + DJM)
      if (settings.faderStart && d.loaded) {
        const prev = this.faderPrev[d.i];
        const cur = ch.state.fader;
        if (prev <= 0.01 && cur > 0.01 && !d.playing) d.play();
        else if (prev > 0.01 && cur <= 0.01 && d.playing) { d.pause(0); d.seek(d.cue ?? 0); }
      }
      this.faderPrev[d.i] = ch.state.fader;
      // historial: cuenta como "pinchada" tras 30 s sonando con el fader arriba
      if (d.loaded && d.playing && ch.state.fader > 0.1 && !d.logged) {
        d.playedSec += 0.1;
        if (d.playedSec > 30) { d.logged = true; this.library.logPlay(d.track!, d.i); }
      }
    }
    // master parado y otro deck sincronizado sonando -> le pasa el master
    const m = this.decks[this.master];
    if (m && !m.playing && m.loaded) {
      const next = this.decks.find((x) => x !== m && x.playing && x.sync && x.bpm > 0);
      if (next) this.setMaster(next);
    }
  }
}
