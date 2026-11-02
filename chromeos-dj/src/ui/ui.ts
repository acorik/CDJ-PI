import type { App } from "../app";
import type { MidiManager } from "../midi/midi";
import { settings, setSetting } from "../settings";
import { h, setText, cls, css } from "./dom";
import { DeckView } from "./deckview";
import { MixerView } from "./mixerview";
import { LibraryView } from "./libraryview";
import { SettingsView, HELP_HTML } from "./settingsview";
import { ScrollWave, DECK_COLORS } from "./waveform";
import { AUDIO_EXT } from "../library/library";

const ZOOMS = [4, 6, 8, 12, 16, 24];

export class UI {
  private decks: DeckView[];
  private mixer: MixerView;
  readonly library: LibraryView;
  private settingsView: SettingsView;
  private waves: ScrollWave[] = [];
  private waveRows: HTMLElement[] = [];
  private top: Record<string, HTMLElement> = {};
  private toastEl: HTMLElement;
  private lastFrame = 0;
  private zoomIdx = 2;

  constructor(private app: App, private midi: MidiManager, root: HTMLElement) {
    this.decks = [new DeckView(app, 0), new DeckView(app, 1)];
    this.mixer = new MixerView(app);
    this.library = new LibraryView(app);
    this.settingsView = new SettingsView(app, midi);
    this.zoomIdx = Math.max(0, ZOOMS.indexOf(settings.waveZoom === 1 ? 8 : settings.waveZoom));

    const T = this.top;
    T.midi = h("span", { class: "midistat" });
    T.audio = h("span", { class: "audiostat" });
    T.clock = h("span", { class: "clock" });
    T.shift = h("span", { class: "shiftind" }, "SHIFT");
    const btn = (label: string, title: string, fn: () => void) => { const b = h("button", { class: "btn small", title, onclick: fn }); b.textContent = label; return b; };
    T.libBig = btn("▤", "Biblioteca grande (modo navegación)", () => { setSetting("libraryBig", !settings.libraryBig); });
    const help = h("dialog", { class: "dlg" }, h("div", { class: "dlghead" }, h("h2", {}, "Ayuda"), btn("Cerrar", "", () => help.close())), h("div", { class: "dlgbody help", html: HELP_HTML }));
    const topbar = h("header", { class: "topbar" },
      h("b", { class: "logo" }, "CDJ-PI ", h("span", {}, "DJ")),
      T.midi, T.audio, T.shift,
      h("span", { class: "grow" }),
      btn("−", "Zoom waveform −", () => this.zoom(1)), btn("+", "Zoom waveform +", () => this.zoom(-1)),
      T.libBig,
      btn("⛶", "Pantalla completa", () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); }),
      btn("?", "Ayuda", () => help.showModal()),
      btn("⚙", "Ajustes", () => this.settingsView.open()),
      T.clock,
    );

    const wavesEl = h("section", { class: "waves" });
    for (let i = 0; i < 4; i++) {
      const c = h("canvas", { class: "wave" });
      const label = h("span", { class: "wlabel" });
      const row = h("div", { class: "waverow" }, c, label);
      css(row, "--deck", DECK_COLORS[i]);
      // arrastrar en el waveform = mover la pista (como tocar el plato en pausa)
      let lastX = 0;
      c.addEventListener("pointerdown", (e) => { lastX = e.clientX; c.setPointerCapture(e.pointerId); app.decks[i].jogTouch(true); });
      c.addEventListener("pointermove", (e) => {
        if (e.buttons !== 1) return;
        const dx = e.clientX - lastX; lastX = e.clientX;
        const secPerPx = ZOOMS[this.zoomIdx] / c.clientWidth;
        app.decks[i].jogTurn(-dx * secPerPx / (1.8 / 1024));
      });
      c.addEventListener("pointerup", () => app.decks[i].jogTouch(false));
      this.waves.push(new ScrollWave(c, app.decks[i]));
      this.waveRows.push(row);
      wavesEl.append(row);
    }

    this.toastEl = h("div", { class: "toasts" });
    const deckRow = h("div", { class: "deckrow" }, this.decks[0].el, this.mixer.el, this.decks[1].el);
    const main = h("main", { class: "app" }, topbar, wavesEl, deckRow, this.library.el);
    root.append(main, this.settingsView.el, help, this.toastEl);
    this.root = main;

    app.ui = {
      loadSelected: (d) => this.library.loadSelected(d),
      browse: (delta, shift) => this.library.browse(delta, shift),
      browsePush: (shift) => this.library.browsePush(shift),
      dropOnDeck: (d, e) => this.dropOnDeck(d, e),
    };
    app.onChange(() => this.update());
    this.installKeyboard();
    document.addEventListener("dragover", (e) => e.preventDefault());
    document.addEventListener("drop", (e) => { e.preventDefault(); this.dropFiles(e, -1); });
    this.update();
    requestAnimationFrame((t) => this.frame(t));
  }
  private root: HTMLElement;

  private zoom(dir: number): void {
    this.zoomIdx = Math.max(0, Math.min(ZOOMS.length - 1, this.zoomIdx + dir));
    setSetting("waveZoom", ZOOMS[this.zoomIdx]);
  }

  private async dropOnDeck(d: number, e: DragEvent): Promise<void> {
    const id = e.dataTransfer?.getData("text/x-track");
    if (id) {
      const t = this.app.library.tracks.get(id);
      if (t) await this.app.loadTrack(d, t);
      return;
    }
    await this.dropFiles(e, d);
  }

  /** Archivos arrastrados desde la app Archivos de ChromeOS. */
  private async dropFiles(e: DragEvent, deck: number): Promise<void> {
    const items = e.dataTransfer?.items;
    if (!items?.length) return;
    const files: File[] = [];
    const handles: (FileSystemFileHandle | null)[] = [];
    for (const it of [...items]) {
      if (it.kind !== "file") continue;
      const anyIt = it as any;
      let handle: FileSystemHandle | null = null;
      try { handle = anyIt.getAsFileSystemHandle ? await anyIt.getAsFileSystemHandle() : null; } catch { /* */ }
      if (handle?.kind === "directory") { this.app.toast("Para carpetas usa CARPETAS → + en la biblioteca"); continue; }
      const f = it.getAsFile();
      if (f && AUDIO_EXT.test(f.name)) { files.push(f); handles.push(handle as FileSystemFileHandle | null); }
    }
    if (!files.length) return;
    const tracks = await this.app.library.addFiles(files, handles);
    if (deck >= 0 && tracks[0]) await this.app.loadTrack(deck, tracks[0]);
    else this.app.toast(`${tracks.length} pistas añadidas`);
  }

  private installKeyboard(): void {
    const held = new Set<string>();
    const L = () => this.app.decks[this.app.side[0]];
    const R = () => this.app.decks[this.app.side[1]];
    document.addEventListener("keydown", (e) => {
      const tgt = e.target as HTMLElement;
      if (tgt.tagName === "INPUT" && (tgt as HTMLInputElement).type !== "range" || tgt.tagName === "SELECT" || tgt.tagName === "TEXTAREA") return;
      if (e.ctrlKey && e.key.toLowerCase() === "f") { e.preventDefault(); (this.library.el.querySelector(".search") as HTMLElement).focus(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const code = e.code;
      if (held.has(code)) { e.preventDefault(); return; }
      held.add(code);
      const hot = ["Digit1", "Digit2", "Digit3", "Digit4"].indexOf(code);
      const hotR = ["Digit7", "Digit8", "Digit9", "Digit0"].indexOf(code);
      let handled = true;
      if (hot >= 0) L().hotDown(hot, e.shiftKey);
      else if (hotR >= 0) R().hotDown(hotR, e.shiftKey);
      else switch (code) {
        case "KeyZ": L().cueDown(); break;
        case "KeyX": L().togglePlay(); break;
        case "KeyC": L().toggleSync(); break;
        case "KeyV": L().loopToggle(); break;
        case "KeyM": R().cueDown(); break;
        case "Comma": R().togglePlay(); break;
        case "Period": R().toggleSync(); break;
        case "Minus": case "Slash": R().loopToggle(); break;
        case "KeyQ": L().bend(-1); break;
        case "KeyW": L().bend(1); break;
        case "KeyO": R().bend(-1); break;
        case "KeyP": R().bend(1); break;
        case "KeyA": L().beatJump(-4); break;
        case "KeyS": L().beatJump(4); break;
        case "KeyK": R().beatJump(-4); break;
        case "KeyL": R().beatJump(4); break;
        case "ArrowDown": this.library.move(1); break;
        case "ArrowUp": this.library.move(-1); break;
        case "PageDown": this.library.move(15); break;
        case "PageUp": this.library.move(-15); break;
        case "ArrowLeft": if (e.shiftKey) this.library.loadSelected(this.app.side[0]); else handled = false; break;
        case "ArrowRight": if (e.shiftKey) this.library.loadSelected(this.app.side[1]); else handled = false; break;
        case "Enter": this.library.loadSelected(this.library.firstFreeDeck()); break;
        case "NumpadAdd": this.zoom(-1); break;
        case "NumpadSubtract": this.zoom(1); break;
        default: handled = false;
      }
      if (handled) e.preventDefault();
    });
    document.addEventListener("keyup", (e) => {
      held.delete(e.code);
      const hot = ["Digit1", "Digit2", "Digit3", "Digit4"].indexOf(e.code);
      const hotR = ["Digit7", "Digit8", "Digit9", "Digit0"].indexOf(e.code);
      if (hot >= 0) L().hotUp(hot);
      else if (hotR >= 0) R().hotUp(hotR);
      else switch (e.code) {
        case "KeyZ": L().cueUp(); break;
        case "KeyM": R().cueUp(); break;
        case "KeyQ": case "KeyW": L().bend(0); break;
        case "KeyO": case "KeyP": R().bend(0); break;
      }
    });
    window.addEventListener("blur", () => held.clear());
  }

  /** Actualización de estado (no por frame). */
  update(): void {
    cls(this.root, "libbig", settings.libraryBig);
    cls(this.top.libBig, "on", settings.libraryBig);
    setText(this.top.midi, `🎛 ${this.midi.status}`);
    cls(this.top.midi, "ok", !!this.midi.ctrl && !!this.midi.input);
    const eng = this.app.engine;
    setText(this.top.audio, `🔊 ${eng.effectiveMode === "multi" ? "4 canales" : eng.effectiveMode === "split" ? "split cue" : eng.effectiveMode === "dual" ? "2 salidas" : eng.outputFallback ? "master (sin auriculares: ver ⚙)" : "master"} · ${eng.ctx.sampleRate / 1000} kHz · ${eng.latencyMs()} ms${eng.ctx.state !== "running" ? " · ⏸ toca para activar el audio" : ""}`);
    cls(this.top.shift, "on", this.app.shift);
    for (const d of this.decks) d.update();
    this.mixer.update();
    this.library.refresh();
    // toasts
    const now = Date.now();
    const live = this.app.toasts.filter((t) => now - t.at < 4000);
    const key = live.map((t) => t.at + t.text).join("|");
    if (this.toastEl.dataset.k !== key) {
      this.toastEl.dataset.k = key;
      this.toastEl.innerHTML = "";
      for (const t of live) this.toastEl.append(h("div", { class: `toast ${t.kind}` }, t.text));
    }
  }

  private frame(t: number): void {
    requestAnimationFrame((x) => this.frame(x));
    const minDt = settings.fps === 30 ? 31 : 0;
    if (t - this.lastFrame < minDt) return;
    this.lastFrame = t;
    const app = this.app;
    const four = settings.fourDecks || app.decks[2].loaded || app.decks[3].loaded;
    const visible = four ? [0, 1, 2, 3] : [app.side[0], app.side[1]];
    // fase del master (para la barra de fase de los demás decks)
    const m = app.decks[app.master];
    let mph: number | null = null;
    if (m?.loaded && m.bpm > 0) { const v = (m.now(true) - m.firstBeat) / m.beatLen; mph = v - Math.floor(v); }
    for (let i = 0; i < 4; i++) {
      const row = this.waveRows[i];
      const show = visible.includes(i);
      cls(row, "hidden", !show);
      if (!show) continue;
      const d = app.decks[i];
      this.waves[i].draw(ZOOMS[this.zoomIdx], d.isMaster || !d.playing ? null : mph);
      const lab = row.lastChild as HTMLElement;
      setText(lab, `${i + 1}${d.isMaster ? " MASTER" : ""}${d.sync ? " SYNC" : ""} ${d.track ? `· ${d.track.title}` : ""}`);
      cls(row, "active", app.side.includes(i));
    }
    for (const d of this.decks) { d.update(); d.draw(); }
    this.mixer.meters();
    const now = new Date();
    setText(this.top.clock, now.toTimeString().slice(0, 5));
    if (this.app.toasts.length && Date.now() - this.app.toasts[this.app.toasts.length - 1].at > 4000) { this.app.toasts = []; this.update(); }
  }
}
