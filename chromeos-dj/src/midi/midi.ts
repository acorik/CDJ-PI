import type { App } from "../app";
import { PlatinumFX } from "./platinumfx";
import { settings } from "../settings";

const MATCH = /platinum\s*fx|mixtrack/i;

export class MidiManager {
  access: MIDIAccess | null = null;
  input: MIDIInput | null = null;
  output: MIDIOutput | null = null;
  ctrl: PlatinumFX | null = null;
  status = "sin MIDI";
  sysex = false;
  monitor: string[] = [];
  monitorOn = false;
  /** id de entrada forzado por el usuario (si el nombre no coincide) */
  forcedInput = "";

  constructor(private app: App) {}

  async init(): Promise<void> {
    if (!navigator.requestMIDIAccess) { this.status = "Este navegador no soporta Web MIDI"; return; }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: settings.midiSysex });
      this.sysex = settings.midiSysex;
    } catch {
      try {
        this.access = await navigator.requestMIDIAccess();
        this.sysex = false;
      } catch (e) {
        this.status = `MIDI denegado: ${(e as Error).message}`;
        this.app.emit();
        return;
      }
    }
    this.access.onstatechange = () => this.connect();
    this.connect();
  }

  inputs(): MIDIInput[] {
    return this.access ? [...this.access.inputs.values()] : [];
  }

  connect(): void {
    if (!this.access) return;
    const ins = this.inputs().filter((i) => i.state === "connected");
    const input = ins.find((i) => i.id === this.forcedInput) ?? ins.find((i) => MATCH.test(i.name ?? ""));
    if (input && this.input?.id === input.id && this.ctrl) return;
    this.disconnect();
    if (!input) {
      this.status = ins.length ? `Controladora no reconocida (${ins.map((i) => i.name).join(", ")})` : "Conecta la Mixtrack Platinum FX por USB";
      this.app.emit();
      return;
    }
    const outs = [...this.access.outputs.values()].filter((o) => o.state === "connected");
    const output = outs.find((o) => o.name === input.name) ?? outs.find((o) => MATCH.test(o.name ?? "")) ?? null;
    this.input = input;
    this.output = output;
    const send = (data: number[]) => {
      if (!this.output) return;
      try { this.output.send(data); } catch { /* sysex sin permiso, etc. */ }
    };
    this.ctrl = new PlatinumFX(this.app, send, this.sysex);
    this.app.midi = this.ctrl;
    input.onmidimessage = (e: MIDIMessageEvent) => {
      const data = e.data;
      if (!data) return;
      if (this.monitorOn) {
        this.monitor.unshift([...data].map((b) => b.toString(16).padStart(2, "0")).join(" "));
        if (this.monitor.length > 40) this.monitor.length = 40;
      }
      this.ctrl?.onMessage(data);
    };
    this.ctrl.start();
    this.status = `${input.name}${output ? "" : " (sin salida: LEDs/pantallas apagados)"}${this.sysex ? "" : " · sin sysex"}`;
    this.app.toast(`Controladora conectada: ${input.name}`);
    this.app.emit();
  }

  disconnect(): void {
    if (this.ctrl) { try { this.ctrl.stop(); } catch { /* */ } }
    if (this.input) this.input.onmidimessage = null;
    this.ctrl = null;
    this.app.midi = null;
    this.input = null;
    this.output = null;
  }

  /** Inyecta un mensaje como si viniera de la controladora (tests / modo demo). */
  inject(bytes: number[]): void {
    if (!this.ctrl) {
      this.ctrl = new PlatinumFX(this.app, () => {}, false);
      this.app.midi = this.ctrl;
    }
    this.ctrl.onMessage(new Uint8Array(bytes));
  }
}
