import type { App } from "../app";
import type { Deck } from "../deck";
import { settings } from "../settings";
import { formatKey, keyColor } from "../util/key";
import { h, setText, cls, css, fmtTime, holdButton } from "./dom";
import { DECK_COLORS, Overview, drawPlatter } from "./waveform";
import { PAD_MODE_LABEL, AUTOLOOP_BEATS, ROLL_BEATS, JUMP_BEATS, KEY_PADS, PADFX, type PadMode } from "../midi/platinumfx";
import { CUT_PATTERNS } from "../midi/cuts";

const MODES: PadMode[] = ["hotcue", "beatjump", "autoloop", "roll", "fadercuts", "key", "sampler", "padfx"];
const JUMP_SIZES = [1, 2, 4, 8, 16, 32];

function beatLabel(b: number): string {
  if (b >= 1) return String(b);
  return `1/${Math.round(1 / b)}`;
}

/** Panel de un lado (izq/der). Muestra el deck activo de esa capa (1/3 ó 2/4). */
export class DeckView {
  readonly el: HTMLElement;
  private platter: HTMLCanvasElement;
  private overview: Overview;
  private ovCanvas: HTMLCanvasElement;
  private els: Record<string, HTMLElement> = {};
  private padEls: HTMLButtonElement[] = [];
  private modeEls: HTMLButtonElement[] = [];
  private pitch: HTMLInputElement;
  private jumpSize = 2; // índice en JUMP_SIZES
  private boundDeck = -1;
  private uiMode: PadMode = "hotcue";

  constructor(private app: App, readonly side: 0 | 1) {
    const d = () => this.deck;
    const b = (label: string, cl: string, fn: () => void, title?: string) => {
      const e = h("button", { class: cl, title, onclick: () => fn() });
      e.textContent = label;
      return e;
    };
    const E = this.els;
    E.tabA = b(String(side + 1), "tab", () => app.setSide(side, side));
    E.tabB = b(String(side + 3), "tab", () => app.setSide(side, side + 2));
    E.title = h("div", { class: "title" });
    E.artist = h("div", { class: "artist" });
    E.key = h("div", { class: "keybadge", title: "Tonalidad (con key shift / pitch)" });
    E.bpm = h("div", { class: "bpm" });
    E.bpmSub = h("div", { class: "bpmsub" });
    E.master = b("MASTER", "btn small", () => app.setMaster(d()), "Tempo master (shift+SYNC)");
    E.sync = b("SYNC", "btn small sync", () => d().toggleSync(), "Beat sync");
    E.status = h("div", { class: "deckstatus" });

    this.platter = h("canvas", { class: "platter" });
    this.ovCanvas = h("canvas", { class: "overview" });
    this.overview = new Overview(this.ovCanvas, app.decks[side]);
    E.elapsed = h("span", { class: "t-el" });
    E.remain = h("span", { class: "t-rem" });
    E.beat = h("span", { class: "beatbar" });

    const cue = holdButton("CUE", "btn cue", () => d().cueDown(), () => d().cueUp(), "CUE (shift: inicio)");
    const play = b("▶❚❚", "btn play", () => d().togglePlay(), "PLAY/PAUSE");
    E.cue = cue; E.play = play;

    E.loopIn = b("IN", "btn small", () => d().loopInBtn(), "Loop in");
    E.loopOut = b("OUT", "btn small", () => d().loopOutBtn(), "Loop out");
    E.reloop = b("RELOOP", "btn small", () => d().reloop(), "Reloop / exit");
    const half = b("½", "btn small", () => d().loopHalve());
    E.loop4 = b("4 BEAT", "btn small", () => d().loopToggle(), "Loop de 4 beats");
    const dbl = b("×2", "btn small", () => d().loopDouble());
    E.jumpLabel = h("span", { class: "jumpsz", title: "Tamaño de beat jump (clic para cambiar)" });
    E.jumpLabel.addEventListener("click", () => { this.jumpSize = (this.jumpSize + 1) % JUMP_SIZES.length; });
    const jl = b("◀", "btn small", () => d().beatJump(-JUMP_SIZES[this.jumpSize]), "Beat jump atrás");
    const jr = b("▶", "btn small", () => d().beatJump(JUMP_SIZES[this.jumpSize]), "Beat jump adelante");

    E.keylock = b("MT", "btn small", () => d().toggleKeylock(), "Master Tempo / key lock");
    const kd = b("♭", "btn small", () => d().setKey(d().keySemis - 1), "Key −1");
    E.keyVal = h("span", { class: "keyval" });
    const ku = b("♯", "btn small", () => d().setKey(d().keySemis + 1), "Key +1");
    E.keysync = b("KEY SYNC", "btn small", () => d().keySync(), "Ajusta la tonalidad a la del master");
    E.slip = b("SLIP", "btn small", () => d().toggleSlip());
    E.quant = b("Q", "btn small", () => { settings.quantize = !settings.quantize; app.emit(); }, "Quantize");
    E.vinyl = b("VINYL", "btn small", () => d().toggleVinyl(), "Modo vinilo (scratch al tocar el plato)");
    E.rev = b("REV", "btn small", () => d().toggleReverse(), "Reverse");

    this.pitch = h("input", { type: "range", min: "-1", max: "1", step: "0.0005", class: "pitch", title: "Pitch (doble clic = reset)" });
    this.pitch.addEventListener("input", () => d().setFader(parseFloat(this.pitch.value)));
    this.pitch.addEventListener("dblclick", () => d().tempoReset());
    E.pitchPct = h("span", { class: "pitchpct" });
    E.range = b("±8", "btn small", () => d().cycleRange(), "Rango de pitch");

    const modeRow = h("div", { class: "modes" });
    MODES.forEach((m) => {
      const e = b(PAD_MODE_LABEL[m], "mode", () => {
        const ctrl = this.app.midi as any;
        if (ctrl?.setPadMode) ctrl.setPadMode(this.deck.i, m);
        this.uiMode = m;
        this.app.emit();
      });
      this.modeEls.push(e);
      modeRow.append(e);
    });
    const padRow = h("div", { class: "pads" });
    for (let p = 0; p < 8; p++) {
      const pad = holdButton("", "pad", (e) => this.padPress(p, true, e.shiftKey || app.shift), () => this.padPress(p, false, false));
      pad.addEventListener("contextmenu", (e) => { e.preventDefault(); if (this.mode === "hotcue") d().deleteHot(p); });
      this.padEls.push(pad);
      padRow.append(pad);
    }

    // memoria + grid (fila plegable)
    const mem = h("div", { class: "row extra" },
      b("MEMORY", "btn small", () => d().addMemory(), "Guarda memory cue"),
      b("◀ CALL", "btn small", () => d().callMemory(-1)),
      b("CALL ▶", "btn small", () => d().callMemory(1)),
      b("DEL", "btn small", () => d().deleteMemory(), "Borra el memory cue más cercano"),
      h("span", { class: "sep" }),
      h("span", { class: "lbl" }, "GRID"),
      b("/2", "btn small", () => d().gridScale(0.5)),
      b("×2", "btn small", () => d().gridScale(2)),
      b("−.01", "btn small", () => d().gridNudgeBpm(-0.01)),
      b("+.01", "btn small", () => d().gridNudgeBpm(0.01)),
      b("◀", "btn small", () => d().gridShift(-5), "Mover grid −5 ms"),
      b("▶", "btn small", () => d().gridShift(5), "Mover grid +5 ms"),
      b("1 AQUÍ", "btn small", () => d().gridDownbeatHere(), "Marca el beat actual como el 1 del compás"),
      b("⏏", "btn small", () => d().eject(), "Expulsar"),
    );

    this.el = h("section", { class: `deck side${side}` },
      h("header", { class: "deckhead" },
        h("div", { class: "tabs" }, E.tabA, E.tabB),
        h("div", { class: "meta" }, E.title, E.artist),
        E.key,
        h("div", { class: "bpmbox" }, E.bpm, E.bpmSub),
        h("div", { class: "syncbox" }, E.master, E.sync),
      ),
      h("div", { class: "deckmid" },
        this.platter,
        h("div", { class: "ovbox" }, this.ovCanvas, h("div", { class: "times" }, E.elapsed, E.beat, E.status, E.remain)),
        h("div", { class: "pitchbox" }, E.range, this.pitch, E.pitchPct),
      ),
      h("div", { class: "row" }, cue, play, h("span", { class: "sep" }), E.loopIn, E.loopOut, E.reloop, half, E.loop4, dbl, h("span", { class: "sep" }), jl, E.jumpLabel, jr),
      h("div", { class: "row" }, E.keylock, kd, E.keyVal, ku, E.keysync, h("span", { class: "sep" }), E.slip, E.quant, E.vinyl, E.rev),
      modeRow, padRow, mem,
    );

    // arrastrar pistas (o archivos) sobre el deck para cargar
    this.el.addEventListener("dragover", (e) => { e.preventDefault(); this.el.classList.add("drop"); });
    this.el.addEventListener("dragleave", () => this.el.classList.remove("drop"));
    this.el.addEventListener("drop", (e) => { e.preventDefault(); this.el.classList.remove("drop"); this.app.ui?.dropOnDeck?.(this.deck.i, e); });
  }

  get deck(): Deck { return this.app.decks[this.app.side[this.side]]; }

  get mode(): PadMode {
    const ctrl = this.app.midi as any;
    return ctrl?.padMode ? ctrl.padMode[this.deck.i] : this.uiMode;
  }

  private padPress(p: number, down: boolean, shift: boolean): void {
    const ctrl = this.app.midi as any;
    if (ctrl?.onPad) { ctrl.onPad(this.deck, p, down, shift); return; }
    // sin controladora: lógica mínima equivalente
    const d = this.deck;
    switch (this.mode) {
      case "hotcue": down ? d.hotDown(p, shift) : d.hotUp(p); break;
      case "beatjump": if (down) d.beatJump(JUMP_BEATS[p]); break;
      case "autoloop": if (down) d.autoLoop(AUTOLOOP_BEATS[p]); break;
      case "roll": down ? d.rollDown(ROLL_BEATS[p]) : d.rollUp(); break;
      case "key": if (down) KEY_PADS[p] === 99 ? d.keySync() : d.setKey(KEY_PADS[p]); break;
      case "sampler": if (down) (shift ? this.app.engine.sampler.stop(p) : this.app.engine.sampler.play(p)); break;
      default: break;
    }
  }

  private padLabel(p: number): { text: string; color: string; lit: boolean } {
    const d = this.deck;
    switch (this.mode) {
      case "hotcue": {
        const hc = d.track?.cues.hot[p];
        return { text: hc ? `${String.fromCharCode(65 + p)}${hc.loopEnd ? " ⟲" : ""} ${fmtTime(hc.pos, false)}` : String.fromCharCode(65 + p), color: hc?.color ?? "", lit: !!hc };
      }
      case "beatjump": return { text: `${JUMP_BEATS[p] > 0 ? "▶" : "◀"} ${Math.abs(JUMP_BEATS[p])}`, color: "#3a7bff", lit: false };
      case "autoloop": {
        const lit = d.loopOn && !!d.loop && Math.abs(d.loop.end - d.loop.start - AUTOLOOP_BEATS[p] * d.beatLen) < 1e-3;
        return { text: beatLabel(AUTOLOOP_BEATS[p]), color: "#30c94c", lit };
      }
      case "roll": return { text: beatLabel(ROLL_BEATS[p]), color: "#21b8c9", lit: false };
      case "fadercuts": return { text: CUT_PATTERNS[p].slice(0, 8).replace(/1/g, "▮").replace(/0/g, "▯"), color: "#fd9a00", lit: false };
      case "key": {
        const k = KEY_PADS[p];
        return { text: k === 99 ? "SYNC" : k === 0 ? "0" : `${k > 0 ? "+" : ""}${k}`, color: "#a35cff", lit: k !== 99 && d.keySemis === k };
      }
      case "sampler": {
        const s = this.app.engine.sampler.slots[p];
        return { text: s.name, color: s.color, lit: this.app.engine.sampler.isPlaying(p) };
      }
      case "padfx": return { text: PADFX[p].label, color: "#ff5fb0", lit: false };
    }
  }

  update(): void {
    const app = this.app;
    const d = this.deck;
    const E = this.els;
    if (this.boundDeck !== d.i) {
      this.boundDeck = d.i;
      (this.overview as any).deck = d;
      css(this.el, "--deck", DECK_COLORS[d.i]);
    }
    cls(E.tabA, "on", d.i === this.side);
    cls(E.tabB, "on", d.i === this.side + 2);
    cls(E.tabB, "hidden", !settings.fourDecks && !app.decks[this.side + 2].loaded);
    const t = d.track;
    setText(E.title, d.loading ? "Cargando…" : t ? t.title : d.error || "Arrastra una pista o pulsa LOAD");
    setText(E.artist, t ? t.artist : "");
    const ek = d.effKey();
    setText(E.key, ek >= 0 ? formatKey(ek, settings.keyNotation) : "—");
    css(E.key, "background", ek >= 0 ? keyColor(ek) : "#333");
    setText(E.bpm, d.bpm > 0 ? d.effBpm.toFixed(2) : t ? (d.analyzing ? "…" : "—") : "");
    setText(E.bpmSub, d.bpm > 0 ? `${d.bpm.toFixed(2)} orig` : "");
    cls(E.master, "on", d.isMaster);
    cls(E.sync, "on", d.sync);
    const now = d.now(true);
    setText(E.elapsed, fmtTime(now));
    setText(E.remain, `-${fmtTime(Math.max(0, d.duration - now))}`);
    cls(E.remain, "warn", d.playing && d.duration - now < 30);
    const bib = d.beatInBar(now);
    setText(E.beat, bib ? "●●●●".split("").map((c, i) => (i + 1 === bib ? "■" : "□")).join("") : "");
    const flags = [d.analyzing ? "analizando" : "", d.keylockActive ? "MT" : "", d.slipping ? "SLIP" : "", d.reversed ? "REV" : "", d.scratching ? "SCRATCH" : ""].filter(Boolean).join(" · ");
    setText(E.status, flags);
    cls(E.cue, "on", !!t && (d.playing || (d.cue !== null && Math.abs(d.now() - d.cue) < 0.02)));
    cls(E.cue, "blink", !!t && !d.playing && !(d.cue !== null && Math.abs(d.now() - d.cue) < 0.02));
    cls(E.play, "on", d.playing);
    cls(E.play, "blink", !!t && !d.playing);
    cls(E.loop4, "on", d.loopOn);
    cls(E.reloop, "on", d.loopOn);
    cls(E.loopIn, "on", d.loopIn !== null);
    setText(E.jumpLabel, String(JUMP_SIZES[this.jumpSize]));
    cls(E.keylock, "on", d.keylock);
    setText(E.keyVal, d.keySemis === 0 ? "0" : `${d.keySemis > 0 ? "+" : ""}${d.keySemis}`);
    cls(E.slip, "on", d.slip);
    cls(E.quant, "on", settings.quantize);
    cls(E.vinyl, "on", d.vinyl);
    cls(E.rev, "on", d.reverse);
    setText(E.range, d.range === 100 ? "WIDE" : `±${d.range}`);
    const pct = d.pitchPct;
    setText(E.pitchPct, `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`);
    cls(E.pitchPct, "pickup", d.pitchPickup && !!app.midi);
    if (document.activeElement !== this.pitch) {
      const v = String(d.sync && !d.isMaster ? Math.max(-1, Math.min(1, ((d.syncTempo - 1) * 100) / d.range)) : d.fader);
      if (this.pitch.value !== v) this.pitch.value = v;
    }
    // pads
    const mode = this.mode;
    this.modeEls.forEach((e, i) => cls(e, "on", MODES[i] === mode));
    this.padEls.forEach((e, p) => {
      const l = this.padLabel(p);
      setText(e, l.text);
      css(e, "--pad", l.color || "#2a2e36");
      cls(e, "set", !!l.color && (mode !== "hotcue" || l.lit));
      cls(e, "lit", l.lit);
    });
  }

  draw(): void {
    drawPlatter(this.platter, this.deck);
    this.overview.draw();
  }
}
