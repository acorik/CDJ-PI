import type { App } from "../app";
import type { MidiManager } from "../midi/midi";
import { FX_LIST } from "../audio/fx";
import { settings, setSetting, type Settings } from "../settings";
import { h } from "./dom";

type Opt = [string, string];

export class SettingsView {
  readonly el: HTMLDialogElement;
  private body: HTMLElement;
  private monitorEl: HTMLElement | null = null;

  constructor(private app: App, private midi: MidiManager) {
    this.body = h("div", { class: "dlgbody" });
    const close = h("button", { class: "btn", onclick: () => this.el.close() }); close.textContent = "Cerrar";
    this.el = h("dialog", { class: "dlg" }, h("div", { class: "dlghead" }, h("h2", {}, "Ajustes"), close), this.body);
    this.el.addEventListener("close", () => { this.midi.monitorOn = false; });
  }

  private select<K extends keyof Settings>(label: string, k: K, opts: Opt[], after?: () => void, hint?: string): HTMLElement {
    const s = h("select", {});
    for (const [v, l] of opts) s.append(h("option", { value: v }, l));
    s.value = String(settings[k]);
    s.addEventListener("change", () => {
      const cur = settings[k];
      setSetting(k, (typeof cur === "number" ? Number(s.value) : typeof cur === "boolean" ? s.value === "true" : s.value) as Settings[K]);
      after?.();
    });
    return h("label", { class: "field" }, h("span", {}, label), s, hint ? h("small", {}, hint) : null);
  }

  private check<K extends keyof Settings>(label: string, k: K, after?: () => void): HTMLElement {
    const c = h("input", { type: "checkbox" }) as HTMLInputElement;
    c.checked = !!settings[k];
    c.addEventListener("change", () => { setSetting(k, c.checked as Settings[K]); after?.(); });
    return h("label", { class: "field check" }, c, h("span", {}, label));
  }

  private num<K extends keyof Settings>(label: string, k: K, min: number, max: number, step: number, after?: () => void, hint?: string): HTMLElement {
    const i = h("input", { type: "number", min: String(min), max: String(max), step: String(step) }) as HTMLInputElement;
    i.value = String(settings[k]);
    i.addEventListener("keydown", (e) => e.stopPropagation());
    i.addEventListener("change", () => { setSetting(k, Number(i.value) as Settings[K]); after?.(); });
    return h("label", { class: "field" }, h("span", {}, label), i, hint ? h("small", {}, hint) : null);
  }

  async open(): Promise<void> {
    await this.render();
    this.el.showModal();
  }

  private async render(): Promise<void> {
    const app = this.app;
    const b = this.body;
    b.innerHTML = "";
    let devices: MediaDeviceInfo[] = [];
    try { devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audiooutput"); } catch { /* */ }
    const devOpts: Opt[] = [["", "Predeterminado del sistema"], ...devices.filter((d) => d.deviceId !== "default").map((d, i): Opt => [d.deviceId, d.label || `Salida ${i + 1}`])];
    const sec = (title: string, ...kids: (HTMLElement | null)[]) => b.append(h("fieldset", {}, h("legend", {}, title), ...kids));

    sec("Audio",
      this.select("Salida", "masterDevice", devOpts, () => app.setMasterDevice(settings.masterDevice).catch((e) => app.toast(String(e), "error")), "Para sacar el sonido por la Platinum FX, elígela aquí (si no aparece el nombre, activa el micro una vez)"),
      this.select("Latencia / buffer", "latency", [["low", "Mínima (~5 ms)"], ["interactive", "Interactiva (recomendada)"], ["balanced", "Equilibrada (~40 ms, si hay cortes)"], ["safe", "Segura (~80 ms)"]], () => app.toast("Se aplica al recargar la app"), `Latencia medida: ${app.latencyMs()} ms (se compensa sola al grabar)`),
      this.num("Ajuste fino de latencia (ms)", "latencyAdjust", -100, 200, 1, () => app.updateComp(), "Si lo grabado cae siempre un poco tarde, sube este valor; si cae pronto, bájalo"),
      this.num("Volumen del clic", "metroVol", 0, 1, 0.05, () => app.setMetroVol(settings.metroVol)),
      this.check("Limitador en el master", "limiter", () => app.setLimiter(settings.limiter)),
      this.select("Fotogramas por segundo", "fps", [["60", "60 fps"], ["30", "30 fps (ahorra CPU)"]]),
    );

    const fxSel = (i: 0 | 1 | 2) => {
      const s = h("select", {});
      for (const f of FX_LIST) s.append(h("option", { value: f.id }, f.name));
      s.value = settings.fxSlots[i];
      s.addEventListener("change", () => { const a = [...settings.fxSlots] as Settings["fxSlots"]; a[i] = s.value; setSetting("fxSlots", a); });
      return h("label", { class: "field" }, h("span", {}, `Botón FX ${i + 1} (Platinum FX)`), s);
    };
    sec("Efectos", fxSel(0), fxSel(1), fxSel(2));

    const mon = h("pre", { class: "monitor" });
    this.monitorEl = mon;
    const btn = h("button", { class: "btn small", onclick: () => { this.midi.monitorOn = true; this.tick(); } }); btn.textContent = "Monitor MIDI";
    const reset = h("button", { class: "btn small", onclick: () => { this.midi.resetMpdMap(); app.toast("Mapeo del MPD218 restablecido"); } }); reset.textContent = "Mapeo MPD218 por defecto";
    const wiz = h("button", { class: "btn small", title: "Si tu MPD218 usa otro preset: pulsa el pad 1 de cada banco y gira cada knob cuando lo pida", onclick: () => { this.midi.mpd.startWizard(); this.el.close(); } }); wiz.textContent = "Aprender MPD218 (asistente)";
    sec("Controladoras MIDI",
      h("p", {}, this.midi.statusLine()),
      this.check("Sysex (pantallas de los platos de la Platinum FX)", "midiSysex", () => app.toast("Se aplica al recargar")),
      this.check("Enviar MIDI clock al MPD218 (Note Repeat a tempo)", "mpdClock", () => this.midi.connect()),
      this.num("Valor LED encendido", "padOnValue", 1, 127, 1),
      this.num("Valor LED apagado", "padOffValue", 0, 127, 1),
      h("div", { class: "row" }, btn, wiz, reset),
      mon,
    );
    b.append(h("p", { class: "ver" }, `CDJ-PI LOOP v${__APP_VERSION__}`));
  }

  private tick(): void {
    if (!this.midi.monitorOn || !this.el.open || !this.monitorEl) return;
    this.monitorEl.textContent = this.midi.monitor.join("\n") || "(toca algo en una controladora)";
    setTimeout(() => this.tick(), 150);
  }
}

export const HELP_HTML = `
<h3>La idea</h3>
<p>Elige un sonido, pulsa el botón grande de una pista, escucha la cuenta atrás (1-2-3-4) y toca: al acabar los compases elegidos el loop se repite solo. Pulsa otra pista y añade otra capa encima. Pulsa la misma pista mientras suena para grabar encima (DUB) y otra vez para dejarla en PLAY.</p>
<table>
<tr><td>Botón de pista</td><td>vacía → REC (en el siguiente compás; si pulsas un pelín tarde cuenta desde el compás que acaba de empezar) · REC libre → cierra el loop · PLAY → DUB · DUB → PLAY · parada → entra en el siguiente compás</td></tr>
<tr><td>1-2-4-8 / LIBRE</td><td>Compases del primer loop de cada pista</td></tr>
<tr><td>→ PLAY / → DUB</td><td>Qué hace la pista al terminar de grabar</td></tr>
<tr><td>↶ ↷ ⇄ ■ ✕</td><td>Deshacer/rehacer la última capa · reverse · parar · borrar</td></tr>
<tr><td>Tempo</td><td>Se fija al grabar el primer loop (para cambiarlo, ✕ TODO). TAP para marcarlo.</td></tr>
<tr><td>FX1 ENTRADA</td><td>Lo que tocas pasa por aquí y se graba con el efecto</td></tr>
<tr><td>FX2 LOOPS</td><td>Efecto sobre todas las pistas (no se graba)</td></tr>
<tr><td>FX de directo</td><td>Sobre todo el master, a tempo: echo/reverb throw, beat repeat, sweeps, gate, crush, tape stop, bass kill, riser…</td></tr>
<tr><td>Micro</td><td>🎤 MICRO + GRABAR = voz, beatbox o guitarra a los loops. Usa auriculares si activas ESCUCHAR.</td></tr>
</table>
<h3>Teclado del ordenador</h3>
<table>
<tr><td>A W S E D F T G Y H U J K O L P</td><td>Piano (como en un DAW) · Z / X = octava</td></tr>
<tr><td>1-8</td><td>Botón de cada pista · Mayús+1-8 = parar · M = modo del MPD218</td></tr>
<tr><td>Espacio · Enter · Retroceso</td><td>Play/Stop · arrancar todas · deshacer en la pista seleccionada</td></tr>
<tr><td>↑ ↓ · ← →</td><td>Preset anterior/siguiente · categoría</td></tr>
</table>
<h3>Akai MPD218</h3>
<p>Dos modos (botón <b>DECK</b> de la Numark, botón «MPD» de arriba o tecla <b>M</b>): <b>BATERÍA</b> (tabla de abajo) o <b>PIANO</b>: los 16 pads tocan el sinte en la escala elegida (banco A octava normal, B una más aguda, C una más grave; elige la escala «Cromática» si quieres todas las notas).</p>
<table>
<tr><td>Banco A</td><td>Batería (16 pads, con velocidad)</td></tr>
<tr><td>Banco B</td><td>Notas del sinte en la escala elegida</td></tr>
<tr><td>Banco C</td><td>Pads 1-8: botón de las pistas 1-8 · pads 9-16: acordes</td></tr>
<tr><td>Knobs A</td><td>Cutoff · resonancia · attack · release · LFO · nivel FX entrada</td></tr>
<tr><td>Knobs B</td><td>Volumen batería · filtro batería · drive · kick decay · kick tune · hat decay</td></tr>
<tr><td>Knobs C</td><td>Filtro master · volumen loops · volumen instrumentos · nivel FX loops · clic · preset</td></tr>
<tr><td>Note Repeat</td><td>NR CONFIG + pad 15 (Ext Clock) una vez → redobles a tempo</td></tr>
</table>
<h3>Numark Mixtrack Platinum FX</h3>
<table>
<tr><td>Pads izquierda (HOT CUE)</td><td>Pistas 1-8 · SHIFT+pad = parar · en otros modos: FX de directo</td></tr>
<tr><td>Pads derecha</td><td>HOT CUE: batería 1-8 · AUTO LOOP: batería 9-16 · FADER CUTS: notas · SAMPLE: acordes</td></tr>
<tr><td>DECK (1/3 ó 2/4)</td><td>MPD218 en modo BATERÍA ↔ PIANO</td></tr>
<tr><td>PLAY · CUE · SYNC</td><td>Play/stop (SHIFT: parar pistas) · metrónomo · tap tempo (SHIFT+SYNC: cuenta atrás)</td></tr>
<tr><td>SCRATCH</td><td>Izq.: tras grabar → PLAY/DUB · der.: grabar micro on/off</td></tr>
<tr><td>CUE auriculares</td><td>FX1 / FX2 on-off</td></tr>
<tr><td>LOAD</td><td>Kit de batería anterior / siguiente</td></tr>
<tr><td>Plato izq. · navegador</td><td>Elegir preset (pulsar el navegador: siguiente categoría)</td></tr>
<tr><td>Plato der.</td><td>Pitch bend del sinte</td></tr>
<tr><td>Knobs canal 1</td><td>Sinte: volumen · cutoff · resonancia · release · LFO</td></tr>
<tr><td>Knobs canal 2</td><td>Batería: volumen · hat decay · tono · kick decay · filtro</td></tr>
<tr><td>Faders</td><td>Izq.: instrumentos · der.: loops · crossfader: filtro master · pitch izq.: cutoff · pitch der.: nivel FX loops</td></tr>
<tr><td>FX</td><td>Unidad 1 = FX de entrada, unidad 2 = FX de loops (palanca, knob y TAP)</td></tr>
<tr><td>LOOP · ½ · ×2</td><td>Deshacer en la pista seleccionada · duración del loop −/+</td></tr>
<tr><td>Pitch bend ◀ ▶</td><td>Octava −/+</td></tr>
</table>`;
