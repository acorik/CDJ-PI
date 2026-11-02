export interface Settings {
  masterDevice: string;
  latency: "low" | "interactive" | "balanced" | "safe";
  /** ajuste fino de la compensación de latencia (ms, + = grabar más adelantado) */
  latencyAdjust: number;
  bpm: number;
  loopBars: number; // 0 = libre
  afterRec: "play" | "dub";
  countIn: boolean;
  metronome: boolean;
  metroVol: number;
  root: number;
  scale: string;
  octave: number;
  chordSize: 3 | 4;
  presetName: string;
  kit: number;
  micRec: boolean;
  micMonitor: boolean;
  midiSysex: boolean;
  mpdClock: boolean;
  padOnValue: number;
  padOffValue: number;
  limiter: boolean;
  fps: 60 | 30;
  fxSlots: [string, string, string];
  /** MPD218: pads como batería (A batería · B notas · C pistas/acordes) o todos como piano */
  mpdMode: "drums" | "piano";
}

export const DEFAULTS: Settings = {
  masterDevice: "",
  latency: "interactive",
  latencyAdjust: 0,
  bpm: 90,
  loopBars: 2,
  afterRec: "play",
  countIn: true,
  metronome: true,
  metroVol: 0.5,
  root: 9, // La
  scale: "minor",
  octave: 4,
  chordSize: 4,
  presetName: "Rhodes Soft",
  kit: 2,
  micRec: false,
  micMonitor: false,
  midiSysex: true,
  mpdClock: true,
  padOnValue: 0x7f,
  padOffValue: 0x01,
  limiter: true,
  fps: 60,
  fxSlots: ["echo", "reverb", "filter"],
  mpdMode: "drums",
};

const KEY = "cdjpi-loop-settings";
type Listener = (s: Settings, changed: keyof Settings) => void;
const listeners: Listener[] = [];

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* storage bloqueado */ }
  return { ...DEFAULTS };
}

export const settings: Settings = load();

export function setSetting<K extends keyof Settings>(k: K, v: Settings[K]): void {
  settings[k] = v;
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* */ }
  for (const l of listeners) l(settings, k);
}

export function onSettings(l: Listener): void { listeners.push(l); }

export function latencyHint(): AudioContextLatencyCategory | number {
  switch (settings.latency) {
    case "low": return 0.005;
    case "balanced": return 0.04;
    case "safe": return 0.08;
    default: return "interactive";
  }
}
