import { App } from "./app";
import { MidiManager } from "./midi/midi";
import { UI } from "./ui/ui";
import { onSettings } from "./settings";

const splash = document.getElementById("splash")!;
const startBtn = document.getElementById("startBtn") as HTMLButtonElement;
const msg = document.getElementById("splashMsg")!;

function supportCheck(): string[] {
  const miss: string[] = [];
  if (!("AudioWorkletNode" in window)) miss.push("AudioWorklet");
  if (!navigator.requestMIDIAccess) miss.push("Web MIDI (la controladora no funcionará)");
  if (typeof (window as any).showDirectoryPicker !== "function") miss.push("acceso a carpetas (se usará selección de archivos por sesión)");
  return miss;
}

const missing = supportCheck();
if (missing.length) msg.textContent = `Aviso: este navegador no soporta ${missing.join(", ")}. Usa Chrome actualizado en ChromeOS.`;

async function start(): Promise<void> {
  startBtn.disabled = true;
  startBtn.textContent = "Arrancando…";
  try {
    const app = new App();
    await app.init();
    await app.engine.ctx.resume();
    const midi = new MidiManager(app);
    const ui = new UI(app, midi, document.getElementById("root")!);
    onSettings(() => app.emit());
    splash.remove();
    void midi.init().then(() => app.emit());
    // el audio puede quedar suspendido si Chrome lo pausa: se reanuda con cualquier interacción
    const resume = () => { if (app.engine.ctx.state !== "running") app.engine.ctx.resume().then(() => app.emit()); };
    document.addEventListener("pointerdown", resume);
    document.addEventListener("keydown", resume);
    app.engine.ctx.addEventListener("statechange", () => app.emit());
    window.addEventListener("beforeunload", (e) => {
      midi.disconnect();
      if (app.decks.some((d) => d.playing)) { e.preventDefault(); e.returnValue = ""; }
    });
    (window as any).__dj = { app, midi, ui };
  } catch (e) {
    console.error(e);
    startBtn.disabled = false;
    startBtn.textContent = "Reintentar";
    msg.textContent = `No se pudo arrancar el audio: ${(e as Error).message}`;
  }
}

startBtn.addEventListener("click", () => void start());

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
