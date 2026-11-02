import type { App } from "../app";
import { KITS } from "../drums/kits";
import { PRESETS, CATEGORIES } from "../synth/presets";
import { SCALES, chordName, romanFor, NOTE_NAMES } from "../synth/theory";
import { FX_LIST } from "../audio/fx";
import { PERF_PADS } from "../audio/perf";
import { settings, setSetting } from "../settings";
import { h, setText, cls, css, Knob } from "./dom";

/** Disposición física del MPD218: el pad 1 abajo a la izquierda. */
export const PHYS = [12, 13, 14, 15, 8, 9, 10, 11, 4, 5, 6, 7, 0, 1, 2, 3];
const DRUM_COLOR = "#ff9f1c";

function btn(label: string, title: string, fn: () => void, extra = ""): HTMLButtonElement {
  const b = h("button", { class: `btn small ${extra}`, title, onclick: () => fn() });
  b.textContent = label;
  return b;
}

// ============================================================= batería
export class DrumsPanel {
  readonly el: HTMLElement;
  private pads: HTMLButtonElement[] = [];
  private kitSel: HTMLSelectElement;
  private knobs: Knob[] = [];
  private volKnob!: Knob;

  constructor(private app: App) {
    this.kitSel = h("select", { class: "sel", title: "Kit de batería" });
    KITS.forEach((k, i) => this.kitSel.append(h("option", { value: String(i) }, k.name)));
    this.kitSel.addEventListener("change", () => void app.setKit(Number(this.kitSel.value)));
    const grid = h("div", { class: "pads4" });
    for (let k = 0; k < 16; k++) {
      const i = PHYS[k];
      const p = h("button", { class: "pad", title: "Toca · arrastra un audio para usar tu sample · Alt+clic: quitar sample" });
      css(p, "--pc", DRUM_COLOR);
      p.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        if (e.altKey) { void app.drums.clearUserSample(i).then(() => app.emit()); return; }
        // la altura del clic dentro del pad hace de velocidad
        const r = p.getBoundingClientRect();
        const vel = Math.round(60 + 67 * (1 - (e.clientY - r.top) / r.height));
        app.drums.trigger(i, vel);
      });
      p.addEventListener("dragover", (e) => e.preventDefault());
      p.addEventListener("drop", async (e) => {
        e.preventDefault(); e.stopPropagation();
        const f = e.dataTransfer?.files?.[0];
        if (!f) return;
        try { await app.drums.loadUserSample(i, f); app.toast(`Pad ${i + 1}: ${f.name}`); } catch (err) { app.toast(`No se pudo cargar: ${(err as Error).message}`, "error"); }
        app.emit();
      });
      this.pads[i] = p;
      grid.append(p);
    }
    const d = app.drums;
    const mk = (label: string, def: number, fn: (v: number) => void, bip = false) => { const kn = new Knob(label, (v) => { fn(v); kn.set(v); }, def, bip); kn.set(def); this.knobs.push(kn); return kn.el; };
    this.el = h("section", { class: "panel drums" },
      h("div", { class: "phead" }, h("b", {}, "BATERÍA"), this.kitSel),
      grid,
      h("div", { class: "knobrow" },
        (this.volKnob = new Knob("VOL", (v) => app.setMix("drums", v), 0.8, false)).el,
        mk("FILTRO", 0.5, (v) => d.setFilter(v), true),
        mk("DRIVE", 0, (v) => d.setDrive(v)),
        mk("KICK DEC", d.params.kickDecay, (v) => { d.params.kickDecay = v; }),
        mk("KICK TUNE", 0.5, (v) => { d.params.kickTune = v; }, true),
        mk("HAT DEC", d.params.hatDecay, (v) => { d.params.hatDecay = v; }),
      ),
    );
  }

  update(): void {
    this.volKnob.set(this.app.mix.drums);
    if (this.kitSel.value !== String(this.app.drums.kitIdx)) this.kitSel.value = String(this.app.drums.kitIdx);
  }

  draw(): void {
    const now = performance.now();
    const d = this.app.drums;
    for (let i = 0; i < 16; i++) {
      setText(this.pads[i], d.voiceName(i) + (d.userNames[i] ? " ●" : ""));
      cls(this.pads[i], "lit", now - d.hitAt[i] < 90);
    }
  }
}

// ============================================================= sinte
const KEYMAP = "awsedftgyhujkolp;'"; // teclado del ordenador -> semitonos desde Do
export { KEYMAP };

export class SynthPanel {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private catEls: HTMLButtonElement[] = [];
  private name: HTMLElement;
  private info: HTMLElement;
  private keys: HTMLElement[] = [];
  private octEl: HTMLElement;
  private knobs: Knob[] = [];
  private filter = "";
  private search: HTMLInputElement;
  private lastPreset = "";
  private volKnob!: Knob;

  constructor(private app: App) {
    const cats = h("div", { class: "cats" });
    for (const c of ["Todos", ...CATEGORIES]) {
      const b = btn(c, `Categoría ${c}`, () => { this.filter = c === "Todos" ? "" : c; this.renderList(); }, "cat");
      b.dataset.cat = c === "Todos" ? "" : c;
      this.catEls.push(b);
      cats.append(b);
    }
    this.search = h("input", { type: "search", placeholder: `Buscar entre ${PRESETS.length} presets…`, class: "search" }) as HTMLInputElement;
    this.search.addEventListener("input", () => this.renderList());
    this.search.addEventListener("keydown", (e) => e.stopPropagation());
    this.list = h("div", { class: "plist" });
    this.name = h("div", { class: "pname" });
    this.info = h("div", { class: "pinfo" });
    this.octEl = h("span", { class: "oct" });
    const s = app.synth;
    const mk = (label: string, def: number, fn: (v: number) => void, bip = false) => { const kn = new Knob(label, (v) => { fn(v); kn.set(v); }, def, bip); kn.set(def); this.knobs.push(kn); return kn.el; };
    // macros: multiplican/suman sobre el preset (0.5 = como viene)
    this.volKnob = new Knob("VOL", (v) => app.setMix("synth", v), 0.75, false);
    const macros = h("div", { class: "knobrow" },
      this.volKnob.el,
      mk("CUTOFF", 0.5, (v) => { s.macro.cutoff = Math.pow(2, (v - 0.5) * 6); }, true),
      mk("RESO", 0.5, (v) => { s.macro.res = (v - 0.5) * 16; }, true),
      mk("ATTACK", 0.5, (v) => { s.macro.attack = Math.pow(2, (v - 0.5) * 8); }, true),
      mk("RELEASE", 0.5, (v) => { s.macro.release = Math.pow(2, (v - 0.5) * 6); }, true),
      mk("LFO", 0.5, (v) => { s.macro.lfo = v * 2; }, true),
    );
    // teclado en pantalla: 2 octavas
    const kb = h("div", { class: "kbd" });
    for (let k = 0; k < 25; k++) {
      const black = [1, 3, 6, 8, 10].includes(k % 12);
      const key = h("div", { class: `key ${black ? "black" : "white"}` });
      const lab = KEYMAP[k] ? KEYMAP[k].toUpperCase() : "";
      key.append(h("span", {}, lab));
      key.addEventListener("pointerdown", (e) => { e.preventDefault(); key.setPointerCapture(e.pointerId); this.app.synth.noteOn(this.baseMidi() + k, 105); });
      const up = () => this.app.synth.noteOff(this.baseMidi() + k);
      key.addEventListener("pointerup", up);
      key.addEventListener("pointercancel", up);
      this.keys.push(key);
      kb.append(key);
    }
    this.el = h("section", { class: "panel synth" },
      h("div", { class: "phead" }, h("b", {}, "SINTE"), this.name, this.info,
        btn("◀", "Preset anterior", () => app.stepPreset(-1)), btn("▶", "Preset siguiente", () => app.stepPreset(1)),
        btn("−", "Octava abajo (Z)", () => this.octave(-1)), this.octEl, btn("+", "Octava arriba (X)", () => this.octave(1))),
      h("div", { class: "synthbody" }, h("div", { class: "pcol" }, cats, this.search, this.list), h("div", { class: "scol" }, macros, kb)),
    );
    this.renderList();
  }

  baseMidi(): number { return 12 * (settings.octave + 1); }

  octave(d: number): void {
    setSetting("octave", Math.max(1, Math.min(7, settings.octave + d)));
    this.app.emit();
  }

  private renderList(): void {
    const q = this.search.value.trim().toLowerCase();
    this.list.innerHTML = "";
    let lastCat = "";
    for (const p of PRESETS) {
      if (this.filter && p.cat !== this.filter) continue;
      if (q && !`${p.name} ${p.cat}`.toLowerCase().includes(q)) continue;
      if (p.cat !== lastCat && !this.filter) { this.list.append(h("div", { class: "pcat" }, p.cat)); lastCat = p.cat; }
      const tags = [p.mono ? "mono" : "", p.arp ? "arp" : "", p.fm ? "FM" : ""].filter(Boolean).join(" · ");
      const e = h("div", { class: "pitem", onclick: () => this.app.setPreset(p) }, h("span", {}, p.name), h("small", {}, tags));
      e.dataset.name = p.name;
      this.list.append(e);
    }
    this.catEls.forEach((b) => cls(b, "on", (b.dataset.cat ?? "") === this.filter));
    this.lastPreset = "";
  }

  update(): void {
    this.volKnob.set(this.app.mix.synth);
    const p = this.app.preset;
    setText(this.name, p.name);
    setText(this.info, `${p.cat}${p.arp ? ` · ARP ${p.arp}` : ""}${p.mono ? " · mono" : ""}`);
    setText(this.octEl, `Oct ${settings.octave}`);
    if (this.lastPreset !== p.name) {
      this.lastPreset = p.name;
      for (const el of this.list.children) {
        const on = (el as HTMLElement).dataset.name === p.name;
        cls(el, "on", on);
        if (on) (el as HTMLElement).scrollIntoView({ block: "nearest" });
      }
    }
    // teclas de la escala marcadas
    const st = (SCALES[settings.scale] ?? SCALES.minor).steps;
    this.keys.forEach((k, i) => cls(k, "inscale", st.includes((((i + 12 * (settings.octave + 1)) - settings.root) % 12 + 12) % 12)));
  }

  draw(): void {
    const base = this.baseMidi();
    const s = this.app.synth.sounding;
    this.keys.forEach((k, i) => cls(k, "down", s.has(base + i)));
  }
}

// ============================================================= acordes + FX de entrada/pistas
export class ChordsPanel {
  readonly el: HTMLElement;
  private pads: HTMLButtonElement[] = [];
  private fxEls: { sel: HTMLSelectElement; on: HTMLButtonElement; beats: HTMLElement; level: Knob }[] = [];
  private sizeBtn: HTMLButtonElement;

  constructor(private app: App) {
    const grid = h("div", { class: "chords" });
    for (let d = 0; d < 8; d++) {
      const p = h("button", { class: "pad chord" });
      p.addEventListener("pointerdown", (e) => { e.preventDefault(); p.setPointerCapture(e.pointerId); app.chordOn(100 + d, d); });
      const up = () => app.chordOff(100 + d);
      p.addEventListener("pointerup", up);
      p.addEventListener("pointercancel", up);
      this.pads.push(p);
      grid.append(p);
    }
    this.sizeBtn = btn("7ª", "Tríadas o cuatriadas (acordes con 7ª)", () => { setSetting("chordSize", settings.chordSize === 4 ? 3 : 4); app.emit(); });
    const fxBox = h("div", { class: "fxunits" });
    ["ENTRADA · se graba", "LOOPS · todas las pistas"].forEach((title, u) => {
      const unit = () => app.fx[u];
      const sel = h("select", { class: "sel" });
      for (const f of FX_LIST) sel.append(h("option", { value: f.id }, f.name));
      sel.addEventListener("change", () => { unit().select(sel.value); app.emit(); });
      const on = btn("ON", "Activar efecto", () => { unit().setOn(!unit().on); app.emit(); });
      const beats = h("span", { class: "fxbeats" });
      const level = new Knob("NIVEL", (v) => { unit().setLevel(v); level.set(v); app.emit(); }, 0.6, false);
      level.set(0.6);
      fxBox.append(h("div", { class: "fxunit" },
        h("div", { class: "fxhead" }, h("b", {}, `FX${u + 1}`), h("small", {}, title)),
        h("div", { class: "fxrow" }, sel, on, btn("◀", "Beats −", () => { unit().stepBeats(-1); app.emit(); }), beats, btn("▶", "Beats +", () => { unit().stepBeats(1); app.emit(); }), level.el)));
      this.fxEls.push({ sel, on, beats, level });
    });
    this.el = h("section", { class: "panel chordp" },
      h("div", { class: "phead" }, h("b", {}, "ACORDES"), h("small", { class: "dim" }, "en la tonalidad"), this.sizeBtn),
      grid, fxBox);
  }

  update(): void {
    for (let d = 0; d < 8; d++) {
      const notes = this.app.chordNotes(d);
      this.pads[d].innerHTML = "";
      this.pads[d].append(h("b", {}, d === 7 ? "I↑" : romanFor(d, notes)), h("span", {}, chordName(notes)));
      cls(this.pads[d], "lit", this.app.heldChords.has(100 + d));
    }
    setText(this.sizeBtn, settings.chordSize === 4 ? "7ª" : "triada");
    this.app.fx.forEach((u, i) => {
      const e = this.fxEls[i];
      if (e.sel.value !== u.def.id) e.sel.value = u.def.id;
      cls(e.on, "on", u.on);
      setText(e.beats, u.beatsLabel);
      e.level.set(u.level);
    });
  }
}

// ============================================================= FX de directo + micro
export class PerfPanel {
  readonly el: HTMLElement;
  private pads: HTMLButtonElement[] = [];
  private micBtn: HTMLButtonElement;
  private micRec: HTMLButtonElement;
  private micMon: HTMLButtonElement;
  private micVu: HTMLElement;
  private mixKnobs: [keyof App["mix"], Knob][] = [];

  constructor(private app: App) {
    const grid = h("div", { class: "pads4 perf" });
    for (let k = 0; k < 16; k++) {
      const i = PHYS[k];
      const p = h("button", { class: "pad", title: "Mantén pulsado" });
      p.textContent = PERF_PADS[i].label;
      p.addEventListener("pointerdown", (e) => { e.preventDefault(); p.setPointerCapture(e.pointerId); app.perf.press(i, 110); });
      const up = () => app.perf.release(i);
      p.addEventListener("pointerup", up);
      p.addEventListener("pointercancel", up);
      this.pads[i] = p;
      grid.append(p);
    }
    this.micBtn = btn("🎤 MICRO", "Activar el micrófono / entrada de línea", async () => {
      try { await app.enableMic(!app.micStream); } catch (e) { app.toast(`Micro: ${(e as Error).message}`, "error"); }
    });
    this.micRec = btn("GRABAR", "El micro también se graba en los loops (voz, beatbox, guitarra…)", () => { setSetting("micRec", !settings.micRec); app.applyMic(); app.emit(); });
    this.micMon = btn("ESCUCHAR", "Oír el micro por los altavoces (cuidado con el acople: usa auriculares)", () => { setSetting("micMonitor", !settings.micMonitor); app.applyMic(); app.emit(); });
    this.micVu = h("div", { class: "vu h" }, h("div", { class: "vufill" }));
    this.el = h("section", { class: "panel perfp" },
      h("div", { class: "phead" }, h("b", {}, "FX DE DIRECTO"), h("small", { class: "dim" }, "mantén pulsado")),
      grid,
      h("div", { class: "mic" }, this.micBtn, this.micRec, this.micMon, this.micVu),
      h("div", { class: "knobrow mixrow" }, ...(["master", "instr", "loops"] as const).map((k) => {
        const kn = new Knob(k === "master" ? "MASTER" : k === "instr" ? "INSTRUM." : "LOOPS", (v) => app.setMix(k, v), 0.75, false);
        this.mixKnobs.push([k, kn]);
        return kn.el;
      })));
  }

  update(): void {
    for (const [k, kn] of this.mixKnobs) kn.set(this.app.mix[k]);
    cls(this.micBtn, "on", !!this.app.micStream);
    cls(this.micRec, "on", settings.micRec);
    cls(this.micMon, "on", settings.micMonitor);
    this.micRec.disabled = this.micMon.disabled = !this.app.micStream;
  }

  draw(): void {
    for (let i = 0; i < 16; i++) cls(this.pads[i], "lit", this.app.perf.active.has(i));
    if (this.app.micStream) {
      const db = 20 * Math.log10(this.app.level("mic") + 1e-9);
      css(this.micVu.firstChild as HTMLElement, "width", `${Math.max(0, Math.min(100, ((db + 48) / 48) * 100))}%`);
    }
  }
}

export function keyName(root: number, scale: string): string {
  return `${NOTE_NAMES[root]} ${SCALES[scale]?.name ?? scale}`;
}
