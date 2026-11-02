import type { App } from "../app";
import type { MidiManager } from "../midi/midi";
import { settings, setSetting } from "../settings";
import { KITS } from "../live/kits";
import { KNOBS, type Bank } from "../live/live";
import { BASS_TRACK, DRUM_TRACKS } from "../live/sequencer";
import { formatKey, keyColor } from "../util/key";
import { h, setText, cls, css, fitCanvas, Knob } from "./dom";

const BANK_NAMES = ["A · BATERÍA", "B · FX DIRECTO", "C · BAJO 808"];
const BANK_COLORS = ["#ff8a1f", "#ff5fb0", "#21b8c9"];
/** Orden físico del MPD218: el pad 1 está abajo a la izquierda. */
const PHYS = [12, 13, 14, 15, 8, 9, 10, 11, 4, 5, 6, 7, 0, 1, 2, 3];

export class LiveView {
  readonly el: HTMLElement;
  private padEls: HTMLButtonElement[] = [];
  private bankEls: HTMLButtonElement[] = [];
  private grid: HTMLCanvasElement;
  private knobs: Knob[] = [];
  private knobEls: HTMLElement[] = [];
  private els: Record<string, HTMLElement> = {};
  private slotEls: HTMLButtonElement[] = [];
  private viewBank: Bank = 0;
  private lastBassPad = 0;
  private showAll = false;
  /** pistas visibles en la rejilla (compacta: solo las que tienen notas + la última tocada) */
  private rows: number[] = [];
  private lastTrack = 0;

  constructor(private app: App, private midi: MidiManager) {
    const rig = () => app.live;
    const btn = (label: string, title: string, fn: () => void, extra = "") => {
      const b = h("button", { class: `btn small ${extra}`, title, onclick: () => fn() });
      b.textContent = label;
      return b;
    };
    const E = this.els;

    // ---------------- pads
    const banks = h("div", { class: "lbanks" });
    BANK_NAMES.forEach((n, i) => {
      const b = btn(n, "Banco de pads (en el MPD218: PAD BANK)", () => { this.viewBank = i as Bank; rig().bank = i as Bank; app.emit(); }, "bank");
      css(b, "--deck", BANK_COLORS[i]);
      this.bankEls.push(b);
      banks.append(b);
    });
    const padGrid = h("div", { class: "lpads" });
    for (let k = 0; k < 16; k++) {
      const i = PHYS[k];
      const p = h("button", { class: "lpad", title: "Clic: tocar · clic derecho: aprender nota MIDI · arrastra un audio para cargarlo (banco A) · Alt+clic: quitar sample" });
      p.addEventListener("pointerdown", (e) => {
        p.setPointerCapture(e.pointerId);
        const g = this.viewBank * 16 + i;
        if (e.altKey && this.viewBank === 0) { void rig().drums.clearUserSample(i).then(() => app.emit()); return; }
        if (this.viewBank === 2) { this.lastBassPad = i; this.lastTrack = BASS_TRACK; }
        if (this.viewBank === 0) this.lastTrack = i;
        rig().padDown(g, 110);
      });
      const up = () => rig().padUp(this.viewBank * 16 + i);
      p.addEventListener("pointerup", up);
      p.addEventListener("pointercancel", up);
      p.addEventListener("contextmenu", (e) => { e.preventDefault(); rig().startLearn("pad", this.viewBank * 16 + i); app.toast(`Pulsa en el MPD218 el pad para ${rig().padName(this.viewBank * 16 + i)}`); });
      p.addEventListener("dragover", (e) => { if (this.viewBank === 0) e.preventDefault(); });
      p.addEventListener("drop", async (e) => {
        e.preventDefault(); e.stopPropagation();
        const f = e.dataTransfer?.files?.[0];
        if (f && this.viewBank === 0) {
          try { await rig().drums.loadUserSample(i, f); app.toast(`Pad A${i + 1}: ${f.name}`); } catch (err) { app.toast(`No se pudo cargar: ${(err as Error).message}`, "error"); }
          app.emit();
        }
      });
      this.padEls[i] = p;
      padGrid.append(p);
    }
    const kitSel = h("select", { class: "fxsel", title: "Kit de batería (knob B6 también lo cambia)" });
    KITS.forEach((k, i) => kitSel.append(h("option", { value: String(i) }, k.name)));
    kitSel.addEventListener("change", () => { rig().drums.kitIdx = Number(kitSel.value); app.emit(); });
    this.kitSel = kitSel;
    E.erase = btn("ERASE", "Mantén activo y toca un pad: borra esa pista del patrón", () => { rig().erase = !rig().erase; app.emit(); });
    E.lq = btn("Q", "Cuantizar lo que tocas en directo a la semicorchea", () => { rig().liveQuantize = !rig().liveQuantize; app.emit(); });
    E.dcue = btn("CUE", "Batería y bajo también por auriculares (para preparar sin que suene... baja VOL BATERÍA)", () => { rig().drums.setCue(!rig().drums.cueOn); app.emit(); });
    E.key = h("span", { class: "keybadge small", title: "Tonalidad del bajo 808 = la del master" });
    const padCol = h("div", { class: "lcol padcol" }, banks, padGrid, h("div", { class: "row" }, kitSel, E.erase, E.lq, E.dcue, E.key));

    // ---------------- secuenciador
    E.play = btn("▶ PLAY", "Arranca/para el secuenciador (sigue al deck MASTER)", () => { const s = rig().seq; if (s.playing) s.stop(); else s.start(); app.emit(); });
    E.rec = btn("● REC", "Grabar lo que tocas (overdub, cuantizado)", () => { rig().seq.toggleRec(); app.emit(); }, "rec");
    const undo = btn("↶", "Deshacer la última grabación/borrado", () => { if (rig().seq.undoLast()) { rig().savePatterns(); app.emit(); } });
    const clear = btn("CLEAR", "Vaciar el patrón", () => { rig().seq.clear(); rig().savePatterns(); app.emit(); });
    E.all = btn("TODAS", "Mostrar las 17 pistas (o solo las que tienen notas)", () => { this.showAll = !this.showAll; app.emit(); });
    const lens = [16, 32, 64].map((n) => {
      const b = btn(`${n / 16}C`, `${n / 16} compás(es)`, () => rig().setLength(n as 16 | 32 | 64));
      b.dataset.len = String(n);
      return b;
    });
    this.lenEls = lens;
    E.clock = h("span", { class: "lclock" });
    const bpmDn = btn("−", "Tempo libre −1 (cuando no hay master sonando)", () => rig().clock.setInternalBpm(Math.round(rig().clock.internalBpm) - 1));
    const bpmUp = btn("+", "Tempo libre +1", () => rig().clock.setInternalBpm(Math.round(rig().clock.internalBpm) + 1));
    const slots = h("div", { class: "slots" });
    for (let i = 0; i < 8; i++) {
      const b = btn(`P${i + 1}`, "Patrón guardado (se guarda solo)", () => rig().selectSlot(i));
      this.slotEls.push(b);
      slots.append(b);
    }
    this.grid = h("canvas", { class: "seqgrid", title: "Clic: poner/quitar paso · clic en el nombre: mute · fila 808: usa la última nota tocada en el banco C" });
    this.grid.addEventListener("pointerdown", (e) => this.gridClick(e));
    const seqCol = h("div", { class: "lcol seqcol" },
      h("div", { class: "row" }, E.play, E.rec, undo, clear, ...lens, E.all, slots),
      this.grid,
      h("div", { class: "row" }, E.clock, bpmDn, bpmUp),
    );

    // ---------------- knobs
    const knobGrid = h("div", { class: "lknobs" });
    KNOBS.forEach((row, b) => {
      knobGrid.append(h("span", { class: "kbank", style: `color:${BANK_COLORS[b]}` }, "ABC"[b]));
      row.forEach((kd, k) => {
        const idx = b * 6 + k;
        const kn = new Knob(kd.label, (v) => rig().setKnob(idx, v), kd.def, kd.def === 0.5);
        kn.el.addEventListener("contextmenu", (e) => { e.preventDefault(); rig().startLearn("knob", idx); app.toast(`Gira en el MPD218 el knob para ${kd.label}`); });
        kn.el.title = `${kd.label} — clic derecho: aprender CC`;
        this.knobs.push(kn);
        this.knobEls.push(kn.el);
        knobGrid.append(kn.el);
      });
    });
    E.mpd = h("div", { class: "mpdstat" });
    const clockChk = h("input", { type: "checkbox" }) as HTMLInputElement;
    clockChk.checked = settings.mpdClock;
    clockChk.addEventListener("change", () => { setSetting("mpdClock", clockChk.checked); midi.disconnectPads(); midi.connectPads(); });
    const reset = btn("Mapeo por defecto", "Vuelve al mapeo de fábrica (Program 1: notas 36-83)", () => rig().resetMap());
    const knobCol = h("div", { class: "lcol knobcol" }, knobGrid, E.mpd,
      h("label", { class: "chk", title: "Envía MIDI clock al MPD218: activa en el MPD218 NR CONFIG + pad 15 (Ext Clock) y su Note Repeat irá al tempo de la mezcla" }, clockChk, " MIDI clock → Note Repeat"),
      h("div", { class: "row" }, reset));

    this.el = h("section", { class: "live" }, padCol, seqCol, knobCol);
  }
  private kitSel: HTMLSelectElement;
  private lenEls: HTMLButtonElement[];

  private gridClick(e: PointerEvent): void {
    const rig = this.app.live;
    const r = this.grid.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const rows = this.rows.length;
    const rowH = r.height / rows;
    const labelW = 46;
    const ri = Math.floor(y / rowH);
    if (ri < 0 || ri >= rows) return;
    const row = this.rows[ri];
    if (x < labelW) { rig.seq.pat.mute[row] = !rig.seq.pat.mute[row]; rig.savePatterns(); this.app.emit(); return; }
    const len = rig.seq.pat.len;
    const step = Math.floor(((x - labelW) / (r.width - labelW)) * len);
    if (step < 0 || step >= len) return;
    rig.toggleStep(row, step, this.lastBassPad);
    if (row < DRUM_TRACKS && rig.seq.pat.vel[row][step]) rig.drums.trigger(row, 100);
  }

  update(): void {
    const rig = this.app.live;
    if (!rig) return;
    if (rig.bank !== this.viewBank) this.viewBank = rig.bank;
    this.bankEls.forEach((b, i) => cls(b, "on", i === this.viewBank));
    css(this.el, "--bank", BANK_COLORS[this.viewBank]);
    const E = this.els;
    cls(E.erase, "on", rig.erase);
    cls(E.lq, "on", rig.liveQuantize);
    cls(E.dcue, "on", rig.drums.cueOn);
    cls(E.all, "on", this.showAll);
    const k = rig.refKey();
    setText(E.key, `${formatKey(k, settings.keyNotation)}`);
    css(E.key, "background", keyColor(k));
    cls(E.play, "on", rig.seq.playing);
    cls(E.rec, "on", rig.seq.rec);
    this.lenEls.forEach((b) => cls(b, "on", Number(b.dataset.len) === rig.seq.pat.len));
    this.slotEls.forEach((b, i) => { cls(b, "on", i === rig.slot); cls(b, "has", !!rig.slots[i] || i === rig.slot); });
    if (this.kitSel.value !== String(rig.drums.kitIdx)) this.kitSel.value = String(rig.drums.kitIdx);
    const m = this.app.decks[this.app.master];
    setText(E.clock, rig.clock.locked && m ? `♩ ${rig.clock.bpm.toFixed(2)} BPM · sigue al deck ${m.i + 1} (compás del tema)` : `♩ ${rig.clock.internalBpm.toFixed(1)} BPM · reloj libre`);
    setText(E.mpd, `🥁 ${this.midi.padStatus}${rig.learn ? ` · APRENDIENDO ${rig.learn.kind === "pad" ? "pad " + rig.padName(rig.learn.idx) : "knob"}…` : ""}`);
    cls(E.mpd, "ok", !!this.midi.padIn);
    rig.knobVals.forEach((v, i) => this.knobs[i].set(v));
    this.knobEls.forEach((e, i) => cls(e, "learning", rig.learn?.kind === "knob" && rig.learn.idx === i));
  }

  /** Por frame: pads iluminados y la rejilla. */
  draw(): void {
    const rig = this.app.live;
    if (!rig) return;
    const now = performance.now();
    for (let i = 0; i < 16; i++) {
      const p = this.padEls[i];
      const g = this.viewBank * 16 + i;
      setText(p, rig.padLabel(g) + (this.viewBank === 0 && rig.drums.userNames[i] ? " ●" : ""));
      const flash = this.viewBank === 0 ? now - rig.drums.hitAt[i] < 90 : this.viewBank === 2 ? false : rig.perf.active.has(i);
      cls(p, "lit", rig.held.has(g) || flash);
      cls(p, "learning", rig.learn?.kind === "pad" && rig.learn.idx === g);
    }
    this.drawGrid();
  }

  private drawGrid(): void {
    const rig = this.app.live;
    const c = this.grid;
    const { w, h: hh, dpr } = fitCanvas(c);
    const g = c.getContext("2d")!;
    g.fillStyle = "#0e0f12";
    g.fillRect(0, 0, w, hh);
    const pat = rig.seq.pat;
    // pista "en foco": la última tocada en el MPD218/pantalla
    for (const g of rig.held) { const b = Math.floor(g / 16); if (b === 0) this.lastTrack = g % 16; else if (b === 2) this.lastTrack = BASS_TRACK; }
    const vis: number[] = [];
    for (let r = 0; r <= DRUM_TRACKS; r++) {
      if (this.showAll || r === this.lastTrack || pat.vel[r].some((v, i) => v && i < pat.len) || pat.mute[r]) vis.push(r);
    }
    if (!vis.includes(BASS_TRACK) && vis.length < 4) vis.push(BASS_TRACK);
    for (let r = 0; vis.length < 4 && r < DRUM_TRACKS; r++) if (!vis.includes(r)) vis.push(r);
    vis.sort((a, b) => a - b);
    this.rows = vis;
    const rows = vis.length;
    const rowH = hh / rows;
    const labelW = 46 * dpr;
    const len = pat.len;
    const cw = (w - labelW) / len;
    g.font = `${Math.max(7, Math.min(11, rowH / dpr - 3)) * dpr}px system-ui`;
    g.textBaseline = "middle";
    const cur = rig.seq.playing ? rig.seq.currentStep : -1;
    for (let ri = 0; ri < rows; ri++) {
      const r = vis[ri];
      const y = ri * rowH;
      const isBass = r === BASS_TRACK;
      g.fillStyle = pat.mute[r] ? "#5a2a2a" : "#1a1d22";
      g.fillRect(0, y + 1, labelW - 2, rowH - 2);
      g.fillStyle = pat.mute[r] ? "#ff7777" : isBass ? BANK_COLORS[2] : "#aab";
      g.fillText(isBass ? "808 ♪" : rig.drums.voiceName(r), 4 * dpr, y + rowH / 2);
      for (let s = 0; s < len; s++) {
        const x = labelW + s * cw;
        const v = pat.vel[r][s];
        const beat = Math.floor(s / 4) % 2 === 0;
        if (v) {
          const a = 0.35 + 0.65 * (v / 127);
          g.fillStyle = isBass ? `rgba(33,184,201,${a})` : `rgba(255,138,31,${a})`;
        } else g.fillStyle = beat ? "#22262d" : "#1a1d22";
        g.fillRect(x + 1, y + 1, Math.max(1, cw - 2), rowH - 2);
        if (isBass && v && cw > 14 * dpr) {
          g.fillStyle = "#001";
          g.fillText(rig.bassLabel(pat.bass[s]).replace(/\d$/, ""), x + 2 * dpr, y + rowH / 2);
        }
      }
    }
    // compases
    g.fillStyle = "rgba(255,255,255,0.25)";
    for (let s = 16; s < len; s += 16) g.fillRect(labelW + s * cw - 1, 0, 2, hh);
    if (cur >= 0) {
      g.fillStyle = rig.seq.rec ? "rgba(255,59,59,0.35)" : "rgba(255,255,255,0.18)";
      g.fillRect(labelW + cur * cw, 0, cw, hh);
    }
  }
}
