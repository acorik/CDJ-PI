import type { LiveClock } from "./clock";

export const MAX_STEPS = 64;
export const DRUM_TRACKS = 16;
/** pista 16 = bajo 808 (guarda índice de nota +1) */
export const BASS_TRACK = 16;

export interface Pattern {
  len: 16 | 32 | 64;
  swing: number; // 0..0.6 (fracción de paso que se retrasan las semicorcheas pares)
  /** velocidad (0 = vacío) por pista y paso */
  vel: number[][];
  /** nota del bajo por paso (índice de pad del banco C, -1 = nada) */
  bass: number[];
  mute: boolean[];
}

export function emptyPattern(): Pattern {
  return {
    len: 16, swing: 0,
    vel: Array.from({ length: DRUM_TRACKS + 1 }, () => new Array(MAX_STEPS).fill(0)),
    bass: new Array(MAX_STEPS).fill(-1),
    mute: new Array(DRUM_TRACKS + 1).fill(false),
  };
}

export interface SeqOutput {
  drum(track: number, vel: number, when: number): void;
  bass(note: number, vel: number, when: number): void;
}

/** Secuenciador por pasos con lookahead, sincronizado a LiveClock. */
export class Sequencer {
  pat: Pattern = emptyPattern();
  playing = false;
  rec = false;
  private lastStep = -Infinity;
  private undo: Pattern | null = null;
  /** evita doble disparo: pasos grabados "por delante" que ya sonaron al tocarlos */
  private skip = new Set<string>();
  currentStep = -1;
  private timer = 0;

  constructor(private clock: LiveClock, private out: SeqOutput, private ctxTime: () => number, private latency: () => number) {}

  start(): void {
    if (this.playing) return;
    this.playing = true;
    this.lastStep = Math.floor(this.clock.stepAt(this.ctxTime())) - 1;
    this.timer = window.setInterval(() => this.tick(), 20);
  }

  stop(): void {
    this.playing = false;
    this.rec = false;
    clearInterval(this.timer);
    this.currentStep = -1;
  }

  toggleRec(): void {
    this.rec = !this.rec;
    if (this.rec) { this.undo = clonePattern(this.pat); if (!this.playing) this.start(); }
  }

  undoLast(): boolean {
    if (!this.undo) return false;
    this.pat = this.undo;
    this.undo = null;
    return true;
  }

  clear(track?: number): void {
    this.undo = clonePattern(this.pat);
    if (track === undefined) { this.pat.vel.forEach((r) => r.fill(0)); this.pat.bass.fill(-1); }
    else { this.pat.vel[track].fill(0); if (track === BASS_TRACK) this.pat.bass.fill(-1); }
  }

  private stepTime(step: number): number {
    const t = this.clock.timeOf(step);
    return step % 2 === 1 ? t + this.pat.swing * this.clock.ref.dur : t;
  }

  /** Graba un golpe (cuantizado a la semicorchea más cercana). Devuelve el paso. */
  record(track: number, vel: number, note = -1): number {
    this.clock.update();
    // el usuario toca sobre lo que OYE, que va `latency` por detrás de lo que se renderiza
    const sF = this.clock.stepAt(this.ctxTime() - this.latency());
    const s = Math.round(sF);
    const idx = ((s % this.pat.len) + this.pat.len) % this.pat.len;
    this.pat.vel[track][idx] = Math.max(1, vel);
    if (track === BASS_TRACK) this.pat.bass[idx] = note;
    if (s > this.lastStep) this.skip.add(`${track}:${s}`);
    return idx;
  }

  private tick(): void {
    this.clock.update();
    const now = this.ctxTime();
    const sNow = this.clock.stepAt(now);
    // el master ha saltado (loop, hot cue, otro tema): re-engancha
    if (sNow < this.lastStep - 1.5 || sNow > this.lastStep + 16) this.lastStep = Math.floor(sNow) - 1;
    const horizon = now + 0.12;
    for (let s = this.lastStep + 1; ; s++) {
      const t = this.stepTime(s);
      if (t > horizon) break;
      this.lastStep = s;
      if (t < now - 0.03) continue; // demasiado tarde
      const idx = ((s % this.pat.len) + this.pat.len) % this.pat.len;
      for (let tr = 0; tr <= DRUM_TRACKS; tr++) {
        const v = this.pat.vel[tr][idx];
        if (!v || this.pat.mute[tr]) continue;
        const key = `${tr}:${s}`;
        if (this.skip.has(key)) { this.skip.delete(key); continue; }
        if (tr === BASS_TRACK) this.out.bass(this.pat.bass[idx], v, t);
        else this.out.drum(tr, v, t);
      }
    }
    this.currentStep = ((Math.floor(sNow) % this.pat.len) + this.pat.len) % this.pat.len;
    if (this.skip.size > 64) this.skip.clear();
  }
}

export function clonePattern(p: Pattern): Pattern {
  return { len: p.len, swing: p.swing, vel: p.vel.map((r) => r.slice()), bass: p.bass.slice(), mute: p.mute.slice() };
}

/**
 * MIDI clock (24 ppqn) para que el Note Repeat del MPD218 vaya al tempo de la
 * mezcla. Usa los timestamps de Web MIDI para que el jitter del hilo principal
 * no afecte: los ticks se programan ~100 ms por delante.
 */
export class MidiClockOut {
  private lastTick = -Infinity;
  private timer = 0;
  enabled = true;
  constructor(private clock: LiveClock, private ctx: AudioContext, private send: (data: number[], ts: number) => void) {}

  start(): void {
    this.send([0xfa], performance.now());
    this.timer = window.setInterval(() => this.tick(), 25);
  }

  stop(): void {
    clearInterval(this.timer);
    this.send([0xfc], performance.now());
  }

  private tick(): void {
    if (!this.enabled) return;
    this.clock.update();
    // las notas que devuelva el Note Repeat se disparan al llegar, en el mismo
    // dominio que el render del master: basta con mapear reloj de audio -> reloj de pared
    const ctxNow = this.ctx.currentTime;
    const perfNow = performance.now();
    const toPerf = (t: number) => perfNow + (t - ctxNow) * 1000;
    // tick c ocurre en el paso c/6
    const cNow = this.clock.stepAt(ctxNow) * 6;
    if (cNow < this.lastTick - 12 || cNow > this.lastTick + 96) this.lastTick = Math.floor(cNow);
    for (let c = this.lastTick + 1; ; c++) {
      const t = this.clock.timeOf(c / 6);
      if (t > ctxNow + 0.1) break;
      this.lastTick = c;
      if (t < ctxNow - 0.02) continue;
      this.send([0xf8], Math.max(perfNow, toPerf(t)));
    }
  }
}
