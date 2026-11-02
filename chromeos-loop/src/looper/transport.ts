import type { GridClock } from "../audio/perf";
import type { Clock } from "../synth/synth";

/**
 * Transporte: tempo y rejilla de compases. El compás dura un número ENTERO
 * de muestras (barFrames) para que loops de distinta longitud no se
 * desfasen nunca; el BPM real se ajusta a eso (diferencia < 0.01 BPM).
 */
export class Transport implements Clock, GridClock {
  bpm = 90;
  readonly beatsPerBar = 4;
  running = false;
  /** tiempo de AudioContext del inicio del compás 0 */
  t0 = 0;
  barFrames = 0;
  ref = { dur: 0 };
  private listeners: (() => void)[] = [];

  constructor(readonly sr: number) {
    this.setBpm(90);
  }

  onChange(l: () => void): void { this.listeners.push(l); }
  private emit(): void { for (const l of this.listeners) l(); }

  get barSec(): number { return this.barFrames / this.sr; }
  beatSec(): number { return this.barSec / this.beatsPerBar; }
  get stepSec(): number { return this.beatSec() / 4; }

  setBpm(bpm: number, now = 0): void {
    bpm = Math.max(40, Math.min(240, bpm));
    const keepBeat = this.running ? this.beatAt(now) : 0;
    this.barFrames = Math.round((this.sr * 60 * this.beatsPerBar) / bpm);
    this.bpm = (this.sr * 60 * this.beatsPerBar) / this.barFrames;
    this.ref.dur = this.stepSec;
    if (this.running) this.t0 = now - keepBeat * this.beatSec();
    this.emit();
  }

  start(t0: number): void {
    // el compás 0 empieza en una muestra exacta
    this.t0 = Math.round(t0 * this.sr) / this.sr;
    this.running = true;
    this.emit();
  }

  stop(): void { this.running = false; this.emit(); }

  // ---- Clock (sinte/arpegiador)
  isRunning(): boolean { return this.running; }
  beatAt(t: number): number { return (t - this.t0) / this.beatSec(); }
  timeOfBeat(b: number): number { return this.t0 + b * this.beatSec(); }
  barAt(t: number): number { return (t - this.t0) / this.barSec; }
  timeOfBar(b: number): number { return this.t0 + b * this.barSec; }

  /** Frame de rejilla (muestras desde el compás 0) de un instante. */
  gridFrame(t: number): number { return Math.round((t - this.t0) * this.sr); }
  t0Frame(): number { return Math.round(this.t0 * this.sr); }

  // ---- GridClock (FX de directo, en semicorcheas)
  update(): void { /* el transporte no deriva: nada que recalcular */ }
  stepAt(t: number): number { return (t - this.t0) / this.stepSec; }
  timeOf(step: number): number { return this.t0 + step * this.stepSec; }
}
