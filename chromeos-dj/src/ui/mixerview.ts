import type { App } from "../app";
import { FX_LIST } from "../audio/fx";
import { settings, setSetting } from "../settings";
import { h, setText, cls, css, Knob } from "./dom";
import { DECK_COLORS } from "./waveform";

function vuPct(level: number): number {
  const db = 20 * Math.log10(level + 1e-9);
  return Math.max(0, Math.min(100, ((db + 42) / 45) * 100));
}

/** Mezclador central: refleja la controladora y permite mezclar sin ella. */
export class MixerView {
  readonly el: HTMLElement;
  private strips: { knobs: Record<string, Knob>; vu: HTMLElement; fader: HTMLInputElement; pfl: HTMLButtonElement; label: HTMLElement; deck: number }[] = [];
  private xf: HTMLInputElement;
  private mvuL: HTMLElement;
  private mvuR: HTMLElement;
  private fxEls: { sel: HTMLSelectElement; on: HTMLButtonElement; beats: HTMLElement; level: Knob; tap: HTMLElement }[] = [];

  constructor(private app: App) {
    const eng = () => app.engine;
    const stripsEl = h("div", { class: "strips" });
    for (let s = 0; s < 2; s++) {
      const ch = () => eng().channels[app.side[s]];
      const knobs: Record<string, Knob> = {
        trim: new Knob("TRIM", (v) => { ch().setTrim(v); app.emit(); }),
        high: new Knob("HI", (v) => { ch().setEq("high", v); app.emit(); }),
        mid: new Knob("MID", (v) => { ch().setEq("mid", v); app.emit(); }),
        low: new Knob("LOW", (v) => { ch().setEq("low", v); app.emit(); }),
        filter: new Knob("FILTER", (v) => { ch().setFilter(v); app.emit(); }),
      };
      const vu = h("div", { class: "vu" }, h("div", { class: "vufill" }));
      const fader = h("input", { type: "range", min: "0", max: "1", step: "0.001", class: "chfader", title: "Fader de canal" });
      fader.addEventListener("input", () => { ch().setFader(parseFloat(fader.value)); app.emit(); });
      const pfl = h("button", { class: "btn small pfl", title: "CUE (pre-escucha por auriculares)", onclick: () => { ch().setPfl(!ch().state.pfl); app.emit(); } });
      pfl.textContent = "CUE";
      const label = h("div", { class: "chlabel" });
      const strip = h("div", { class: "strip" }, label, knobs.trim.el, knobs.high.el, knobs.mid.el, knobs.low.el, knobs.filter.el, pfl, h("div", { class: "fadervu" }, vu, fader));
      stripsEl.append(strip);
      this.strips.push({ knobs, vu, fader, pfl, label, deck: -1 });
    }
    this.xf = h("input", { type: "range", min: "0", max: "1", step: "0.001", class: "xfader", title: "Crossfader" });
    this.xf.addEventListener("input", () => { eng().setCrossfader(parseFloat(this.xf.value)); });
    this.xf.addEventListener("dblclick", () => { eng().setCrossfader(0.5); });
    this.mvuL = h("div", { class: "vufill" });
    this.mvuR = h("div", { class: "vufill" });

    const fxEl = h("div", { class: "fxunits" });
    for (let u = 0; u < 2; u++) {
      const unit = () => eng().fx[u];
      const sel = h("select", { class: "fxsel", title: `FX ${u + 1}` });
      for (const f of FX_LIST) sel.append(h("option", { value: f.id }, f.name));
      sel.addEventListener("change", () => { unit().select(sel.value); app.emit(); });
      const on = h("button", { class: "btn small", onclick: () => { unit().setOn(!unit().on); app.emit(); } });
      on.textContent = "ON";
      const beats = h("span", { class: "fxbeats", title: "Beats / parámetro (rueda o clic ◀ ▶)" });
      const bl = h("button", { class: "btn tiny", onclick: () => { unit().stepBeats(-1); app.emit(); } }); bl.textContent = "◀";
      const br = h("button", { class: "btn tiny", onclick: () => { unit().stepBeats(1); app.emit(); } }); br.textContent = "▶";
      const level = new Knob("NIVEL", (v) => { unit().setLevel(v); app.emit(); }, 0.6, false);
      const tap = h("span", { class: "fxtap" });
      fxEl.append(h("div", { class: "fxunit" }, h("div", { class: "fxhead" }, h("b", {}, `FX${u + 1}`), sel, on), h("div", { class: "fxrow" }, bl, beats, br, level.el, tap)));
      this.fxEls.push({ sel, on, beats, level, tap });
    }

    const rec = h("button", { class: "btn small rec", title: "Grabar la mezcla (master) a un archivo .webm" });
    rec.addEventListener("click", async () => {
      if (eng().recording) {
        const blob = await eng().stopRecording();
        if (blob) {
          const a = h("a", { href: URL.createObjectURL(blob), download: `mezcla-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}.webm` });
          a.click();
          app.toast("Grabación guardada en Descargas");
        }
      } else { eng().startRecording(); app.toast("Grabando la mezcla…"); }
      app.emit();
    });
    this.recBtn = rec;

    const smpVol = new Knob("SAMPLER", (v) => { eng().sampler.setVolume(v); this.smpVal = v; }, 0.8, false);
    smpVol.set(0.8);
    this.smpKnob = smpVol;
    const masterK = new Knob("MASTER", (v) => { eng().setMasterGain(v); this.masterVal = v; }, 0.5);
    masterK.set(0.5);
    this.masterKnob = masterK;
    const lim = h("button", { class: "btn small", title: "Limitador en el master (evita saturar)", onclick: () => { setSetting("limiter", !settings.limiter); eng().setLimiter(settings.limiter); app.emit(); } });
    lim.textContent = "LIMIT";
    this.limBtn = lim;

    this.el = h("section", { class: "mixer" },
      stripsEl,
      h("div", { class: "xfrow" }, h("span", {}, "A"), this.xf, h("span", {}, "B")),
      h("div", { class: "masterrow" }, h("div", { class: "mvu" }, h("div", { class: "vu h" }, this.mvuL), h("div", { class: "vu h" }, this.mvuR)), masterK.el, smpVol.el, lim, rec),
      fxEl,
    );
  }
  private recBtn: HTMLButtonElement;
  private limBtn: HTMLButtonElement;
  private smpKnob: Knob;
  private masterKnob: Knob;
  private smpVal = 0.8;
  private masterVal = 0.5;

  update(): void {
    const app = this.app;
    const eng = app.engine;
    this.strips.forEach((s, side) => {
      const di = app.side[side];
      const ch = eng.channels[di];
      if (s.deck !== di) { s.deck = di; css(s.label, "color", DECK_COLORS[di]); setText(s.label, `CH ${di + 1}`); }
      s.knobs.trim.set(ch.state.trim); s.knobs.high.set(ch.state.high); s.knobs.mid.set(ch.state.mid);
      s.knobs.low.set(ch.state.low); s.knobs.filter.set(ch.state.filter);
      if (document.activeElement !== s.fader) { const v = String(ch.state.fader); if (s.fader.value !== v) s.fader.value = v; }
      cls(s.pfl, "on", ch.state.pfl);
    });
    if (document.activeElement !== this.xf) { const v = String(eng.xfader); if (this.xf.value !== v) this.xf.value = v; }
    eng.fx.forEach((u, i) => {
      const e = this.fxEls[i];
      if (e.sel.value !== u.def.id) e.sel.value = u.def.id;
      cls(e.on, "on", u.on);
      setText(e.beats, u.beatsLabel);
      e.level.set(u.level);
      setText(e.tap, u.tapBpm > 0 ? `TAP ${u.tapBpm}` : `→ CH${app.side[i] + 1}`);
    });
    cls(this.recBtn, "on", eng.recording);
    setText(this.recBtn, eng.recording ? `● ${Math.floor((Date.now() - eng.recStart) / 60000)}:${String(Math.floor(((Date.now() - eng.recStart) / 1000) % 60)).padStart(2, "0")}` : "● REC");
    cls(this.limBtn, "on", settings.limiter);
    this.smpKnob.set(this.smpVal);
    this.masterKnob.set(this.masterVal);
  }

  /** VUs (cada frame). */
  meters(): void {
    const eng = this.app.engine;
    this.strips.forEach((s, side) => {
      const lvl = eng.channels[this.app.side[side]].level();
      css(s.vu.firstChild as HTMLElement, "height", `${vuPct(lvl)}%`);
      cls(s.vu, "clip", lvl > 0.98);
    });
    const [l, r] = eng.masterLevel();
    css(this.mvuL, "width", `${vuPct(l)}%`);
    css(this.mvuR, "width", `${vuPct(r)}%`);
  }
}
