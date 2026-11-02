import type { App } from "../app";
import type { MidiManager } from "../midi/midi";
import { FX_LIST } from "../audio/fx";
import { settings, setSetting, type Settings } from "../settings";
import { dbClear } from "../library/db";
import { h } from "./dom";

type Opt = [string, string];

export class SettingsView {
  readonly el: HTMLDialogElement;
  private body: HTMLElement;
  private monitorEl: HTMLElement | null = null;

  constructor(private app: App, private midi: MidiManager) {
    this.body = h("div", { class: "dlgbody" });
    const close = h("button", { class: "btn", onclick: () => this.close() }); close.textContent = "Cerrar";
    this.el = h("dialog", { class: "dlg" }, h("div", { class: "dlghead" }, h("h2", {}, "Ajustes"), close), this.body);
    this.el.addEventListener("close", () => { this.midi.monitorOn = false; });
  }

  private select<K extends keyof Settings>(label: string, k: K, opts: Opt[], after?: () => void, hint?: string): HTMLElement {
    const s = h("select", {});
    for (const [v, l] of opts) s.append(h("option", { value: v }, l));
    s.value = String(settings[k]);
    s.addEventListener("change", () => {
      const cur = settings[k];
      const v = typeof cur === "number" ? Number(s.value) : typeof cur === "boolean" ? s.value === "true" : s.value;
      setSetting(k, v as Settings[K]);
      after?.();
    });
    return h("label", { class: "field" }, h("span", {}, label), s, hint ? h("small", {}, hint) : null);
  }

  private check<K extends keyof Settings>(label: string, k: K, after?: () => void, hint?: string): HTMLElement {
    const c = h("input", { type: "checkbox" });
    c.checked = !!settings[k];
    c.addEventListener("change", () => { setSetting(k, c.checked as Settings[K]); after?.(); });
    return h("label", { class: "field check" }, c, h("span", {}, label), hint ? h("small", {}, hint) : null);
  }

  private num<K extends keyof Settings>(label: string, k: K, min: number, max: number, step: number, after?: () => void): HTMLElement {
    const i = h("input", { type: "number", min: String(min), max: String(max), step: String(step) });
    i.value = String(settings[k]);
    i.addEventListener("change", () => { setSetting(k, Number(i.value) as Settings[K]); after?.(); });
    return h("label", { class: "field" }, h("span", {}, label), i);
  }

  async open(): Promise<void> {
    await this.render();
    this.el.showModal();
  }

  close(): void { this.el.close(); }

  private async render(): Promise<void> {
    const app = this.app;
    const eng = app.engine;
    const b = this.body;
    b.innerHTML = "";
    let devices: MediaDeviceInfo[] = [];
    try { devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audiooutput"); } catch { /* */ }
    const devOpts: Opt[] = [["", "Predeterminado del sistema"], ...devices.filter((d) => d.deviceId !== "default").map((d, i): Opt => [d.deviceId, d.label || `Salida ${i + 1}`])];
    const noLabels = devices.length > 0 && devices.every((d) => !d.label);
    const askLabels = h("button", { class: "btn small", onclick: async () => {
      try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((t) => t.stop()); } catch { /* */ }
      this.render();
    } });
    askLabels.textContent = "Ver nombres de dispositivos";

    const sec = (title: string, ...kids: (HTMLElement | null)[]) => b.append(h("fieldset", {}, h("legend", {}, title), ...kids));

    sec("Audio",
      this.select("Salida", "outputMode", [
        ["multi", "Controladora 4 canales (master 1-2, auriculares 3-4)"],
        ["split", "Split cue: master mono izq. / auriculares mono der."],
        ["dual", "Dos dispositivos (master y auriculares por separado)"],
        ["master", "Solo master (sin pre-escucha)"],
      ], () => eng.applyOutput(), `Canales disponibles en el dispositivo: ${eng.maxChannels}. Ahora: ${eng.effectiveMode}${eng.outputFallback ? " — este dispositivo solo da 2 canales: elige la Platinum FX como 'Dispositivo master', o usa split / dos dispositivos para tener auriculares" : ""}`),
      this.select("Dispositivo master", "masterDevice", devOpts, () => eng.setMasterDevice(settings.masterDevice).catch((e) => app.toast(String(e), "error"))),
      settings.outputMode === "dual" ? this.select("Dispositivo auriculares", "cueDevice", devOpts, () => eng.applyOutput()) : null,
      noLabels ? askLabels : null,
      this.select("Latencia / buffer", "latency", [["low", "Mínima (~5 ms, solo equipos potentes)"], ["interactive", "Interactiva (recomendada)"], ["balanced", "Equilibrada (~40 ms, si hay cortes)"], ["safe", "Segura (~80 ms, Chromebook muy justo)"]], () => app.toast("La latencia se aplica al recargar la app"), `Latencia actual: ${eng.latencyMs()} ms`),
      this.check("Auto gain (iguala volumen entre pistas)", "autoGain", () => app.decks.forEach((d) => d.applyAutoGain())),
      this.num("Objetivo auto gain (LUFS aprox.)", "gainTarget", -20, -4, 1, () => app.decks.forEach((d) => d.applyAutoGain())),
      this.check("Limitador en master", "limiter", () => eng.setLimiter(settings.limiter)),
      this.select("Curva crossfader", "xfaderCurve", [["smooth", "Suave (mezcla)"], ["sharp", "Corte (scratch)"], ["thru", "Desactivado (THRU)"]], () => eng.applyXfader()),
    );

    sec("Decks (estilo CDJ)",
      this.select("Rango de pitch por defecto", "tempoRange", [["6", "±6%"], ["8", "±8%"], ["10", "±10%"], ["16", "±16%"], ["100", "WIDE"]], () => app.decks.forEach((d) => { if (!d.loaded) d.range = settings.tempoRange; })),
      this.check("Master Tempo (key lock) activado al cargar", "keylockDefault"),
      this.check("Quantize", "quantize"),
      this.check("Modo vinilo por defecto (tocar el plato = scratch)", "vinylDefault"),
      this.check("Auto cue (salta al primer sonido al cargar)", "autoCue"),
      this.check("Load lock (no cargar en un deck que está sonando)", "loadLock"),
      this.check("Needle lock (no buscar en el overview mientras suena)", "needleLock"),
      this.check("Fader start (subir fader = play desde cue)", "faderStart"),
      this.num("Arranque (s, efecto plato)", "startTime", 0, 3, 0.1, () => app.decks.forEach((d) => eng.post({ t: "ramp", d: d.i, start: settings.startTime, brake: settings.brakeTime }))),
      this.num("Frenado (s, efecto plato)", "brakeTime", 0, 3, 0.1, () => app.decks.forEach((d) => eng.post({ t: "ramp", d: d.i, start: settings.startTime, brake: settings.brakeTime }))),
      this.num("Sensibilidad jog (scratch)", "jogSensitivity", 0.25, 4, 0.05),
      this.check("Invertir pitch fader", "invertPitch"),
      this.check("Tiempo restante en las pantallas de los platos", "timeRemaining"),
    );

    sec("Análisis y biblioteca",
      this.select("Rango de BPM detectado", "minBpm", [["70", "70–140"], ["78", "78–156"], ["88", "88–176 (house/techno/DnB)"], ["98", "98–196"]], undefined, "Cambiarlo solo afecta a pistas que analices después"),
      this.select("Notación de tonalidad", "keyNotation", [["camelot", "Camelot (8A)"], ["openkey", "Open Key (1m)"], ["classic", "Clásica (Am)"]]),
      this.num("Tolerancia BPM para 'compatibles' (%)", "bpmTolerance", 1, 20, 1),
      this.select("Colores de waveform", "waveColors", [["rgb", "RGB (graves rojo / medios verde / agudos azul)"], ["3band", "3 bandas (azul/naranja/blanco)"], ["blue", "Azul clásico"]]),
      this.select("Fotogramas por segundo", "fps", [["60", "60 fps"], ["30", "30 fps (ahorra batería/CPU)"]]),
      this.check("Mostrar 4 decks en los waveforms", "fourDecks"),
      h("div", { class: "row" },
        this.btn("Exportar biblioteca (cues, grids, crates)", () => {
          const blob = new Blob([app.library.exportJson()], { type: "application/json" });
          h("a", { href: URL.createObjectURL(blob), download: `cdjpi-biblioteca-${new Date().toISOString().slice(0, 10)}.json` }).click();
        }),
        this.btn("Importar…", () => {
          const i = h("input", { type: "file", accept: ".json,application/json" });
          i.addEventListener("change", async () => {
            const f = i.files?.[0];
            if (!f) return;
            try { const n = await app.library.importJson(await f.text()); app.toast(`${n} pistas actualizadas desde el backup`); }
            catch (e) { app.toast((e as Error).message, "error"); }
          });
          i.click();
        }),
        this.btn("Borrar análisis (re-analizar todo)", async () => {
          if (!confirm("¿Borrar BPM/tonalidad/waveforms de todas las pistas? Los cues se mantienen.")) return;
          for (const t of app.library.tracks.values()) { t.analyzed = 0; app.library.saveTrack(t); }
          await dbClear("waves");
          app.toast("Análisis borrado");
        }),
      ),
    );

    const fxSel = (i: 0 | 1 | 2) => {
      const s = h("select", {});
      for (const f of FX_LIST) s.append(h("option", { value: f.id }, f.name));
      s.value = settings.fxSlots[i];
      s.addEventListener("change", () => { const a = [...settings.fxSlots] as Settings["fxSlots"]; a[i] = s.value; setSetting("fxSlots", a); });
      return h("label", { class: "field" }, h("span", {}, `Botón FX ${i + 1}`), s);
    };
    sec("Efectos (botones de la controladora)", fxSel(0), fxSel(1), fxSel(2));

    const mon = h("pre", { class: "monitor" });
    this.monitorEl = mon;
    const inSel = h("select", {});
    inSel.append(h("option", { value: "" }, "Automático (Platinum FX / Mixtrack)"));
    for (const i of this.midi.inputs()) inSel.append(h("option", { value: i.id }, i.name ?? i.id));
    inSel.value = this.midi.forcedInput;
    inSel.addEventListener("change", () => { this.midi.forcedInput = inSel.value; this.midi.connect(); });
    sec("Controladora MIDI",
      h("p", {}, `Estado: ${this.midi.status}`),
      h("label", { class: "field" }, h("span", {}, "Entrada MIDI"), inSel),
      this.check("Usar sysex (pantallas de los platos)", "midiSysex", () => app.toast("Se aplica al recargar")),
      this.num("Valor LED pad encendido", "padOnValue", 1, 127, 1),
      this.num("Valor LED pad apagado", "padOffValue", 0, 127, 1),
      this.btn("Monitor MIDI (ver mensajes)", () => { this.midi.monitorOn = true; this.tickMonitor(); }),
      mon,
    );
    b.append(h("p", { class: "ver" }, `CDJ-PI DJ v${__APP_VERSION__}`));
  }

  private btn(label: string, fn: () => void): HTMLButtonElement {
    const x = h("button", { class: "btn small", onclick: () => fn() });
    x.textContent = label;
    return x;
  }

  private tickMonitor(): void {
    if (!this.midi.monitorOn || !this.el.open || !this.monitorEl) return;
    this.monitorEl.textContent = this.midi.monitor.join("\n") || "(mueve algo en la controladora)";
    setTimeout(() => this.tickMonitor(), 150);
  }
}

export const HELP_HTML = `
<h3>Controladora (Mixtrack Platinum FX)</h3>
<table>
<tr><td>PLAY / CUE</td><td>Como en CDJ: CUE en pausa fija el punto; mantener CUE = preview; CUE sonando = vuelve y para. SHIFT+PLAY = stutter, SHIFT+CUE = inicio.</td></tr>
<tr><td>SYNC</td><td>Beat sync (tempo + fase). SHIFT+SYNC = este deck pasa a MASTER.</td></tr>
<tr><td>Plato</td><td>Tocar arriba = scratch (modo VINYL) · girar el borde = nudge · SHIFT+girar = búsqueda rápida.</td></tr>
<tr><td>SCRATCH</td><td>Activa/desactiva modo vinilo. SHIFT+mantener = censor (reverse con slip).</td></tr>
<tr><td>PITCH BEND ◀ ▶</td><td>Empujar tempo. SHIFT+▶ = Master Tempo (key lock). SHIFT+◀ = rango (±6/8/10/16/WIDE).</td></tr>
<tr><td>CUE (auricular)</td><td>Pre-escucha. SHIFT+CUE = SLIP.</td></tr>
<tr><td>LOOP</td><td>Loop de 4 beats / salir. SHIFT+LOOP = reloop. ½ ×2 = mitad/doble. SHIFT+½ = IN, SHIFT+×2 = OUT.</td></tr>
<tr><td>Modos de pads</td><td>HOT CUE (2ª pulsación o SHIFT: BEAT JUMP) · AUTO LOOP (2ª: ROLL) · FADER CUTS (2ª: KEY SHIFT) · SAMPLE (2ª o SHIFT: PAD FX).</td></tr>
<tr><td>Hot cues</td><td>Pulsar vacío = guardar (si hay loop activo, guarda el loop). En pausa, mantener = preview. SHIFT+pad = borrar.</td></tr>
<tr><td>Navegador</td><td>Girar = moverse · pulsar = alterna lista/crates · SHIFT+pulsar = añadir a ★ Preparar · LOAD = cargar (doble pulsación = instant double) · SHIFT+LOAD = expulsar.</td></tr>
<tr><td>FX</td><td>Botones 1-3 = efecto (configurable en ajustes) · palanca arriba = fijo, abajo = momentáneo · knob = beats · TAP = tempo FX (SHIFT+TAP = automático).</td></tr>
<tr><td>DECK 3/4</td><td>Botón de deck: cambia la capa (los knobs/faders "recogen" el valor al pasar por él).</td></tr>
</table>
<h3>LIVE · Akai MPD218 (botón 🥁 LIVE)</h3>
<table>
<tr><td>Banco A</td><td>Batería 808/909 (arrastra un audio a un pad para usar tu sample).</td></tr>
<tr><td>Banco B</td><td>FX de directo sobre todo el master: echo/reverb throw, beat repeat, HPF/LPF, gate, crush, flanger, tape stop, BASS KILL, riser, impact, air horn.</td></tr>
<tr><td>Banco C</td><td>Bajo 808 en la escala de la tonalidad del master.</td></tr>
<tr><td>Secuenciador</td><td>PLAY · REC (cuantizado) · ↶ · CLEAR · 1/2/4 compases · P1-P8 · ERASE+pad borra pista · clic en la rejilla edita.</td></tr>
<tr><td>Note Repeat</td><td>En el MPD218: NR CONFIG + pad 15 (Ext Clock) → redobles al tempo de la mezcla.</td></tr>
<tr><td>Aprender</td><td>Clic derecho en un pad o knob de la pantalla y tócalo en el MPD218.</td></tr>
</table>
<h3>Teclado (sin controladora)</h3>
<table>
<tr><td>Z / X / C / V</td><td>Deck izq.: CUE · PLAY · SYNC · loop 4</td></tr>
<tr><td>M / , / . / -</td><td>Deck der.: CUE · PLAY · SYNC · loop 4</td></tr>
<tr><td>1-4 · 7-0</td><td>Hot cues A-D izq. · der. (Shift = borrar)</td></tr>
<tr><td>Q W / O P</td><td>Pitch bend izq. / der.</td></tr>
<tr><td>A S / K L</td><td>Beat jump −4 / +4 izq. / der.</td></tr>
<tr><td>↑ ↓ · Shift+← / Shift+→ · Enter</td><td>Navegar · cargar izq./der. · cargar en deck libre</td></tr>
<tr><td>+ / −  (teclado numérico)</td><td>Zoom de waveform</td></tr>
<tr><td>Ctrl+F</td><td>Buscar</td></tr>
</table>`;
