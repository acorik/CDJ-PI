// Numark Mixtrack Platinum FX como superficie de control del looper.
// Los números de nota/CC y el formato sysex de las pantallas de los platos
// salen del mapeo comunitario de Mixxx para esta controladora (datos del
// protocolo del hardware); la asignación de funciones es propia.

import type { App } from "../app";
import { settings, setSetting } from "../settings";
import { PRESETS } from "../synth/presets";
import { KITS } from "../drums/kits";
import type { TrackState } from "../looper/looper";

export type PadMode = "hotcue" | "autoloop" | "fadercuts" | "sampler";
const MODE_NOTES: Record<number, PadMode> = { 0x00: "hotcue", 0x0d: "autoloop", 0x07: "fadercuts", 0x0b: "sampler" };
const BARS = [1, 2, 4, 8, 0];

function encodeNum(n: number, drop = 0): number[] {
  const a = [28, 24, 20, 16, 12, 8, 4, 0].map((s) => (n >> s) & 0x0f);
  if (drop) a.splice(0, drop);
  a[0] = n < 0 ? 0x07 : 0x08;
  return a;
}

export class PlatinumLoop {
  mode: [PadMode, PadMode] = ["hotcue", "hotcue"];
  private shiftL = false;
  private shiftR = false;
  private out = new Map<string, string>();
  private timer = 0;
  private jogAcc = 0;
  private bendTouch = false;
  private bend = 0;
  private pitchMsb = [0, 0, 0, 0];
  private pitchLsb = [0, 0, 0, 0];
  private padNotes = new Map<string, number>();
  private lastStopPress = new Map<number, number>();
  /**
   * Controles absolutos ya vistos. Al conectarse, la controladora envía la
   * posición de todas sus perillas/faders: esa primera lectura se ignora para
   * que una perilla olvidada abajo no deje el sinte o la batería en silencio.
   * Solo cuenta cuando se mueve de verdad.
   */
  private seen = new Set<string>();
  private lastDeckBtn = 0;

  constructor(private app: App, private send: (d: number[]) => void, private sysex: boolean) {}

  get shift(): boolean { return this.shiftL || this.shiftR; }

  start(): void {
    if (this.sysex) {
      this.send([0xf0, 0x7e, 0x00, 0x06, 0x01, 0xf7]); // salir del modo demo
      this.send([0xf0, 0x00, 0x20, 0x7f, 0x03, 0x01, 0xf7]);
    }
    this.send([0x90, 0x08, 0x7f]);
    this.send([0x91, 0x08, 0x7f]);
    this.timer = window.setInterval(() => this.feedback(), 40);
  }

  stop(): void {
    clearInterval(this.timer);
    for (let d = 0; d < 4; d++) { this.send([0xb0 | d, 0x3f, 0]); this.send([0xb0 | d, 0x06, 0]); }
    if (this.sysex) this.send([0xf0, 0x00, 0x20, 0x7f, 0x02, 0xf7]);
  }

  onMessage(data: Uint8Array): void {
    if (data.length < 3) return;
    let status = data[0];
    const n = data[1];
    let v = data[2];
    const type = status & 0xf0, ch = status & 0x0f;
    if (type === 0x80) { status = 0x90 | ch; v = 0; }
    if (type === 0x80 || type === 0x90) this.onNote(ch, n, v);
    else if (type === 0xb0) this.onCC(ch, n, v);
  }

  private onNote(ch: number, n: number, v: number): void {
    const app = this.app, press = v > 0;
    if (ch <= 3) {
      const side = ch % 2;
      switch (n) {
        case 0x20: if (side === 0) this.shiftL = press; else this.shiftR = press; app.shift = this.shift; app.emit(); return;
        case 0x00: if (press) app.togglePlay(); return;
        case 0x04: if (press) app.looper.stopAll(); return;
        case 0x01: if (press) { setSetting("metronome", !settings.metronome); app.emit(); } return;
        case 0x05: case 0x03: if (press) { setSetting("countIn", !settings.countIn); app.toast(`Cuenta atrás ${settings.countIn ? "ON" : "OFF"}`); } return;
        case 0x02: if (press) app.tap(); return;
        case 0x06: if (side === 1) { this.bendTouch = press; if (!press) { this.bend = 0; app.synth.setBend(0); } } return;
        case 0x07:
          if (!press) return;
          if (side === 0) { setSetting("afterRec", settings.afterRec === "play" ? "dub" : "play"); app.toast(`Tras grabar → ${settings.afterRec.toUpperCase()}`); }
          else { setSetting("micRec", !settings.micRec); app.applyMic(); app.toast(`Grabar micro ${settings.micRec ? "ON" : "OFF"}`); }
          app.emit();
          return;
        case 0x0b: case 0x2b: if (press) { setSetting("octave", Math.min(7, settings.octave + 1)); app.emit(); } return;
        case 0x0c: case 0x2c: if (press) { setSetting("octave", Math.max(1, settings.octave - 1)); app.emit(); } return;
        case 0x1b: if (press) { const u = app.fx[side]; u.setOn(!u.on); app.emit(); } return;
        case 0x08:
          // botón DECK (1/3 ó 2/4): cambia el MPD218 entre modo BATERÍA y PIANO
          if (v === 0x7f && performance.now() - this.lastDeckBtn > 300) { this.lastDeckBtn = performance.now(); app.toggleMpdMode(); }
          return;
      }
      return;
    }
    if (ch >= 4 && ch <= 7) {
      const side = (ch - 4) % 2;
      if (n >= 0x14 && n <= 0x23) { this.pad(side, (n - 0x14) % 8, v, n >= 0x1c || this.shift); return; }
      if (!press) return;
      const m = MODE_NOTES[n];
      if (m) { this.mode[side] = m; app.emit(); return; }
      switch (n) {
        case 0x40: app.looper.undo(app.looper.selected); return;
        case 0x41: app.looper.redo(app.looper.selected); return;
        case 0x34: case 0x36: this.stepBars(-1); return;
        case 0x35: case 0x37: this.stepBars(1); return;
      }
      return;
    }
    if (ch === 8 || ch === 9) {
      const u = ch - 8;
      if (n === 0x09) { if (press) app.tap(); return; }
      const slot = u === 0 ? n : n - 3;
      if (slot >= 0 && slot <= 2 && press) { app.fx[u].select(settings.fxSlots[slot]); app.emit(); }
      return;
    }
    if (ch === 15 && press) {
      if (n === 0x06) app.stepCategory(1);
      else if (n === 0x07) app.stepCategory(-1);
      else if (n === 0x02 || n === 0x04) void app.setKit((app.drums.kitIdx - 1 + KITS.length) % KITS.length);
      else if (n === 0x03 || n === 0x05) void app.setKit((app.drums.kitIdx + 1) % KITS.length);
    }
  }

  private stepBars(d: number): void {
    const i = BARS.indexOf(settings.loopBars);
    setSetting("loopBars", BARS[Math.max(0, Math.min(BARS.length - 1, i + d))]);
    this.app.toast(`Loop: ${settings.loopBars ? `${settings.loopBars} compás(es)` : "LIBRE"}`);
    this.app.emit();
  }

  private pad(side: number, i: number, v: number, shifted: boolean): void {
    const app = this.app, press = v > 0, mode = this.mode[side];
    if (side === 0) {
      if (mode === "hotcue") {
        if (!press) return;
        if (shifted) {
          // SHIFT+pad: parar; otra vez en <1 s con la pista parada: borrar
          const last = this.lastStopPress.get(i) ?? 0;
          if (Date.now() - last < 1000 && app.looper.tracks[i].state === "stopped") app.looper.clear(i);
          else app.looper.stop(i);
          this.lastStopPress.set(i, Date.now());
        } else app.looper.press(i);
        return;
      }
      const fx = (mode === "autoloop" ? 0 : 8) + i;
      if (press) app.perf.press(fx, Math.max(60, v)); else app.perf.release(fx);
      app.emit();
      return;
    }
    switch (mode) {
      case "hotcue": if (press) app.drums.trigger(i, Math.max(40, v)); break;
      case "autoloop": if (press) app.drums.trigger(8 + i, Math.max(40, v)); break;
      case "fadercuts": {
        const key = `n${i}`;
        if (press) { const note = app.padNote(i); this.padNotes.set(key, note); app.synth.noteOn(note, Math.max(40, v)); }
        else { const note = this.padNotes.get(key); if (note !== undefined) app.synth.noteOff(note); this.padNotes.delete(key); }
        app.emit();
        break;
      }
      case "sampler": if (press) app.chordOn(300 + i, i, Math.max(40, v)); else app.chordOff(300 + i); break;
    }
  }

  private onCC(ch: number, n: number, v: number): void {
    const app = this.app, x = v / 127;
    const absolute = (ch <= 3 && n !== 0x06) || (ch === 8 && n === 0x04) || ch === 14 || (ch === 15 && n === 0x08) || (ch === 15 && n >= 0x0c);
    if (absolute) {
      const key = `${ch % 2}:${n}:${ch === 15 || ch === 14 ? ch : ""}`;
      if (!this.seen.has(key)) { this.seen.add(key); return; }
    }
    if (ch <= 3) {
      const side = ch % 2;
      const rel = v >= 64 ? v - 128 : v;
      switch (n) {
        case 0x06:
          if (side === 0) {
            this.jogAcc += rel;
            if (Math.abs(this.jogAcc) >= 12) { app.stepPreset(Math.sign(this.jogAcc)); this.jogAcc = 0; }
          } else if (this.bendTouch) {
            this.bend = Math.max(-1, Math.min(1, this.bend + rel / 120));
            app.synth.setBend(this.bend);
          }
          return;
        case 0x09: this.pitchMsb[ch] = v; this.pitch(ch); return;
        case 0x29: this.pitchLsb[ch] = v; this.pitch(ch); return;
      }
      const s = app.synth, d = app.drums;
      if (side === 0) {
        switch (n) {
          case 0x16: app.setMix("synth", x, "perilla TRIM del canal 1"); break;
          case 0x17: s.macro.cutoff = Math.pow(2, (x - 0.5) * 6); break;
          case 0x18: s.macro.res = (x - 0.5) * 16; break;
          case 0x19: s.macro.release = Math.pow(2, (x - 0.5) * 6); break;
          case 0x1a: s.macro.lfo = x * 2; break;
          case 0x1c: app.setMix("instr", x, "fader del canal 1"); break;
          case 0x08: app.perf.setMasterFilter(x); break;
        }
      } else {
        switch (n) {
          case 0x16: app.setMix("drums", x, "perilla TRIM del canal 2"); break;
          case 0x17: d.params.hatDecay = x; break;
          case 0x18: d.params.snareTone = x; break;
          case 0x19: d.params.kickDecay = x; break;
          case 0x1a: d.setFilter(x); break;
          case 0x1c: app.setMix("loops", x, "fader del canal 2"); break;
          case 0x08: app.perf.setMasterFilter(x); break;
        }
      }
      return;
    }
    if (ch === 8 || ch === 9) {
      const u = ch - 8;
      if (n === 0x03) app.fx[u].setOn(v !== 0);
      else if (n === 0x04) app.fx.forEach((f) => f.setLevel(x));
      else if (n === 0x05) { const on = app.fx.filter((f) => f.on); for (const f of on.length ? on : app.fx) f.stepBeats(v < 0x40 ? 1 : -1); }
      app.emit();
      return;
    }
    if (ch === 14 && n === 0x23) { app.setMix("master", x, "perilla MASTER"); return; }
    if (ch === 15) {
      const rel = v >= 64 ? v - 128 : v;
      if (n === 0x00) app.stepPreset(Math.sign(rel));
      else if (n === 0x01) app.stepCategory(Math.sign(rel));
      else if (n === 0x08) app.perf.setMasterFilter(x);
    }
  }

  private pitch(ch: number): void {
    const x = ((this.pitchMsb[ch] << 7) | this.pitchLsb[ch]) / 16383;
    if (ch % 2 === 0) this.app.synth.macro.cutoff = Math.pow(2, (0.5 - x) * 6);
    else this.app.fx[1].setLevel(1 - x);
  }

  // ---------------------------------------------------------------- LEDs y pantallas
  private set(key: string, msg: number[]): void {
    const val = msg.join(",");
    if (this.out.get(key) === val) return;
    this.out.set(key, val);
    this.send(msg);
  }

  private feedback(): void {
    const app = this.app, tr = app.transport;
    const on = settings.padOnValue, off = settings.padOffValue;
    const ms = performance.now();
    const slow = Math.floor(ms / 400) % 2 === 0, fast = Math.floor(ms / 130) % 2 === 0;
    const beat = tr.running ? tr.beatAt(app.ctx.currentTime) : 0;
    const onBeat = tr.running && beat >= 0 && beat % 1 < 0.2;
    const trackLed = (s: TrackState) => s === "play" ? on : s === "rec" || s === "dub" ? (fast ? on : off) : s === "armed" || s === "playArmed" || s === "stopArmed" ? (slow ? on : off) : off;
    for (let d = 0; d < 4; d++) {
      const side = d % 2, s = 0x90 + d, ps = 0x94 + d;
      this.set(`play${d}`, [s, 0x00, tr.running ? 0x7f : (slow ? 0x7f : 0x01)]);
      this.set(`cue${d}`, [s, 0x01, settings.metronome ? 0x7f : 0x01]);
      this.set(`sync${d}`, [s, 0x02, onBeat ? 0x7f : 0x01]);
      this.set(`pfl${d}`, [s, 0x1b, app.fx[side].on ? 0x7f : 0x01]);
      this.set(`scr${d}`, [s, 0x07, (side === 0 ? settings.afterRec === "dub" : settings.micRec) ? 0x7f : 0x01]);
      // modos de pads
      const mode = this.mode[side];
      for (const [note, m] of Object.entries(MODE_NOTES)) this.set(`m${d}:${note}`, [ps, Number(note), m === mode ? 0x7f : 0x01]);
      for (let p = 0; p < 8; p++) {
        let val = off;
        if (side === 0) val = mode === "hotcue" ? trackLed(app.looper.tracks[p].state) : app.perf.active.has((mode === "autoloop" ? 0 : 8) + p) ? on : off;
        else if (mode === "hotcue" || mode === "autoloop") val = ms - app.drums.hitAt[(mode === "autoloop" ? 8 : 0) + p] < 100 ? on : off;
        else if (mode === "sampler") val = app.heldChords.has(300 + p) ? on : off;
        else val = this.padNotes.has(`n${p}`) ? on : off;
        this.set(`pad${d}:${p}`, [ps, 0x14 + p, val]);
      }
      this.set(`loop${d}`, [ps, 0x40, app.looper.tracks[app.looper.selected].canUndo ? 0x7f : 0x01]);
      // plato: anillo = posición dentro del compás, "spinner" = beat
      const barPh = tr.running && beat >= 0 ? (beat % 4) / 4 : 0;
      this.set(`ring${d}`, [0xb0 | d, 0x3f, Math.round(barPh * 52)]);
      this.set(`spin${d}`, [0xb0 | d, 0x06, 64 + Math.round(((beat % 1 + 1) % 1) * 51)]);
      // VU: entrada en el lado izquierdo, master en el derecho
      const lvl = app.level(side === 0 ? "input" : "master");
      const db = 20 * Math.log10(lvl + 1e-9);
      this.set(`vu${d}`, [0xb0 | d, 0x1f, Math.round(Math.max(0, Math.min(1, (db + 42) / 42)) * 90)]);
      if (this.sysex) {
        const bpm = encodeNum(Math.round(tr.bpm * 100)); bpm.shift(); bpm.shift();
        this.set(`bpm${d}`, [0xf0, 0x00, 0x20, 0x7f, d + 1, 0x01, ...bpm, 0xf7]);
        const ms2 = tr.running ? Math.max(0, Math.round((app.ctx.currentTime - tr.t0) * 10) * 100) : 0;
        this.set(`time${d}`, [0xf0, 0x00, 0x20, 0x7f, d + 1, 0x04, ...encodeNum(ms2), 0xf7]);
        const presetIdx = PRESETS.indexOf(app.preset);
        this.set(`rate${d}`, [0xf0, 0x00, 0x20, 0x7f, d + 1, 0x02, ...encodeNum(side === 0 ? presetIdx * 100 : app.drums.kitIdx * 100, 2), 0xf7]);
      }
    }
    for (let u = 0; u < 2; u++) {
      const unit = app.fx[u];
      for (let k = 0; k < 3; k++) this.set(`fx${u}:${k}`, [0x98 + u, u * 3 + k, unit.def.id === settings.fxSlots[k] ? (unit.on ? 0x7f : 0x40) : 0x01]);
      this.set(`tap${u}`, [0x98 + u, 0x09, onBeat ? 0x7f : 0x01]);
    }
  }
}
