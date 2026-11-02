import type { App } from "../app";
import { PlatinumLoop } from "./platinumfx";
import { Mpd218 } from "./mpd218";
import { MidiClockOut } from "./clock";
import { settings } from "../settings";

const PFX = /platinum\s*fx|mixtrack/i;
const MPD = /mpd\s*2\d\d|mpd/i;

/**
 * Todas las entradas MIDI a la vez: Platinum FX (control del looper),
 * MPD218 (pads/knobs) y cualquier teclado MIDI USB (toca el sinte).
 */
export class MidiManager {
  access: MIDIAccess | null = null;
  sysex = false;
  monitor: string[] = [];
  monitorOn = false;
  pfx: { input: MIDIInput; ctrl: PlatinumLoop } | null = null;
  mpdIn: MIDIInput | null = null;
  readonly mpd: Mpd218;
  private clock: MidiClockOut | null = null;
  keyboards: MIDIInput[] = [];
  error = "";

  constructor(private app: App) { this.mpd = new Mpd218(app); }

  async init(): Promise<void> {
    if (!navigator.requestMIDIAccess) { this.error = "Este navegador no soporta Web MIDI"; return; }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: settings.midiSysex });
      this.sysex = settings.midiSysex;
    } catch {
      try { this.access = await navigator.requestMIDIAccess(); this.sysex = false; }
      catch (e) { this.error = `MIDI denegado: ${(e as Error).message}`; this.app.emit(); return; }
    }
    this.access.onstatechange = () => this.connect();
    this.connect();
  }

  private log(tag: string, data: Uint8Array): void {
    if (!this.monitorOn) return;
    this.monitor.unshift(`${tag}  ${[...data].map((b) => b.toString(16).padStart(2, "0")).join(" ")}`);
    if (this.monitor.length > 40) this.monitor.length = 40;
  }

  connect(): void {
    if (!this.access) return;
    const ins = [...this.access.inputs.values()].filter((i) => i.state === "connected");
    const outs = [...this.access.outputs.values()].filter((o) => o.state === "connected");
    const outFor = (name: string | null) => outs.find((o) => o.name === name) ?? null;

    // ---- Platinum FX
    const pIn = ins.find((i) => PFX.test(i.name ?? ""));
    if (pIn?.id !== this.pfx?.input.id) {
      if (this.pfx) { this.pfx.ctrl.stop(); this.pfx.input.onmidimessage = null; this.pfx = null; }
      if (pIn) {
        const out = outFor(pIn.name);
        const ctrl = new PlatinumLoop(this.app, (d) => { try { out?.send(d); } catch { /* */ } }, this.sysex && !!out);
        pIn.onmidimessage = (e) => { if (e.data) { this.log("PFX", e.data); ctrl.onMessage(e.data); } };
        ctrl.start();
        this.pfx = { input: pIn, ctrl };
        this.app.toast(`Conectada: ${pIn.name}`);
      }
    }

    // ---- MPD218 (+ MIDI clock para su Note Repeat)
    const mIn = ins.find((i) => MPD.test(i.name ?? "") && !PFX.test(i.name ?? ""));
    if (mIn?.id !== this.mpdIn?.id || (!!this.clock) !== (!!mIn && settings.mpdClock)) {
      if (this.mpdIn) this.mpdIn.onmidimessage = null;
      this.clock?.stop(); this.clock = null;
      this.mpdIn = mIn ?? null;
      if (mIn) {
        mIn.onmidimessage = (e) => { if (e.data && e.data[0] < 0xf8) { this.log("MPD", e.data); this.mpd.onMessage(e.data); } };
        const out = outFor(mIn.name);
        if (out && settings.mpdClock) {
          this.clock = new MidiClockOut(this.app.transport, this.app.ctx, (d, ts) => { try { out.send(d, ts); } catch { /* */ } });
          this.clock.start();
        }
        this.app.toast(`Conectado: ${mIn.name}`);
      }
    }

    // ---- cualquier otro dispositivo = teclado MIDI para el sinte
    for (const k of this.keyboards) if (!ins.includes(k)) k.onmidimessage = null;
    this.keyboards = ins.filter((i) => i !== pIn && i !== mIn);
    for (const k of this.keyboards) {
      k.onmidimessage = (e) => {
        const d = e.data;
        if (!d || d[0] >= 0xf0) return;
        this.log("KBD", d);
        const type = d[0] & 0xf0;
        if (type === 0x90 && d[2] > 0) this.app.synth.noteOn(d[1], d[2]);
        else if (type === 0x80 || (type === 0x90 && d[2] === 0)) this.app.synth.noteOff(d[1]);
        else if (type === 0xe0) this.app.synth.setBend((((d[2] << 7) | d[1]) - 8192) / 8192);
        else if (type === 0xb0 && d[1] === 1) this.app.synth.macro.lfo = 1 + d[2] / 64; // rueda de modulación
        else if (type === 0xb0 && d[1] === 74) this.app.synth.macro.cutoff = Math.pow(2, (d[2] / 127 - 0.5) * 6);
        this.app.emit();
      };
    }
    this.app.emit();
  }

  disconnectAll(): void {
    this.pfx?.ctrl.stop();
    this.clock?.stop();
  }

  anyConnected(): boolean { return !!this.pfx || !!this.mpdIn || this.keyboards.length > 0; }

  statusLine(): string {
    if (this.error) return `🎛 ${this.error}`;
    if (!this.access) return "🎛 MIDI sin iniciar";
    const parts = [this.pfx ? "Platinum FX" : "", this.mpdIn ? `MPD218${this.clock ? " ⏱" : ""}` : "", ...this.keyboards.map((k) => k.name ?? "teclado")].filter(Boolean);
    return parts.length ? `🎛 ${parts.join(" · ")}` : "🎛 sin controladoras";
  }

  resetMpdMap(): void { this.mpd.reset(); }
}
