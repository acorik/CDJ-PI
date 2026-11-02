import type { App } from "./app";
import type { Track } from "./types";
import { HOTCUE_COLORS, emptyCues } from "./types";
import { decodeForPlayback } from "./audio/decode";
import { ANALYSIS_VERSION } from "./analysis/analyze";
import { settings } from "./settings";
import { shiftKey, keySyncShift } from "./util/key";

export const TEMPO_RANGES = [6, 8, 10, 16, 100];
/** segundos de audio por "tick" del jog (1024 ticks/vuelta a 33⅓ rpm, como el plato real) */
const SEC_PER_TICK = 1.8 / 1024;

export class Deck {
  track: Track | null = null;
  wave: Uint8Array | null = null;
  wfRate = 150;
  duration = 0;
  loading = false;
  analyzing = false;
  error = "";
  private loadToken = 0;

  // estado que reporta el motor
  pos = 0;
  speed = 0;
  playing = false;
  loopOn = false;
  slipping = false;
  scratching = false;
  keylockActive = false;
  reversed = false;
  slipPos = 0;
  syncTempo = 1;
  stateTime = 0;

  // controles
  fader = 0; // -1..1 (posición del pitch fader)
  range = settings.tempoRange;
  keylock = settings.keylockDefault;
  keySemis = 0;
  sync = false;
  vinyl = settings.vinylDefault;
  slip = false;
  reverse = false;
  pitchPickup = false;
  loop: { start: number; end: number } | null = null;
  loopIn: number | null = null;
  cuePreview = false;
  hotPreview = -1;
  playDuringPreview = false;
  touched = false;
  private censoring = false;
  private rolling = false;
  playedSec = 0;
  logged = false;

  constructor(readonly i: number, private app: App) {}

  private post(m: Record<string, unknown>, transfer?: Transferable[]) {
    this.app.engine.post({ ...m, d: this.i }, transfer);
  }

  get loaded(): boolean { return !!this.track && !this.loading; }
  get bpm(): number { return this.track?.grid?.bpm || 0; }
  get beatLen(): number { return this.bpm > 0 ? 60 / this.bpm : 0.5; }
  get firstBeat(): number { return this.track?.grid?.firstBeat ?? 0; }
  get tempo(): number { return Math.max(0, 1 + (this.fader * this.range) / 100); }
  get isMaster(): boolean { return this.app.master === this.i; }
  /** tempo efectivo (incluye sync) */
  get effTempo(): number { return this.sync && !this.isMaster ? this.syncTempo : this.tempo; }
  get effBpm(): number { return this.bpm * this.effTempo; }
  get pitchPct(): number { return (this.effTempo - 1) * 100; }
  get cue(): number | null { return this.track?.cues.main ?? null; }

  /** Posición actual extrapolada (segundos de pista). `visual` resta la latencia de salida. */
  now(visual = false): number {
    const ctx = this.app.engine.ctx;
    let dt = ctx.currentTime - this.stateTime;
    if (visual) dt -= this.app.outLatency;
    const p = this.pos + this.speed * Math.max(-0.2, Math.min(0.1, dt));
    return Math.max(0, Math.min(this.duration, p));
  }

  nearestBeat(t: number): number {
    if (this.bpm <= 0) return t;
    const bl = this.beatLen;
    return this.firstBeat + Math.round((t - this.firstBeat) / bl) * bl;
  }

  private q(t: number): number {
    return settings.quantize && this.bpm > 0 ? Math.max(0, this.nearestBeat(t)) : t;
  }

  /** Índice de beat dentro del compás (1..4) y compases hasta el próximo cue de memoria/fin. */
  beatInBar(t = this.now(true)): number {
    if (this.bpm <= 0) return 0;
    const bi = Math.floor((t - this.firstBeat) / this.beatLen + 1e-6) - (this.track?.grid?.downbeat ?? 0);
    return ((bi % 4) + 4) % 4 + 1;
  }

  // ------------------------------------------------------------- carga
  async load(t: Track): Promise<void> {
    if (settings.loadLock && this.playing && this.app.engine.channels[this.i].state.fader > 0.05) {
      throw new Error(`Deck ${this.i + 1} está sonando: load lock activo (baja el fader o para el deck)`);
    }
    const token = ++this.loadToken;
    this.loading = true;
    this.error = "";
    this.app.emit();
    try {
      const file = await this.app.library.getFile(t);
      const data = await decodeForPlayback(this.app.engine.ctx, file);
      if (token !== this.loadToken) return;
      if (this.playing) this.post({ t: "play", on: false });
      this.track = t;
      if (!t.cues) t.cues = emptyCues();
      this.duration = data.duration;
      this.loop = null; this.loopIn = null; this.keySemis = 0; this.reverse = false;
      this.cuePreview = false; this.hotPreview = -1; this.playedSec = 0; this.logged = false;
      this.wave = null;
      const needAnalysis = t.analyzed !== ANALYSIS_VERSION || !t.grid;
      if (!needAnalysis) this.wave = (await this.app.library.getWave(t.id)) ?? null;
      const start = t.cues.main ?? (settings.autoCue ? t.firstSound : 0);
      this.post({ t: "load", L: data.L, R: data.R, bpm: t.grid?.bpm ?? 0, firstBeat: t.grid?.firstBeat ?? 0, pos: start }, [data.L.buffer, data.R.buffer]);
      this.post({ t: "key", v: 0 });
      this.post({ t: "reverse", on: false });
      this.post({ t: "keylock", on: this.keylock });
      this.post({ t: "tempo", v: this.tempo });
      this.pos = start;
      this.applyAutoGain();
      this.loading = false;
      this.app.emit();
      if (needAnalysis || !this.wave) {
        this.analyzing = true;
        this.app.emit();
        const r = await this.app.analyzer.analyze(data.mono, data.monoSr, settings.minBpm);
        if (token !== this.loadToken) return;
        this.app.applyAnalysis(t, r);
        this.wave = r.wf;
        this.wfRate = r.wfRate;
        this.post({ t: "grid", bpm: t.grid?.bpm ?? 0, firstBeat: t.grid?.firstBeat ?? 0 });
        if (t.cues.main === null && settings.autoCue && !this.playing) this.seek(t.firstSound);
        this.applyAutoGain();
        this.analyzing = false;
      } else {
        // asegura que la duración guardada es la real
        if (Math.abs(t.duration - data.duration) > 0.5) { t.duration = data.duration; this.app.library.saveTrack(t); }
      }
      if (this.sync) this.app.syncOn(this);
    } catch (e) {
      if (token === this.loadToken) { this.error = (e as Error).message; this.loading = false; this.analyzing = false; }
      throw e;
    } finally {
      this.app.emit();
    }
  }

  applyAutoGain(): void {
    const t = this.track;
    const db = settings.autoGain && t?.loudness != null ? Math.max(-12, Math.min(12, settings.gainTarget - t.loudness)) : 0;
    this.app.engine.channels[this.i].setAutoGainDb(db);
  }

  /** Instant doubles: copia pista, posición, loop y estado del otro deck. */
  cloneFrom(o: Deck): void {
    if (!o.track || o.loading) return;
    this.loadToken++; // cancela una carga en curso (la 1ª pulsación del doble LOAD)
    this.loading = false;
    this.analyzing = false;
    this.track = o.track; this.wave = o.wave; this.wfRate = o.wfRate; this.duration = o.duration;
    this.loop = o.loop ? { ...o.loop } : null;
    this.fader = o.fader; this.range = o.range; this.keylock = o.keylock; this.keySemis = o.keySemis;
    this.post({ t: "clone", from: o.i });
    this.post({ t: "tempo", v: this.tempo });
    this.post({ t: "keylock", on: this.keylock });
    this.post({ t: "key", v: this.keySemis });
    this.pitchPickup = true;
    this.applyAutoGain();
    this.app.emit();
  }

  eject(): void {
    if (this.playing) return;
    this.loadToken++;
    this.post({ t: "unload" });
    this.track = null; this.wave = null; this.duration = 0; this.loop = null;
    if (this.sync) { this.sync = false; this.post({ t: "sync", on: false }); }
    this.app.onDeckEjected(this);
    this.app.emit();
  }

  // ------------------------------------------------------------- transporte
  seek(t: number): void {
    if (!this.loaded) return;
    this.pos = Math.max(0, Math.min(this.duration, t));
    this.stateTime = this.app.engine.ctx.currentTime;
    this.post({ t: "seek", pos: this.pos });
  }

  needle(frac: number): void {
    if (settings.needleLock && this.playing) return;
    this.seek(frac * this.duration);
  }

  play(): void {
    if (!this.loaded) return;
    if (this.cuePreview || this.hotPreview >= 0) { this.playDuringPreview = true; return; }
    this.post({ t: "play", on: true });
    this.app.onDeckPlay(this);
  }

  pause(brake = settings.brakeTime): void {
    if (!this.loaded) return;
    this.cuePreview = false;
    this.hotPreview = -1;
    this.post({ t: "play", on: false, brake });
  }

  togglePlay(): void {
    if (this.playing && !this.cuePreview && this.hotPreview < 0) this.pause();
    else this.play();
  }

  /** Stutter (shift+play estilo Serato): vuelve al cue y sigue sonando. */
  stutter(): void {
    if (!this.loaded) return;
    this.seek(this.cue ?? 0);
    this.post({ t: "play", on: true });
  }

  cueDown(): void {
    if (!this.loaded) return;
    const t = this.track!;
    if (this.playing && !this.cuePreview && this.hotPreview < 0) {
      // back cue: vuelve al punto de cue y pausa
      this.post({ t: "play", on: false });
      this.seek(t.cues.main ?? 0);
      return;
    }
    if (!this.playing) {
      const p = this.now();
      if (t.cues.main === null || Math.abs(p - t.cues.main) > 0.015) {
        t.cues.main = this.q(p);
        this.seek(t.cues.main);
        this.app.library.saveTrack(t);
      } else {
        this.cuePreview = true;
        this.playDuringPreview = false;
        this.post({ t: "play", on: true });
      }
    }
  }

  cueUp(): void {
    if (!this.cuePreview) return;
    this.cuePreview = false;
    if (!this.playDuringPreview) {
      this.post({ t: "play", on: false });
      this.seek(this.track?.cues.main ?? 0);
    } else this.app.onDeckPlay(this);
  }

  /** Shift+CUE: al inicio de la pista. */
  toStart(): void {
    this.seek(0);
  }

  // ------------------------------------------------------------- hot cues
  hotDown(i: number, shift = false): void {
    if (!this.loaded) return;
    const t = this.track!;
    if (shift) { this.deleteHot(i); return; }
    const h = t.cues.hot[i];
    if (!h) {
      if (this.loopOn && this.loop) t.cues.hot[i] = { pos: this.loop.start, loopEnd: this.loop.end, color: HOTCUE_COLORS[i] };
      else t.cues.hot[i] = { pos: this.q(this.now()), color: HOTCUE_COLORS[i] };
      this.app.library.saveTrack(t);
      this.app.emit();
      return;
    }
    if (h.loopEnd) {
      this.loop = { start: h.pos, end: h.loopEnd };
      this.post({ t: "loop", start: h.pos, end: h.loopEnd, on: true, jump: true });
      if (!this.playing) this.play();
      return;
    }
    if (this.playing && !this.cuePreview && this.hotPreview < 0) {
      if (settings.quantize && this.bpm > 0) this.post({ t: "jumpPhase", pos: h.pos });
      else this.seek(h.pos);
    } else {
      this.seek(h.pos);
      this.hotPreview = i;
      this.playDuringPreview = false;
      this.post({ t: "play", on: true });
    }
  }

  hotUp(i: number): void {
    if (this.hotPreview !== i) return;
    this.hotPreview = -1;
    const h = this.track?.cues.hot[i];
    if (!this.playDuringPreview) {
      this.post({ t: "play", on: false });
      if (h) this.seek(h.pos);
    } else this.app.onDeckPlay(this);
  }

  deleteHot(i: number): void {
    if (!this.track) return;
    this.track.cues.hot[i] = null;
    this.app.library.saveTrack(this.track);
    this.app.emit();
  }

  // ------------------------------------------------------------- memory cues (CDJ MEMORY / CALL)
  addMemory(): void {
    if (!this.track) return;
    const pos = this.loopOn && this.loop ? this.loop.start : this.q(this.now());
    const m = this.track.cues.memory;
    if (m.some((x) => Math.abs(x.pos - pos) < 0.05)) return;
    m.push({ pos, loopEnd: this.loopOn && this.loop ? this.loop.end : undefined });
    m.sort((a, b) => a.pos - b.pos);
    this.app.library.saveTrack(this.track);
    this.app.emit();
  }

  callMemory(dir: 1 | -1): void {
    if (!this.track) return;
    const p = this.now();
    const m = this.track.cues.memory;
    const target = dir > 0 ? m.find((x) => x.pos > p + 0.05) : [...m].reverse().find((x) => x.pos < p - 0.05);
    if (!target) return;
    if (!this.playing) { this.track.cues.main = target.pos; this.app.library.saveTrack(this.track); }
    if (target.loopEnd) { this.loop = { start: target.pos, end: target.loopEnd }; }
    this.seek(target.pos);
  }

  deleteMemory(): void {
    if (!this.track) return;
    const p = this.now();
    const m = this.track.cues.memory;
    let best = -1, bd = 0.25;
    m.forEach((x, k) => { const d = Math.abs(x.pos - p); if (d < bd) { bd = d; best = k; } });
    if (best >= 0) { m.splice(best, 1); this.app.library.saveTrack(this.track); this.app.emit(); }
  }

  // ------------------------------------------------------------- loops
  private setLoop(start: number, end: number, on: boolean, jump = false): void {
    this.loop = { start, end };
    this.post({ t: "loop", start, end, on, jump, wrapIfOutside: true });
    if (on && this.slip) this.post({ t: "slip", on: true });
  }

  autoLoop(beats: number): void {
    if (!this.loaded) return;
    const bl = this.beatLen;
    const len = beats * bl;
    if (this.loopOn && this.loop && Math.abs(this.loop.end - this.loop.start - len) < 1e-3) { this.loopExit(); return; }
    const start = this.loopOn && this.loop ? this.loop.start : this.q(this.now());
    this.setLoop(start, start + len, true);
  }

  rollDown(beats: number): void {
    if (!this.loaded || this.rolling) return;
    this.rolling = true;
    const start = this.q(this.now());
    this.post({ t: "slip", on: true });
    this.loop = { start, end: start + beats * this.beatLen };
    this.post({ t: "loop", start, end: this.loop.end, on: true, wrapIfOutside: true });
  }

  rollUp(): void {
    if (!this.rolling) return;
    this.rolling = false;
    this.post({ t: "loopOff" });
    this.post({ t: "slip", on: false, ret: true });
    if (this.slip) this.post({ t: "slip", on: true });
  }

  loopInBtn(): void {
    if (!this.loaded) return;
    this.loopIn = this.q(this.now());
    if (this.loopOn && this.loop) this.setLoop(this.loopIn, this.loop.end, true);
    this.app.emit();
  }

  loopOutBtn(): void {
    if (!this.loaded) return;
    const start = this.loopIn ?? (this.loop?.start ?? null);
    if (start === null) return;
    let end = this.q(this.now());
    if (end <= start + 0.01) end = start + this.beatLen;
    this.setLoop(start, end, true);
    this.loopIn = null;
    this.app.emit();
  }

  reloop(): void {
    if (!this.loaded) return;
    if (this.loopOn) { this.loopExit(); return; }
    if (!this.loop) return;
    const p = this.now();
    this.setLoop(this.loop.start, this.loop.end, true, p > this.loop.end || p < this.loop.start);
  }

  loopExit(): void {
    this.post({ t: "loopOff" });
    if (this.slip && !this.rolling) { this.post({ t: "slip", on: false, ret: true }); this.post({ t: "slip", on: true }); }
  }

  loopToggle(): void {
    if (this.loopOn) this.loopExit();
    else this.autoLoop(4);
  }

  loopHalve(): void {
    if (!this.loop) return;
    const len = (this.loop.end - this.loop.start) / 2;
    if (len < this.beatLen / 32) return;
    this.setLoop(this.loop.start, this.loop.start + len, this.loopOn);
  }

  loopDouble(): void {
    if (!this.loop) return;
    const len = (this.loop.end - this.loop.start) * 2;
    if (len > this.beatLen * 64) return;
    this.setLoop(this.loop.start, this.loop.start + len, this.loopOn);
  }

  beatJump(beats: number): void {
    if (!this.loaded) return;
    if (this.loopOn && this.loop) { const d = beats * this.beatLen; this.loop = { start: this.loop.start + d, end: this.loop.end + d }; }
    this.post({ t: "beatjump", beats, moveLoop: true });
  }

  // ------------------------------------------------------------- tempo / key
  setFader(v: number, fromHw = false): void {
    if (fromHw && this.pitchPickup) {
      if (Math.abs(v - this.fader) > 0.03) return;
      this.pitchPickup = false;
    }
    if (this.sync && !this.isMaster) { this.fader = v; return; } // sync manda; se recoge al soltar sync
    this.fader = Math.max(-1, Math.min(1, v));
    this.post({ t: "tempo", v: this.tempo });
  }

  cycleRange(): void {
    const t = this.effTempo;
    const k = TEMPO_RANGES.indexOf(this.range);
    this.range = TEMPO_RANGES[(k + 1) % TEMPO_RANGES.length];
    // mantiene el tempo actual: recalcula la posición del fader
    this.fader = Math.max(-1, Math.min(1, ((t - 1) * 100) / this.range));
    this.pitchPickup = true;
    this.post({ t: "tempo", v: this.tempo });
    this.app.emit();
  }

  tempoReset(): void {
    this.fader = 0;
    this.pitchPickup = true;
    this.post({ t: "tempo", v: 1 });
    this.app.emit();
  }

  bend(dir: number): void {
    this.post({ t: "bend", v: dir * 0.03 });
  }

  toggleKeylock(): void {
    this.keylock = !this.keylock;
    this.post({ t: "keylock", on: this.keylock });
    this.app.emit();
  }

  setKey(semis: number): void {
    this.keySemis = Math.max(-12, Math.min(12, Math.round(semis)));
    this.post({ t: "key", v: this.keySemis });
    this.app.emit();
  }

  /** Tonalidad que suena ahora (incluye key shift y el pitch si no hay keylock). */
  effKey(): number {
    const k = this.track?.key ?? -1;
    if (k < 0) return -1;
    const tempoSemis = this.keylock ? 0 : 12 * Math.log2(Math.max(0.01, this.effTempo));
    return shiftKey(k, this.keySemis + tempoSemis);
  }

  keySync(): void {
    const ref = this.app.keyReference(this);
    const k = this.track?.key ?? -1;
    if (!ref || k < 0) return;
    if (!this.keylock) this.toggleKeylock();
    this.setKey(keySyncShift(k, ref.effKey()));
  }

  toggleSync(): void {
    if (this.sync) this.app.syncOff(this);
    else this.app.syncOn(this);
  }

  // ------------------------------------------------------------- jog
  jogTouch(on: boolean, shift = false): void {
    this.touched = on;
    if (!this.loaded) return;
    if (on && !shift && (this.vinyl || !this.playing)) {
      this.post({ t: "scratch", on: true });
      if (this.slip && this.playing) this.post({ t: "slip", on: true });
    } else if (!on) {
      this.post({ t: "scratch", on: false });
      if (this.slip) { this.post({ t: "slip", on: false, ret: true }); this.post({ t: "slip", on: true }); }
    }
  }

  jogTurn(ticks: number, shift = false): void {
    if (!this.loaded) return;
    if (shift) { this.seek(this.now() + ticks * 0.06); return; }
    const scratchy = this.touched && (this.vinyl || !this.playing);
    if (scratchy) this.post({ t: "scratchMove", v: ticks * SEC_PER_TICK * settings.jogSensitivity });
    else if (this.playing) this.post({ t: "nudge", v: ticks * 0.0035 });
    else this.seek(this.now() + ticks * SEC_PER_TICK * 2);
  }

  // ------------------------------------------------------------- slip / reverse / efectos de plato
  toggleSlip(): void {
    this.slip = !this.slip;
    this.post({ t: "slip", on: this.slip, ret: !this.slip });
    this.app.emit();
  }

  toggleReverse(): void {
    this.reverse = !this.reverse;
    this.post({ t: "reverse", on: this.reverse });
    this.app.emit();
  }

  /** Censor: reverse momentáneo con slip (vuelve donde tocaría). */
  censor(on: boolean): void {
    if (!this.loaded || on === this.censoring) return;
    this.censoring = on;
    if (on) { this.post({ t: "slip", on: true }); this.post({ t: "reverse", on: true }); }
    else {
      this.post({ t: "reverse", on: this.reverse });
      this.post({ t: "slip", on: false, ret: true });
      if (this.slip) this.post({ t: "slip", on: true });
    }
  }

  brake(seconds = 1.2): void { if (this.playing) this.post({ t: "play", on: false, brake: seconds }); }
  spinback(): void { if (this.loaded) this.post({ t: "spinback", v: 3 }); }

  toggleVinyl(): void { this.vinyl = !this.vinyl; this.app.emit(); }

  // ------------------------------------------------------------- beatgrid
  setGrid(bpm: number, firstBeat: number): void {
    const t = this.track;
    if (!t || bpm <= 0) return;
    const bl = 60 / bpm;
    firstBeat = ((firstBeat % bl) + bl) % bl;
    t.grid = { bpm, firstBeat, downbeat: t.grid?.downbeat ?? 0 };
    t.bpm = bpm;
    this.post({ t: "grid", bpm, firstBeat });
    this.app.library.saveTrack(t);
    this.app.emit();
  }

  gridScale(f: number): void { if (this.bpm) this.setGrid(this.bpm * f, this.firstBeat); }
  gridNudgeBpm(d: number): void { if (this.bpm) this.setGrid(Math.round((this.bpm + d) * 1000) / 1000, this.firstBeat); }
  gridShift(ms: number): void { if (this.bpm) this.setGrid(this.bpm, this.firstBeat + ms / 1000); }

  /** Marca el beat actual como "1" del compás (y alinea el grid aquí). */
  gridDownbeatHere(): void {
    const t = this.track;
    if (!t || !this.bpm) return;
    const p = this.now();
    const bl = this.beatLen;
    const fb = ((p % bl) + bl) % bl;
    const idx = Math.round((p - fb) / bl);
    t.grid = { bpm: this.bpm, firstBeat: fb, downbeat: ((idx % 4) + 4) % 4 };
    this.post({ t: "grid", bpm: this.bpm, firstBeat: fb });
    this.app.library.saveTrack(t);
    this.app.emit();
  }

  // ------------------------------------------------------------- estado del motor
  applyState(s: number[], o: number, ct: number): void {
    this.pos = s[o];
    this.speed = s[o + 1];
    const f = s[o + 2];
    const wasPlaying = this.playing;
    this.playing = (f & 1) !== 0;
    this.loopOn = (f & 2) !== 0;
    this.slipping = (f & 4) !== 0;
    this.scratching = (f & 8) !== 0;
    this.keylockActive = (f & 16) !== 0;
    this.reversed = (f & 32) !== 0;
    this.slipPos = s[o + 3];
    this.syncTempo = s[o + 4];
    this.stateTime = ct;
    if (wasPlaying !== this.playing) this.app.emit();
  }
}
