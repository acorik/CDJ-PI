import { App } from "./app";
import { MidiManager } from "./midi/midi";
import { UI } from "./ui/ui";
import { onSettings } from "./settings";
import { PRESETS } from "./synth/presets";
import { PlatinumLoop } from "./midi/platinumfx";

const splash = document.getElementById("splash")!;
const startBtn = document.getElementById("startBtn") as HTMLButtonElement;
const msg = document.getElementById("splashMsg")!;

if (!("AudioWorkletNode" in window)) msg.textContent = "Este navegador no soporta AudioWorklet: usa Chrome actualizado.";

async function start(): Promise<void> {
  startBtn.disabled = true;
  startBtn.textContent = "Arrancando…";
  try {
    const app = new App();
    await app.init();
    await app.ctx.resume();
    const midi = new MidiManager(app);
    const ui = new UI(app, midi, document.getElementById("root")!);
    onSettings(() => app.emit());
    splash.remove();
    void midi.init().then(() => app.emit());
    const resume = () => { if (app.ctx.state !== "running") app.ctx.resume().then(() => app.emit()); };
    document.addEventListener("pointerdown", resume);
    document.addEventListener("keydown", resume);
    // la latencia de salida puede conocerse un poco después de arrancar
    setTimeout(() => app.updateComp(), 1000);
    window.addEventListener("beforeunload", (e) => {
      midi.disconnectAll();
      if (app.looper.hasContent) { e.preventDefault(); e.returnValue = ""; }
    });
    // acceso para depurar desde la consola / tests
    (window as any).__loop = { app, midi, ui, presets: PRESETS, PlatinumLoop };
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
