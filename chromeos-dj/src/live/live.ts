import type { App } from "../app";
import { LiveClock } from "./clock";
import { DrumMachine } from "./drums";
import { PerfBus, PERF_PADS } from "./perf";
import { Sequencer, MidiClockOut, BASS_TRACK, emptyPattern, clonePattern, type Pattern } from "./sequencer";
import { KITS } from "./kits";

export type Bank = 0 | 1 | 2; // A batería · B FX de directo · C bajo 808

const MINOR = [0, 2, 3, 5, 7, 8, 10];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export interface KnobDef { label: string; def: number }
export const KNOBS: KnobDef[][] = [
  [{ label: "FILTRO MASTER", def: 0.5 }, { label: "ECHO SEND", def: 0 }, { label: "REVERB SEND", def: 0 }, { label: "VOL BATERÍA", def: 0.8 }, { label: "FILTRO BAT.", def: 0.5 }, { label: "DRIVE BAT.", def: 0 }],
  [{ label: "KICK DECAY", def: 0.6 }, { label: "KICK TUNE", def: 0.5 }, { label: "SNARE TONO", def: 0.5 }, { label: "HAT DECAY", def: 0.5 }, { label: "SWING", def: 0 }, { label: "KIT 808/909", def: 0 }],
  [{ label: "808 DECAY", def: 0.6 }, { label: "808 GLIDE", def: 0.25 }, { label: "FILTRO DECK IZQ", def: 0.5 }, { label: "FILTRO DECK DER", def: 0.5 }, { label: "NIVEL FX1", def: 0.6 }, { label: "NIVEL FX2", def: 0.6 }],
];

/** Mapeo por defecto del MPD218 (Program 1): pads 36..83 (bancos A/B/C), knobs por CC. */
export const DEFAULT_CC = [3, 9, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27];

interface MapStore { notes: Record<number, number>; ccs: Record<number, number> }
const MAP_KEY = "cdjpi-mpd218-map";
const PAT_KEY = "cdjpi-live-patterns";

export class LiveRig {
  readonly clock: LiveClock;
  readonly drums: DrumMachine;
  readonly perf: PerfBus;
  readonly seq: Sequencer;
  midiClock: MidiClockOut | null = null;
  bank: Bank = 0;
  knobVals: number[] = KNOBS.flat().map((k) => k.def);
  liveQuantize = false;
  erase = false;
  /** pads pulsados ahora (índice global 0..47) para la UI */
  held = new Set<number>();
  learn: { kind: "pad" | "knob"; idx: number } | null = null;
  map: MapStore;
  slots: (Pattern | null)[] = new Array(8).fill(null);
  slot = 0;
  private listeners: (() => void)[] = [];
  /** nota -> índice de pad global para soltar el bajo correcto */
  private bassHeld = -1;

  constructor(private app: App) {
    const eng = app.engine;
    this.clock = new LiveClock(app);
    this.drums = new DrumMachine(eng.ctx);
    this.drums.bus.connect(eng.masterSum);
    this.drums.cue.connect(eng.cueBus);
    this.perf = new PerfBus(app, this.clock);
    eng.setMasterInsert(this.perf.input, this.perf.output);
    this.seq = new Sequencer(this.clock, {
      drum: (tr, v, t) => this.drums.trigger(tr, v, t),
      bass: (note, v, t) => { if (note >= 0) this.drums.bassOn(this.bassHz(note), v, t); },
    }, () => eng.ctx.currentTime, () => app.outLatency);
    this.map = this.loadMap();
    this.loadPatterns();
    void this.drums.init().then(() => this.emit());
  }

  onChange(l: () => void): void { this.listeners.push(l); }
  emit(): void { for (const l of this.listeners) l(); this.app.emit(); }

  // ------------------------------------------------------------- mapeo
  private loadMap(): MapStore {
    try { const m = JSON.parse(localStorage.getItem(MAP_KEY) ?? ""); if (m?.notes && m?.ccs) return m; } catch { /* */ }
    const notes: Record<number, number> = {};
    for (let i = 0; i < 48; i++) notes[36 + i] = i;
    const ccs: Record<number, number> = {};
    DEFAULT_CC.forEach((cc, i) => { ccs[cc] = i; });
    return { notes, ccs };
  }

  private saveMap(): void { try { localStorage.setItem(MAP_KEY, JSON.stringify(this.map)); } catch { /* */ } }

  resetMap(): void { localStorage.removeItem(MAP_KEY); this.map = this.loadMap(); this.emit(); }

  startLearn(kind: "pad" | "knob", idx: number): void { this.learn = { kind, idx }; this.emit(); }

  // ------------------------------------------------------------- entrada MIDI del MPD218
  midiNote(note: number, vel: number): void {
    if (this.learn?.kind === "pad") {
      if (vel === 0) return;
      for (const k of Object.keys(this.map.notes)) if (this.map.notes[+k] === this.learn.idx) delete this.map.notes[+k];
      this.map.notes[note] = this.learn.idx;
      this.app.toast(`Pad ${this.padName(this.learn.idx)} ← nota ${note}`);
      this.learn = null; this.saveMap(); this.emit();
      return;
    }
    const g = this.map.notes[note];
    if (g === undefined) return;
    if (vel > 0) this.padDown(g, vel); else this.padUp(g);
  }

  midiCC(cc: number, value: number): void {
    if (this.learn?.kind === "knob") {
      for (const k of Object.keys(this.map.ccs)) if (this.map.ccs[+k] === this.learn.idx) delete this.map.ccs[+k];
      this.map.ccs[cc] = this.learn.idx;
      this.app.toast(`Knob ${KNOBS.flat()[this.learn.idx].label} ← CC ${cc}`);
      this.learn = null; this.saveMap(); this.emit();
      return;
    }
    const k = this.map.ccs[cc];
    if (k !== undefined) this.setKnob(k, value / 127);
  }

  /** Presión (aftertouch) sobre un pad del banco B: profundidad del efecto. */
  midiPressure(note: number, value: number): void {
    const g = this.map.notes[note];
    if (g === undefined || Math.floor(g / 16) !== 1) return;
    if (this.held.has(g)) this.perf.press(g - 16, Math.max(40, value));
  }

  padName(g: number): string { return `${"ABC"[Math.floor(g / 16)]}${(g % 16) + 1}`; }

  // ------------------------------------------------------------- pads
  padDown(g: number, vel: number): void {
    const bank = Math.floor(g / 16) as Bank;
    const i = g % 16;
    this.bank = bank;
    this.held.add(g);
    if (bank === 0) {
      if (this.erase) { this.seq.clear(i); this.app.toast(`Borrada pista ${this.drums.voiceName(i)}`); }
      else {
        const when = this.liveQuantize ? this.quantizedNow() : 0;
        this.drums.trigger(i, vel, when);
        if (this.seq.rec && this.seq.playing) this.seq.record(i, vel);
      }
    } else if (bank === 1) {
      this.perf.press(i, vel);
    } else {
      if (this.erase) { this.seq.clear(BASS_TRACK); }
      else {
        const when = this.liveQuantize ? this.quantizedNow() : 0;
        this.drums.bassOn(this.bassHz(i), vel, when);
        this.bassHeld = g;
        if (this.seq.rec && this.seq.playing) this.seq.record(BASS_TRACK, vel, i);
      }
    }
    this.emit();
  }

  padUp(g: number): void {
    this.held.delete(g);
    const bank = Math.floor(g / 16);
    if (bank === 1) this.perf.release(g % 16);
    else if (bank === 2 && this.bassHeld === g) { this.drums.bassOff(); this.bassHeld = -1; }
    this.emit();
  }

  private quantizedNow(): number {
    this.clock.update();
    const now = this.app.engine.ctx.currentTime;
    return this.clock.timeOf(Math.ceil(this.clock.stepAt(now) - 0.15));
  }

  // ------------------------------------------------------------- bajo en tonalidad
  /** Tonalidad de referencia (la del master, con key shift/pitch). Por defecto La menor. */
  refKey(): number {
    const ref = this.app.keyReference(null);
    const k = ref?.loaded ? ref.effKey() : -1;
    return k >= 0 ? k : 21;
  }

  bassSemis(i: number): { semis: number; rootPc: number } {
    const k = this.refKey();
    const minor = k >= 12;
    const pc = k % 12;
    const scale = minor ? MINOR : MAJOR;
    return { semis: scale[i % 7] + 12 * Math.floor(i / 7), rootPc: pc };
  }

  bassHz(i: number): number {
    const { semis, rootPc } = this.bassSemis(i);
    let root = 55 * Math.pow(2, (rootPc - 9) / 12); // misma clase de altura, octava de La1
    if (root < 41) root *= 2;
    return root * Math.pow(2, semis / 12);
  }

  bassLabel(i: number): string {
    const hz = this.bassHz(i);
    const midi = Math.round(69 + 12 * Math.log2(hz / 440));
    return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
  }

  padLabel(g: number): string {
    const bank = Math.floor(g / 16), i = g % 16;
    if (bank === 0) return this.drums.voiceName(i);
    if (bank === 1) return PERF_PADS[i].label;
    return this.bassLabel(i);
  }

  // ------------------------------------------------------------- knobs
  setKnob(k: number, v: number): void {
    this.knobVals[k] = v;
    const d = this.drums, p = this.perf, eng = this.app.engine;
    switch (k) {
      case 0: p.setMasterFilter(v); break;
      case 1: p.setEchoSend(v); break;
      case 2: p.setReverbSend(v); break;
      case 3: d.setVolume(v); break;
      case 4: d.setFilter(v); break;
      case 5: d.setDrive(v); break;
      case 6: d.params.kickDecay = v; break;
      case 7: d.params.kickTune = v; break;
      case 8: d.params.snareTone = v; break;
      case 9: d.params.hatDecay = v; break;
      case 10: this.seq.pat.swing = v * 0.6; break;
      case 11: { const kit = v < 0.5 ? 0 : 1; if (kit !== d.kitIdx) { d.kitIdx = kit; this.app.toast(`Kit: ${KITS[kit].name}`); } break; }
      case 12: d.params.bassDecay = v; break;
      case 13: d.params.bassGlide = v; break;
      case 14: eng.channels[this.app.side[0]].setFilter(v); break;
      case 15: eng.channels[this.app.side[1]].setFilter(v); break;
      case 16: eng.fx[0].setLevel(v); break;
      case 17: eng.fx[1].setLevel(v); break;
    }
    this.app.emit();
  }

  // ------------------------------------------------------------- patrones
  private loadPatterns(): void {
    try {
      const data = JSON.parse(localStorage.getItem(PAT_KEY) ?? "");
      if (Array.isArray(data?.slots)) this.slots = data.slots.map((p: Pattern | null) => (p ? { ...emptyPattern(), ...p } : null));
      if (data?.current) this.seq.pat = { ...emptyPattern(), ...data.current };
      this.slot = data?.slot ?? 0;
    } catch { /* primera vez */ }
  }

  savePatterns(): void {
    try { localStorage.setItem(PAT_KEY, JSON.stringify({ slots: this.slots, current: this.seq.pat, slot: this.slot })); } catch { /* */ }
  }

  /** Cambia de slot: guarda el actual y carga el elegido (vacío si no existe). */
  selectSlot(i: number): void {
    this.slots[this.slot] = clonePattern(this.seq.pat);
    this.slot = i;
    this.seq.pat = this.slots[i] ? clonePattern(this.slots[i]!) : emptyPattern();
    this.savePatterns();
    this.emit();
  }

  toggleStep(track: number, step: number, note = 0): void {
    const v = this.seq.pat.vel[track];
    if (v[step]) { v[step] = 0; if (track === BASS_TRACK) this.seq.pat.bass[step] = -1; }
    else { v[step] = 100; if (track === BASS_TRACK) this.seq.pat.bass[step] = note; }
    this.savePatterns();
    this.emit();
  }

  setLength(len: 16 | 32 | 64): void {
    const p = this.seq.pat;
    // al alargar, copia el compás existente para no empezar en vacío
    if (len > p.len) for (const row of p.vel) for (let s = p.len; s < len; s++) row[s] = row[s % p.len];
    if (len > p.len) for (let s = p.len; s < len; s++) p.bass[s] = p.bass[s % p.len];
    p.len = len;
    this.savePatterns();
    this.emit();
  }
}
