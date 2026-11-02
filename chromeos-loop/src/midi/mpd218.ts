import type { App } from "../app";
import { PRESETS } from "../synth/presets";

/** Mapeo por defecto (Program 1): pads 36..83 en bancos A/B/C; knobs por CC. */
const DEFAULT_CC = [3, 9, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27];
const MAP_KEY = "cdjpi-loop-mpd-map";

interface MapStore { notes: Record<number, number>; ccs: Record<number, number> }

export const WIZARD_STEPS = [
  "Pulsa el PAD 1 del BANCO A",
  "Pulsa el PAD 1 del BANCO B",
  "Pulsa el PAD 1 del BANCO C",
  ...["A", "B", "C"].flatMap((b) => [1, 2, 3, 4, 5, 6].map((k) => `Gira el KNOB ${k} del CTRL BANK ${b}`)),
];

/** Akai MPD218 en modo looper. */
export class Mpd218 {
  map: MapStore;
  wizard = -1;
  private wizCC = new Set<number>();
  /** notas del sinte sonando por pad (para soltar la nota correcta) */
  private padNotes = new Map<number, number>();

  constructor(private app: App) { this.map = this.load(); }

  private load(): MapStore {
    try { const m = JSON.parse(localStorage.getItem(MAP_KEY) ?? ""); if (m?.notes && m?.ccs) return m; } catch { /* */ }
    return Mpd218.defaults();
  }

  static defaults(): MapStore {
    const notes: Record<number, number> = {};
    for (let i = 0; i < 48; i++) notes[36 + i] = i;
    const ccs: Record<number, number> = {};
    DEFAULT_CC.forEach((cc, i) => { ccs[cc] = i; });
    return { notes, ccs };
  }

  reset(): void { localStorage.removeItem(MAP_KEY); this.map = Mpd218.defaults(); }
  private save(): void { try { localStorage.setItem(MAP_KEY, JSON.stringify(this.map)); } catch { /* */ } }

  startWizard(): void { this.wizard = 0; this.wizCC.clear(); this.map = { notes: {}, ccs: {} }; this.app.toast(WIZARD_STEPS[0]); this.app.emit(); }

  private wizardInput(kind: "note" | "cc", n: number): void {
    const step = this.wizard;
    if (step < 3 && kind === "note") {
      for (let i = 0; i < 16; i++) this.map.notes[n + i] = step * 16 + i;
    } else if (step >= 3 && kind === "cc" && !this.wizCC.has(n)) {
      this.map.ccs[n] = step - 3;
      this.wizCC.add(n);
    } else return;
    this.wizard++;
    if (this.wizard >= WIZARD_STEPS.length) { this.wizard = -1; this.save(); this.app.toast("MPD218 aprendido ✔"); }
    else this.app.toast(WIZARD_STEPS[this.wizard]);
    this.app.emit();
  }

  onMessage(data: Uint8Array): void {
    const type = data[0] & 0xf0;
    const a = data[1], b = data[2] ?? 0;
    if (type === 0x90 && b > 0) {
      if (this.wizard >= 0) { this.wizardInput("note", a); return; }
      const g = this.map.notes[a];
      if (g !== undefined) this.pad(g, b, true);
    } else if (type === 0x80 || (type === 0x90 && b === 0)) {
      const g = this.map.notes[a];
      if (g !== undefined && this.wizard < 0) this.pad(g, 0, false);
    } else if (type === 0xb0) {
      if (this.wizard >= 0) { this.wizardInput("cc", a); return; }
      const k = this.map.ccs[a];
      if (k !== undefined) this.knob(k, b / 127);
    }
  }

  pad(g: number, vel: number, down: boolean): void {
    const app = this.app;
    const bank = Math.floor(g / 16), i = g % 16;
    if (bank === 0) { if (down) app.drums.trigger(i, vel); return; }
    if (bank === 1) {
      if (down) { const n = app.padNote(i); this.padNotes.set(g, n); app.synth.noteOn(n, vel); }
      else { const n = this.padNotes.get(g); if (n !== undefined) app.synth.noteOff(n); this.padNotes.delete(g); }
      app.emit();
      return;
    }
    // banco C: 1-8 = pistas · 9-16 = acordes
    if (i < 8) { if (down) app.looper.press(i); }
    else if (down) app.chordOn(200 + i, i - 8, vel); else app.chordOff(200 + i);
  }

  knob(k: number, v: number): void {
    const app = this.app, s = app.synth, d = app.drums, t = app.ctx.currentTime;
    switch (k) {
      case 0: s.macro.cutoff = Math.pow(2, (v - 0.5) * 6); break;
      case 1: s.macro.res = (v - 0.5) * 16; break;
      case 2: s.macro.attack = Math.pow(2, (v - 0.5) * 8); break;
      case 3: s.macro.release = Math.pow(2, (v - 0.5) * 6); break;
      case 4: s.macro.lfo = v * 2; break;
      case 5: app.fx[0].setLevel(v); break;
      case 6: d.setVolume(v); break;
      case 7: d.setFilter(v); break;
      case 8: d.setDrive(v); break;
      case 9: d.params.kickDecay = v; break;
      case 10: d.params.kickTune = v; break;
      case 11: d.params.hatDecay = v; break;
      case 12: app.perf.setMasterFilter(v); break;
      case 13: app.loopBus.gain.setTargetAtTime(v * 1.2, t, 0.02); break;
      case 14: app.instrOut.gain.setTargetAtTime(v * 1.2, t, 0.02); break;
      case 15: app.fx[1].setLevel(v); break;
      case 16: app.setMetroVol(v); break;
      case 17: { const p = PRESETS[Math.min(PRESETS.length - 1, Math.floor(v * PRESETS.length))]; if (p !== app.preset) app.setPreset(p); break; }
    }
    app.emit();
  }
}
