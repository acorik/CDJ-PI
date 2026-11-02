// Mapeo de la Numark Mixtrack Platinum FX.
//
// Los números de nota/CC, el formato de las pantallas de los platos (sysex)
// y la secuencia de inicio salen del mapeo de la comunidad de Mixxx para
// esta controladora (son datos del protocolo del hardware). Toda la lógica
// de aquí es propia.

import type { App } from "../app";
import type { Deck } from "../deck";
import { settings } from "../settings";
import { FaderCuts } from "./cuts";

export type PadMode = "hotcue" | "beatjump" | "autoloop" | "roll" | "fadercuts" | "key" | "sampler" | "padfx";

export const PAD_MODE_LABEL: Record<PadMode, string> = {
  hotcue: "HOT CUE", beatjump: "BEAT JUMP", autoloop: "AUTO LOOP", roll: "ROLL",
  fadercuts: "FADER CUTS", key: "KEY SHIFT", sampler: "SAMPLER", padfx: "PAD FX",
};

const MODE_NOTES: { note: number; primary: PadMode; secondary: PadMode }[] = [
  { note: 0x00, primary: "hotcue", secondary: "beatjump" },
  { note: 0x0d, primary: "autoloop", secondary: "roll" },
  { note: 0x07, primary: "fadercuts", secondary: "key" },
  { note: 0x0b, primary: "sampler", secondary: "padfx" },
];

export const AUTOLOOP_BEATS = [0.25, 0.5, 1, 2, 4, 8, 16, 32];
export const ROLL_BEATS = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8];
export const JUMP_BEATS = [-1, -2, -4, -8, 1, 2, 4, 8];
export const KEY_PADS = [-3, -2, -1, 0, 1, 2, 3, 99];
export const PADFX = [
  { label: "ECHO ½", fx: "echo", beats: 2 }, { label: "ECHO ¾", fx: "echo", beats: 3 },
  { label: "REVERB", fx: "reverb", beats: 0 }, { label: "TRANS ¼", fx: "trans", beats: 1 },
  { label: "ROLL ¼", roll: 1 / 4 }, { label: "ROLL ⅛", roll: 1 / 8 },
  { label: "BRAKE", brake: true }, { label: "SPINBACK", spin: true },
] as const;

interface PadFxSaved { id: string; beatsIdx: number; on: boolean; level: number }

export type MidiSend = (data: number[]) => void;

function encodeNum(n: number, drop = 0, unsigned = false): number[] {
  const a = [28, 24, 20, 16, 12, 8, 4, 0].map((s) => (n >> s) & 0x0f);
  if (drop) a.splice(0, drop);
  if (n < 0) a[0] = 0x07;
  else if (!unsigned) a[0] = 0x08;
  return a;
}

export class PlatinumFX {
  padMode: PadMode[] = ["hotcue", "hotcue", "hotcue", "hotcue"];
  private shiftL = false;
  private shiftR = false;
  private pitchMsb = [0, 0, 0, 0];
  private pitchLsb = [0, 0, 0, 0];
  private pickup = new Set<string>();
  private out = new Map<string, number | string>();
  private blink = false;
  private padHeld: number[][] = [[], [], [], []];
  private padFxSaved: (PadFxSaved | null)[] = [null, null];
  private lastLoad = [0, 0, 0, 0];
  private taps: number[][] = [[], []];
  readonly cuts: FaderCuts;
  private timer = 0;
  private blinkTimer = 0;
  sysex: boolean;

  constructor(private app: App, private send: MidiSend, sysex: boolean) {
    this.sysex = sysex;
    this.cuts = new FaderCuts(app);
  }

  get shift(): boolean { return this.shiftL || this.shiftR; }

  start(): void {
    if (this.sysex) {
      this.send([0xf0, 0x7e, 0x00, 0x06, 0x01, 0xf7]); // salir del modo demo
      this.send([0xf0, 0x00, 0x20, 0x7f, 0x13, 0xf7]);
      this.send([0xf0, 0x00, 0x20, 0x7f, 0x03, 0x01, 0xf7]); // pide estado de controles
    }
    this.send([0x90, 0x08, 0x7f]);
    this.send([0x91, 0x08, 0x7f]);
    this.out.clear();
    this.timer = window.setInterval(() => this.feedback(), 40);
    this.blinkTimer = window.setInterval(() => { this.blink = !this.blink; }, 350);
  }

  stop(): void {
    clearInterval(this.timer);
    clearInterval(this.blinkTimer);
    for (let d = 0; d < 4; d++) {
      this.send([0xb0 | d, 0x3f, 0]);
      this.send([0xb0 | d, 0x06, 0]);
      this.send([0x80 | d, 0x0d, 0]);
      this.send([0x80 | d, 0x0a, 0]);
      this.send([0x80 | d, 0x09, 0]);
    }
    if (this.sysex) this.send([0xf0, 0x00, 0x20, 0x7f, 0x02, 0xf7]);
  }

  // ================================================================ ENTRADA
  onMessage(data: Uint8Array): void {
    if (data.length < 3) return;
    let status = data[0];
    const n = data[1];
    let v = data[2];
    const type = status & 0xf0;
    const ch = status & 0x0f;
    if (type === 0x80) { status = 0x90 | ch; v = 0; }
    const press = v > 0;
    if (type === 0x80 || type === 0x90) this.onNote(ch, n, v, press);
    else if (type === 0xb0) this.onCC(ch, n, v);
  }

  private deck(i: number): Deck { return this.app.decks[i]; }

  private onNote(ch: number, n: number, v: number, press: boolean): void {
    // ---- botones de deck (canal 0..3)
    if (ch <= 3) {
      const d = this.deck(ch);
      switch (n) {
        case 0x20: // SHIFT
          if (ch % 2 === 0) this.shiftL = press; else this.shiftR = press;
          this.app.shift = this.shift;
          this.app.emit();
          return;
        case 0x00: if (press) d.togglePlay(); return;
        case 0x04: if (press) d.stutter(); return;
        case 0x01: if (press) d.cueDown(); else d.cueUp(); return;
        case 0x05: if (press) d.toStart(); return;
        case 0x02: if (press) d.toggleSync(); return;
        case 0x03: if (press) this.app.setMaster(d); return;
        case 0x06: d.jogTouch(press, this.shift); return;
        case 0x07: // VINYL (scratch) · SHIFT = censor mientras se mantiene
          if (press && this.shift) d.censor(true);
          else if (!press) d.censor(false);
          else d.toggleVinyl();
          return;
        case 0x08: if (v === 0x7f) this.app.setSide(this.app.sideOf(ch), ch); return;
        case 0x0b: if (this.shift) { if (press) d.toggleKeylock(); } else d.bend(press ? 1 : 0); return;
        case 0x0c: if (this.shift) { if (press) d.cycleRange(); } else d.bend(press ? -1 : 0); return;
        case 0x2b: if (press) d.toggleKeylock(); return;
        case 0x2c: if (press) d.cycleRange(); return;
        case 0x1b:
          if (!press) return;
          if (this.shift) d.toggleSlip();
          else { const c = this.app.engine.channels[ch]; c.setPfl(!c.state.pfl); this.app.emit(); }
          return;
      }
      return;
    }
    // ---- pads / loops (canal 4..7)
    if (ch >= 4 && ch <= 7) {
      const di = ch - 4;
      const d = this.deck(di);
      if (n >= 0x14 && n <= 0x23) {
        const shifted = n >= 0x1c;
        const pad = (n - 0x14) % 8;
        this.onPad(d, pad, press, shifted || this.shift);
        return;
      }
      if (!press) return;
      const mode = MODE_NOTES.find((m) => m.note === n);
      if (mode) {
        const cur = this.padMode[di];
        this.setPadMode(di, cur === mode.primary ? mode.secondary : mode.primary);
        return;
      }
      switch (n) {
        case 0x02: this.setPadMode(di, "beatjump"); return; // shift + HOT CUE
        case 0x0f: this.setPadMode(di, "padfx"); return; // shift + SAMPLER
        case 0x0e: case 0x05: this.setPadMode(di, "roll"); return;
        case 0x34: if (this.shift) d.loopInBtn(); else d.loopHalve(); return;
        case 0x35: if (this.shift) d.loopOutBtn(); else d.loopDouble(); return;
        case 0x36: d.loopInBtn(); return;
        case 0x37: d.loopOutBtn(); return;
        case 0x40: if (this.shift) d.reloop(); else d.loopToggle(); return;
        case 0x41: d.reloop(); return;
      }
      return;
    }
    // ---- FX (canal 8 = unidad 1, canal 9 = unidad 2)
    if (ch === 8 || ch === 9) {
      const u = ch - 8;
      const unit = this.app.engine.fx[u];
      if (n === 0x09) { if (press) this.tap(u); return; }
      const slot = u === 0 ? n : n - 3;
      if (slot >= 0 && slot <= 2 && press) {
        const id = settings.fxSlots[slot];
        if (unit.def.id !== id) unit.select(id);
        this.app.emit();
      }
      return;
    }
    // ---- navegador / carga (canal 15)
    if (ch === 15) {
      if (!press) return;
      if (n >= 0x02 && n <= 0x05) {
        const di = n - 0x02;
        if (this.shift) { this.deck(di).eject(); return; }
        const now = performance.now();
        if (now - this.lastLoad[di] < 400) this.app.instantDouble(di);
        else this.app.ui?.loadSelected(di);
        this.lastLoad[di] = now;
        return;
      }
      if (n === 0x06) { this.app.ui?.browsePush(false); return; }
      if (n === 0x07) { this.app.ui?.browsePush(true); return; }
    }
  }

  private tap(u: number): void {
    const now = performance.now();
    const t = this.taps[u];
    if (t.length && now - t[t.length - 1] > 2000) t.length = 0;
    t.push(now);
    if (t.length > 6) t.shift();
    const unit = this.app.engine.fx[u];
    if (this.shift) { unit.tapBpm = 0; t.length = 0; this.app.toast(`FX ${u + 1}: BPM automático`); return; }
    if (t.length >= 3) {
      const avg = (t[t.length - 1] - t[0]) / (t.length - 1);
      unit.tapBpm = Math.round(60000 / avg * 10) / 10;
      this.app.emit();
    }
  }

  setPadMode(di: number, mode: PadMode): void {
    this.padMode[di] = mode;
    this.app.emit();
  }

  onPad(d: Deck, pad: number, press: boolean, shifted: boolean): void {
    const di = d.i;
    if (press) this.padHeld[di].push(pad);
    else this.padHeld[di] = this.padHeld[di].filter((p) => p !== pad);
    const mode = this.padMode[di];
    const side = this.app.sideOf(di);
    switch (mode) {
      case "hotcue":
        if (press) d.hotDown(pad, shifted); else d.hotUp(pad);
        break;
      case "beatjump":
        if (press) d.beatJump(JUMP_BEATS[pad] * (shifted ? 4 : 1));
        break;
      case "autoloop":
        if (press) d.autoLoop(AUTOLOOP_BEATS[pad]);
        break;
      case "roll":
        if (press) d.rollDown(ROLL_BEATS[pad]);
        else if (!this.padHeld[di].length) d.rollUp();
        break;
      case "fadercuts":
        if (press) this.cuts.start(di, pad); else this.cuts.stop(di, pad);
        break;
      case "key":
        if (!press) break;
        if (KEY_PADS[pad] === 99) d.keySync();
        else if (KEY_PADS[pad] === 0) d.setKey(0);
        else d.setKey(shifted ? d.keySemis + Math.sign(KEY_PADS[pad]) : KEY_PADS[pad]);
        break;
      case "sampler":
        if (!press) break;
        if (shifted) this.app.engine.sampler.stop(pad); else this.app.engine.sampler.play(pad);
        break;
      case "padfx": {
        const p = PADFX[pad];
        const unit = this.app.engine.fx[side];
        if ("roll" in p) { if (press) d.rollDown(p.roll); else d.rollUp(); break; }
        if ("brake" in p) { if (press) d.brake(1.2); break; }
        if ("spin" in p) { if (press) d.spinback(); break; }
        if (press) {
          if (!this.padFxSaved[side]) this.padFxSaved[side] = { id: unit.def.id, beatsIdx: unit.beatsIdx, on: unit.on, level: unit.level };
          unit.select(p.fx);
          if (p.beats) unit.beatsIdx = p.beats;
          unit.stepBeats(0);
          unit.setLevel(Math.max(0.55, unit.level));
          unit.setOn(true);
        } else {
          const s = this.padFxSaved[side];
          unit.setOn(false);
          if (s && !this.padHeld[di].length) {
            this.padFxSaved[side] = null;
            setTimeout(() => {
              if (unit.on) return;
              unit.select(s.id); unit.beatsIdx = s.beatsIdx; unit.stepBeats(0); unit.setLevel(s.level);
              if (s.on) unit.setOn(true);
            }, 1500); // deja sonar la cola del eco/reverb
          }
        }
        break;
      }
    }
    this.app.emit();
  }

  private pick(key: string, hw: number, sw: number): boolean {
    if (!this.pickup.has(key)) return true;
    if (Math.abs(hw - sw) < 0.04) { this.pickup.delete(key); return true; }
    return false;
  }

  /** Llamado al cambiar de capa: los controles absolutos deben recoger el valor. */
  requirePickup(di: number): void {
    for (const cc of [0x16, 0x17, 0x18, 0x19, 0x1a, 0x1c]) this.pickup.add(`${di}:${cc}`);
  }

  private onCC(ch: number, n: number, v: number): void {
    const x = v / 127;
    const eng = this.app.engine;
    if (ch <= 3) {
      const d = this.deck(ch);
      const c = eng.channels[ch];
      const rel = v >= 64 ? v - 128 : v;
      switch (n) {
        case 0x06: d.jogTurn(rel, this.shift); return;
        case 0x09: this.pitchMsb[ch] = v; this.applyPitch(d); return;
        case 0x29: this.pitchLsb[ch] = v; this.applyPitch(d); return;
        case 0x16: if (this.pick(`${ch}:${n}`, x, c.state.trim)) c.setTrim(x); break;
        case 0x17: if (this.pick(`${ch}:${n}`, x, c.state.high)) c.setEq("high", x); break;
        case 0x18: if (this.pick(`${ch}:${n}`, x, c.state.mid)) c.setEq("mid", x); break;
        case 0x19: if (this.pick(`${ch}:${n}`, x, c.state.low)) c.setEq("low", x); break;
        case 0x1a: if (this.pick(`${ch}:${n}`, x, c.state.filter)) c.setFilter(x); break;
        case 0x1c: if (this.pick(`${ch}:${n}`, x, c.state.fader)) c.setFader(x); break;
        case 0x08: eng.setCrossfader(x); break;
        default: return;
      }
      this.app.emit();
      return;
    }
    if (ch === 8 || ch === 9) {
      const u = ch - 8;
      if (n === 0x03) {
        // paddle: 0 centro, 1 arriba (enclavado), 2 abajo (momentáneo)
        eng.fx[u].setOn(v !== 0);
      } else if (n === 0x04) {
        for (const f of eng.fx) f.setLevel(x);
      } else if (n === 0x05) {
        const dir = v < 0x40 ? 1 : -1;
        const targets = eng.fx.filter((f) => f.on);
        for (const f of targets.length ? targets : eng.fx) f.stepBeats(dir);
      }
      this.app.emit();
      return;
    }
    if (ch === 14 && n === 0x23) { eng.setMasterGain(x); return; }
    if (ch === 15) {
      const rel = v >= 64 ? v - 128 : v;
      switch (n) {
        case 0x00: this.app.ui?.browse(rel, false); return;
        case 0x01: this.app.ui?.browse(rel, true); return;
        case 0x08: eng.setCrossfader(x); this.app.emit(); return;
        case 0x0c: eng.setCueGain(x); return;
        case 0x0d: eng.setCueMix(x); return;
      }
    }
  }

  private applyPitch(d: Deck): void {
    const v14 = (this.pitchMsb[d.i] << 7) | this.pitchLsb[d.i];
    const nrm = v14 / 16383;
    const f = settings.invertPitch ? nrm * 2 - 1 : 1 - nrm * 2;
    d.setFader(f, true);
    this.app.emit();
  }

  // ================================================================ SALIDA
  private set(key: string, msg: number[]): void {
    const val = msg.join(",");
    if (this.out.get(key) === val) return;
    this.out.set(key, val);
    this.send(msg);
  }

  private led(status: number, note: number, on: boolean | number): void {
    const v = typeof on === "number" ? on : on ? 0x7f : 0x01;
    this.set(`${status}:${note}`, [status, note, v]);
  }

  private sysexMsg(key: string, deckNum: number, type: number, nibbles: number[]): void {
    if (!this.sysex) return;
    this.set(key, [0xf0, 0x00, 0x20, 0x7f, deckNum, type, ...nibbles, 0xf7]);
  }

  private feedback(): void {
    const app = this.app;
    const eng = app.engine;
    const on = settings.padOnValue, off = settings.padOffValue;
    for (let di = 0; di < 4; di++) {
      const d = app.decks[di];
      const s = 0x90 + di;
      const ps = 0x94 + di;
      const atCue = d.cue !== null && Math.abs(d.now() - d.cue) < 0.02;
      // transporte (estilo CDJ: parpadeo en pausa)
      this.led(s, 0x00, d.loaded ? (d.playing ? true : this.blink) : false);
      this.led(s, 0x01, d.loaded ? (d.playing || atCue ? true : this.blink) : false);
      this.led(s, 0x02, d.sync || (d.isMaster && this.blink && app.decks.some((x) => x.sync)));
      this.led(s, 0x07, d.vinyl);
      this.led(s, 0x1b, eng.channels[di].state.pfl);
      this.led(s, 0x0d, d.keylock ? 0x7f : 0x00);
      this.led(s, 0x46, settings.timeRemaining ? 0x7f : 0x00);
      this.set(`range${di}`, [s, 0x0e, Math.min(127, d.range)]);
      // flechas de BPM respecto al deck activo del otro lado
      const other = app.decks[app.side[1 - app.sideOf(di)]];
      let up = 0, down = 0;
      if (d.bpm && other.bpm) {
        if (other.effBpm > d.effBpm + 0.05) down = 1;
        if (other.effBpm < d.effBpm - 0.05) up = 1;
      }
      this.set(`up${di}`, [0x80 | di, 0x09, up]);
      this.set(`dn${di}`, [0x80 | di, 0x0a, down]);
      // plato: anillo de posición + "spinner"
      if (d.loaded && d.duration > 0) {
        const p = d.now(true);
        this.set(`ring${di}`, [0xb0 | di, 0x3f, Math.max(0, Math.min(52, Math.round((p / d.duration) * 52)))]);
        const period = 60 / (100 / 3);
        this.set(`spin${di}`, [0xb0 | di, 0x06, 64 + (Math.round(((p % period) / period) * 52) % 52)]);
        this.sysexMsg(`time${di}`, di + 1, 0x04, encodeNum(Math.round(p * 10) * 100));
        this.sysexMsg(`dur${di}`, di + 1, 0x03, encodeNum(Math.max(1, Math.round(d.duration * 1000)) - 1));
        const bpm = encodeNum(Math.round(d.effBpm * 100)); bpm.shift(); bpm.shift();
        this.sysexMsg(`bpm${di}`, di + 1, 0x01, bpm);
        this.sysexMsg(`rate${di}`, di + 1, 0x02, encodeNum(Math.round((d.effTempo - 1) * 10000), 2));
      }
      // VU
      const lvl = eng.channels[di].level();
      const db = 20 * Math.log10(lvl + 1e-9);
      this.set(`vu${di}`, [0xb0 | di, 0x1f, Math.round(Math.max(0, Math.min(1, (db + 42) / 42)) * 90)]);
      // loop
      this.led(ps, 0x40, d.loopOn);
      this.led(ps, 0x41, d.loopOn);
      // botones de modo de pads
      const mode = this.padMode[di];
      for (const m of MODE_NOTES) {
        const isP = mode === m.primary, isS = mode === m.secondary;
        this.led(ps, m.note, isP ? true : isS ? this.blink : false);
      }
      // pads
      for (let p = 0; p < 8; p++) {
        const held = this.padHeld[di].includes(p);
        let lit = false;
        switch (mode) {
          case "hotcue": lit = !!d.track?.cues.hot[p]; break;
          case "beatjump": lit = held; break;
          case "autoloop": lit = d.loopOn && !!d.loop && Math.abs(d.loop.end - d.loop.start - AUTOLOOP_BEATS[p] * d.beatLen) < 1e-3; break;
          case "roll": case "fadercuts": case "padfx": lit = held; break;
          case "key": lit = KEY_PADS[p] === 99 ? held : d.keySemis === KEY_PADS[p]; break;
          case "sampler": lit = eng.sampler.isPlaying(p); break;
        }
        const v = lit ? on : off;
        this.set(`pad${di}:${p}`, [ps, 0x14 + p, v]);
        this.set(`pads${di}:${p}`, [ps, 0x1c + p, v]);
      }
    }
    // FX
    for (let u = 0; u < 2; u++) {
      const unit = eng.fx[u];
      for (let k = 0; k < 3; k++) {
        const isSel = unit.def.id === settings.fxSlots[k];
        this.led(0x98 + u, u * 3 + k, isSel ? (unit.on ? true : 0x40) : false);
      }
      this.led(0x98 + u, 0x09, unit.tapBpm > 0 ? this.blink : false);
    }
  }
}

