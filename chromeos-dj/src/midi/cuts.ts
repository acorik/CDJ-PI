import type { App } from "../app";

// Patrones de "fader cuts" en semicorcheas (1 = abierto, 0 = corte),
// alineados al beatgrid del deck.
export const CUT_PATTERNS = ["10", "1100", "1000", "1110", "1011", "10101100", "11011010", "1000100010101111"];

interface Active { pad: number; timer: number; lastK: number }

export class FaderCuts {
  private active: (Active | null)[] = [null, null, null, null];
  constructor(private app: App) {}

  start(di: number, pad: number): void {
    this.stop(di, -1);
    const a: Active = { pad, timer: 0, lastK: -Infinity };
    a.timer = window.setInterval(() => this.schedule(di, a), 25);
    this.active[di] = a;
    this.schedule(di, a);
  }

  stop(di: number, pad: number): void {
    const a = this.active[di];
    if (!a || (pad >= 0 && a.pad !== pad)) return;
    clearInterval(a.timer);
    this.active[di] = null;
    const g = this.app.engine.channels[di].cut.gain;
    const t = this.app.engine.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(1, t, 0.003);
  }

  private schedule(di: number, a: Active): void {
    const d = this.app.decks[di];
    const ctx = this.app.engine.ctx;
    if (!d.playing || d.bpm <= 0) return;
    const pat = CUT_PATTERNS[a.pad];
    const step = d.beatLen / 4;
    const p = d.now();
    const speed = Math.max(0.05, Math.abs(d.speed));
    const g = this.app.engine.channels[di].cut.gain;
    let k = Math.ceil((p - d.firstBeat) / step);
    for (;; k++) {
      const trackT = d.firstBeat + k * step;
      const at = ctx.currentTime + (trackT - p) / speed + this.app.outLatency;
      if (at > ctx.currentTime + 0.15) break;
      if (k <= a.lastK) continue;
      a.lastK = k;
      const v = pat[((k % pat.length) + pat.length) % pat.length] === "1" ? 1 : 0;
      g.setTargetAtTime(v, Math.max(ctx.currentTime, at), 0.002);
    }
  }
}
