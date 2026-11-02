import type { Transport } from "../looper/transport";

/**
 * MIDI clock (24 ppqn) a partir del transporte, con timestamps de Web MIDI
 * programados ~100 ms por delante (el jitter del hilo principal no afecta).
 * Sirve para que el Note Repeat del MPD218 vaya al tempo de los loops.
 */
export class MidiClockOut {
  private last = -Infinity;
  private timer = 0;
  private wasRunning = false;
  constructor(private tr: Transport, private ctx: AudioContext, private send: (d: number[], ts: number) => void) {}

  start(): void { this.timer = window.setInterval(() => this.tick(), 25); }

  stop(): void {
    clearInterval(this.timer);
    try { this.send([0xfc], performance.now()); } catch { /* */ }
  }

  private tick(): void {
    const ctxNow = this.ctx.currentTime;
    const perfNow = performance.now();
    const toPerf = (t: number) => perfNow + (t - ctxNow) * 1000;
    if (!this.tr.running) {
      if (this.wasRunning) { this.send([0xfc], perfNow); this.wasRunning = false; }
      // sin transporte: reloj libre al tempo actual (el Note Repeat sigue funcionando)
    } else if (!this.wasRunning) {
      this.wasRunning = true;
      this.send([0xfa], Math.max(perfNow, toPerf(this.tr.t0)));
      this.last = -1;
    }
    const beatAt = (t: number) => this.tr.running ? this.tr.beatAt(t) : t / this.tr.beatSec();
    const timeOf = (b: number) => this.tr.running ? this.tr.timeOfBeat(b) : b * this.tr.beatSec();
    const cNow = beatAt(ctxNow) * 24;
    if (cNow < this.last - 24 || cNow > this.last + 200) this.last = Math.floor(cNow);
    for (let c = this.last + 1; ; c++) {
      const t = timeOf(c / 24);
      if (t > ctxNow + 0.1) break;
      this.last = c;
      if (t < ctxNow - 0.02 || c < 0) continue;
      this.send([0xf8], Math.max(perfNow, toPerf(t)));
    }
  }
}
