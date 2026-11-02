import type { App } from "../app";

/**
 * Reloj de semicorcheas enganchado al beatgrid del deck MASTER.
 *
 * Un "paso" = 1/16 de compás (1/4 de beat). El paso 0 coincide con el
 * downbeat del compás del tema que suena, así que los patrones caen "en el 1"
 * de la pista. Si el master hace loop/hot cue, el reloj le sigue; si se para
 * o se scratchea, el reloj continúa libre al último tempo conocido.
 */
export class LiveClock {
  /** referencia: en el instante `t` (AudioContext) el paso fraccional era `s`, cada paso dura `dur` s */
  ref = { t: 0, s: 0, dur: 60 / 120 / 4 };
  internalBpm = 120;
  locked = false; // true = siguiendo al master

  constructor(private app: App) {
    this.ref.t = app.engine.ctx.currentTime;
  }

  get bpm(): number { return 60 / (this.ref.dur * 4); }

  /** Actualiza la referencia desde el master (llamar en cada tick del scheduler). */
  update(): void {
    const app = this.app;
    const ctx = app.engine.ctx;
    const now = ctx.currentTime;
    const m = app.decks[app.master];
    const good = m && m.loaded && m.bpm > 0 && m.playing && !m.scratching && m.speed > 0.5 && m.speed < 2;
    if (good) {
      // posición que el motor está renderizando ahora: lo que se programe en
      // este instante de AudioContext sale por el altavoz junto a ella
      const pos = m.now();
      const db = m.track?.grid?.downbeat ?? 0;
      const beat = (pos - m.firstBeat) / m.beatLen - db;
      const dur = m.beatLen / 4 / Math.abs(m.speed);
      const s = beat * 4;
      // tiempo de AudioContext en que "suena" ahora esa posición
      this.ref = { t: now, s, dur };
      this.locked = true;
      this.internalBpm = 60 / (dur * 4);
    } else {
      if (this.locked) {
        // pasa a reloj libre manteniendo fase y tempo
        this.locked = false;
      }
      const dur = 60 / this.internalBpm / 4;
      if (Math.abs(dur - this.ref.dur) > 1e-6) {
        const sNow = this.stepAt(now);
        this.ref = { t: now, s: sNow, dur };
      }
    }
  }

  stepAt(t: number): number { return this.ref.s + (t - this.ref.t) / this.ref.dur; }
  timeOf(step: number): number { return this.ref.t + (step - this.ref.s) * this.ref.dur; }

  setInternalBpm(bpm: number): void {
    const now = this.app.engine.ctx.currentTime;
    const s = this.stepAt(now);
    this.internalBpm = Math.max(40, Math.min(250, bpm));
    if (!this.locked) this.ref = { t: now, s, dur: 60 / this.internalBpm / 4 };
  }
}
