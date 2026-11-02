import type { App } from "../app";
import type { MidiManager } from "../midi/midi";
import { settings, setSetting } from "../settings";
import { SCALES, NOTE_NAMES } from "../synth/theory";
import { NTRACKS } from "../looper/looper";
import { h, setText, cls, css } from "./dom";
import { TracksView } from "./tracks";
import { DrumsPanel, SynthPanel, ChordsPanel, PerfPanel, KEYMAP } from "./instruments";
import { SettingsView, HELP_HTML } from "./settingsview";

export class UI {
  private tracks: TracksView;
  private drums: DrumsPanel;
  private synth: SynthPanel;
  private chords: ChordsPanel;
  private perf: PerfPanel;
  private settingsView: SettingsView;
  private T: Record<string, HTMLElement> = {};
  private barBtns: HTMLButtonElement[] = [];
  private toastEl: HTMLElement;
  private sessionsDlg: HTMLDialogElement;
  private lastFrame = 0;

  constructor(private app: App, private midi: MidiManager, root: HTMLElement) {
    this.tracks = new TracksView(app);
    this.drums = new DrumsPanel(app);
    this.synth = new SynthPanel(app);
    this.chords = new ChordsPanel(app);
    this.perf = new PerfPanel(app);
    this.settingsView = new SettingsView(app, midi);
    const T = this.T;
    const b = (label: string, title: string, fn: () => void, extra = "") => { const e = h("button", { class: `btn small ${extra}`, title, onclick: () => fn() }); e.textContent = label; return e; };

    T.play = b("▶", "Play / Stop (espacio)", () => app.togglePlay(), "big2");
    T.bpm = h("input", { type: "number", class: "bpm", min: "40", max: "240", step: "0.5", title: "Tempo (se fija al grabar el primer loop)" });
    T.bpm.addEventListener("change", () => app.setBpm(parseFloat((T.bpm as HTMLInputElement).value)));
    T.bpm.addEventListener("keydown", (e) => e.stopPropagation());
    T.pos = h("div", { class: "pos", title: "Compás . beat" });
    const bars = h("div", { class: "seg", title: "Duración del primer loop de cada pista" });
    for (const n of [1, 2, 4, 8, 0]) {
      const e = b(n ? `${n}` : "LIBRE", n ? `${n} compás(es)` : "Libre: vuelve a pulsar para cerrar el loop", () => { setSetting("loopBars", n); app.emit(); });
      e.dataset.n = String(n);
      this.barBtns.push(e);
      bars.append(e);
    }
    T.after = b("→ PLAY", "Al terminar de grabar: pasa a PLAY o sigue grabando encima (DUB)", () => { setSetting("afterRec", settings.afterRec === "play" ? "dub" : "play"); app.emit(); });
    T.count = b("1-2-3-4", "Cuenta atrás de 1 compás al empezar", () => { setSetting("countIn", !settings.countIn); app.emit(); });
    T.metro = b("♩ CLICK", "Metrónomo (no se graba)", () => { setSetting("metronome", !settings.metronome); app.emit(); });
    const rootSel = h("select", { class: "sel", title: "Tonalidad (pads de notas, acordes y teclas marcadas)" });
    NOTE_NAMES.forEach((n, i) => rootSel.append(h("option", { value: String(i) }, n)));
    rootSel.addEventListener("change", () => { setSetting("root", Number(rootSel.value)); app.emit(); });
    const scaleSel = h("select", { class: "sel", title: "Escala" });
    for (const [id, s] of Object.entries(SCALES)) scaleSel.append(h("option", { value: id }, s.name));
    scaleSel.addEventListener("change", () => { setSetting("scale", scaleSel.value); app.emit(); });
    T.root = rootSel; T.scale = scaleSel;
    T.rec = b("● GRABAR DIRECTO", "Graba todo lo que suena a un archivo (.webm)", () => app.toggleSessionRecording(), "recbtn");
    T.midi = h("span", { class: "midistat" });
    const help = h("dialog", { class: "dlg" }, h("div", { class: "dlghead" }, h("h2", {}, "Cómo se usa"), b("Cerrar", "", () => help.close())), h("div", { class: "dlgbody help", html: HELP_HTML }));
    this.sessionsDlg = h("dialog", { class: "dlg" });

    const topbar = h("header", { class: "topbar" },
      h("b", { class: "logo" }, "CDJ-PI ", h("span", {}, "LOOP")),
      T.play, h("label", { class: "bpmbox" }, T.bpm, h("small", {}, "BPM")), b("TAP", "Tap tempo", () => app.tap()), T.pos,
      bars, T.after, T.count, T.metro,
      rootSel, scaleSel,
      h("span", { class: "grow" }),
      T.midi,
      b("💾", "Sesiones: guardar / cargar", () => void this.openSessions()),
      b("⤓ WAV", "Exportar cada loop y la mezcla en WAV", () => void app.exportLoops()),
      T.rec,
      b("⛶", "Pantalla completa", () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); }),
      b("?", "Ayuda", () => help.showModal()),
      b("⚙", "Ajustes", () => void this.settingsView.open()),
    );

    const allBtns = h("div", { class: "allbtns" },
      b("▶ TODO", "Arrancar todas las pistas (siguiente compás) · Enter", () => app.looper.playAll()),
      b("■ TODO", "Parar todas las pistas", () => app.looper.stopAll()),
      b("✕ TODO", "Borrar todos los loops", () => { if (confirm("¿Borrar todos los loops?")) { app.looper.clearAll(); app.stopTransport(); } }),
    );
    this.toastEl = h("div", { class: "toasts" });
    const main = h("main", { class: "app" }, topbar, h("div", { class: "trackrow" }, this.tracks.el, allBtns),
      h("div", { class: "instr" }, this.drums.el, this.synth.el, this.chords.el, this.perf.el));
    root.append(main, this.settingsView.el, help, this.sessionsDlg, this.toastEl);

    app.onChange(() => this.update());
    this.installKeyboard();
    document.addEventListener("dragover", (e) => e.preventDefault());
    document.addEventListener("drop", (e) => e.preventDefault());
    this.update();
    requestAnimationFrame((t) => this.frame(t));
  }

  private async openSessions(): Promise<void> {
    const d = this.sessionsDlg;
    d.innerHTML = "";
    const list = await this.app.listSessions();
    const b = (label: string, fn: () => void, extra = "") => { const e = h("button", { class: `btn small ${extra}`, onclick: () => fn() }); e.textContent = label; return e; };
    const body = h("div", { class: "dlgbody" });
    body.append(h("div", { class: "row" }, b("Guardar sesión actual…", async () => {
      const n = prompt("Nombre de la sesión", `Sesión ${new Date().toLocaleString()}`);
      if (n) { await this.app.saveSession(n); void this.openSessions(); }
    })));
    if (!list.length) body.append(h("p", { class: "dim" }, "Aún no hay sesiones guardadas. Se guardan en este Chromebook (loops, tempo, preset y kit)."));
    for (const s of list) {
      const n = s.tracks.filter(Boolean).length;
      body.append(h("div", { class: "sess" },
        h("div", {}, h("b", {}, s.name), h("small", {}, ` · ${n} loops · ${s.bpm.toFixed(1)} BPM · ${new Date(s.savedAt).toLocaleString()}`)),
        b("Cargar", async () => { await this.app.loadSession(s); d.close(); }),
        b("Borrar", async () => { if (confirm(`¿Borrar "${s.name}"?`)) { await this.app.deleteSession(s.name); void this.openSessions(); } })));
    }
    d.append(h("div", { class: "dlghead" }, h("h2", {}, "Sesiones"), b("Cerrar", () => d.close())), body);
    if (!d.open) d.showModal();
  }

  private installKeyboard(): void {
    const held = new Set<string>();
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      return (t.tagName === "INPUT" && (t as HTMLInputElement).type !== "range") || t.tagName === "SELECT" || t.tagName === "TEXTAREA";
    };
    document.addEventListener("keydown", (e) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (held.has(e.code)) { e.preventDefault(); return; }
      held.add(e.code);
      const k = e.key.toLowerCase();
      const app = this.app;
      const ti = /^Digit([1-8])$/.exec(e.code);
      if (ti) { const i = Number(ti[1]) - 1; if (e.shiftKey) app.looper.stop(i); else app.looper.press(i); e.preventDefault(); return; }
      const pi = KEYMAP.indexOf(k);
      if (pi >= 0 && !e.shiftKey) { app.synth.noteOn(this.synth.baseMidi() + pi, 100); e.preventDefault(); return; }
      switch (e.code) {
        case "Space": app.togglePlay(); break;
        case "Enter": app.looper.playAll(); break;
        case "KeyZ": this.synth.octave(-1); break;
        case "KeyX": this.synth.octave(1); break;
        case "Backspace": app.looper.undo(app.looper.selected); break;
        case "ArrowUp": app.stepPreset(-1); break;
        case "ArrowDown": app.stepPreset(1); break;
        case "ArrowLeft": app.stepCategory(-1); break;
        case "ArrowRight": app.stepCategory(1); break;
        default: return;
      }
      e.preventDefault();
    });
    document.addEventListener("keyup", (e) => {
      held.delete(e.code);
      const pi = KEYMAP.indexOf(e.key.toLowerCase());
      if (pi >= 0) this.app.synth.noteOff(this.synth.baseMidi() + pi);
    });
    window.addEventListener("blur", () => { held.clear(); this.app.synth.allOff(); });
  }

  update(): void {
    const app = this.app, T = this.T;
    cls(T.play, "on", app.transport.running);
    setText(T.play, app.transport.running ? "■" : "▶");
    const bpm = app.transport.bpm.toFixed(1).replace(/\.0$/, "");
    if (document.activeElement !== T.bpm && (T.bpm as HTMLInputElement).value !== bpm) (T.bpm as HTMLInputElement).value = bpm;
    (T.bpm as HTMLInputElement).disabled = app.looper.hasContent;
    this.barBtns.forEach((e) => cls(e, "on", Number(e.dataset.n) === settings.loopBars));
    setText(T.after, settings.afterRec === "play" ? "→ PLAY" : "→ DUB");
    cls(T.count, "on", settings.countIn);
    cls(T.metro, "on", settings.metronome);
    if ((T.root as HTMLSelectElement).value !== String(settings.root)) (T.root as HTMLSelectElement).value = String(settings.root);
    if ((T.scale as HTMLSelectElement).value !== settings.scale) (T.scale as HTMLSelectElement).value = settings.scale;
    cls(T.rec, "on", app.recording);
    setText(T.midi, this.midi.statusLine());
    cls(T.midi, "ok", this.midi.anyConnected());
    this.tracks.update();
    this.drums.update();
    this.synth.update();
    this.chords.update();
    this.perf.update();
    const now = Date.now();
    const live = app.toasts.filter((t) => now - t.at < 4000);
    const key = live.map((t) => t.at + t.text).join("|");
    if (this.toastEl.dataset.k !== key) {
      this.toastEl.dataset.k = key;
      this.toastEl.innerHTML = "";
      for (const t of live) this.toastEl.append(h("div", { class: `toast ${t.kind}` }, t.text));
    }
  }

  private frame(t: number): void {
    requestAnimationFrame((x) => this.frame(x));
    if (settings.fps === 30 && t - this.lastFrame < 31) return;
    this.lastFrame = t;
    const app = this.app, tr = app.transport;
    // contador compás.beat (o cuenta atrás)
    const now = app.ctx.currentTime - app.latencyMs() / 1000;
    let pos = "–.–";
    if (tr.running) {
      const beat = tr.beatAt(now);
      if (beat < 0) pos = `${Math.ceil(-beat)}`;
      else pos = `${Math.floor(beat / 4) + 1}.${(Math.floor(beat) % 4) + 1}`;
    }
    setText(this.T.pos, pos);
    cls(this.T.pos, "count", tr.running && tr.beatAt(now) < 0);
    cls(this.T.pos, "beat1", tr.running && tr.beatAt(now) >= 0 && (tr.beatAt(now) % 4) < 0.25);
    this.tracks.draw();
    this.drums.draw();
    this.synth.draw();
    this.perf.draw();
    if (app.recording) setText(this.T.rec, `● ${Math.floor((Date.now() - app.recStart) / 60000)}:${String(Math.floor(((Date.now() - app.recStart) / 1000) % 60)).padStart(2, "0")}`);
    else setText(this.T.rec, "● GRABAR DIRECTO");
    css(this.T.pos, "--tc", "#fff");
    if (app.toasts.length && Date.now() - app.toasts[app.toasts.length - 1].at > 4000) { app.toasts = []; this.update(); }
    void NTRACKS;
  }
}
