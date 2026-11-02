import type { KeyNotation } from "./util/key";

export type OutputMode = "multi" | "split" | "dual" | "master";
export type WaveColors = "rgb" | "3band" | "blue";
export type XfaderCurve = "smooth" | "sharp" | "thru";

export interface Settings {
  outputMode: OutputMode;
  masterDevice: string;
  cueDevice: string;
  latency: "low" | "interactive" | "balanced" | "safe";
  tempoRange: number;
  keylockDefault: boolean;
  quantize: boolean;
  quantizeBeats: number;
  minBpm: number;
  keyNotation: KeyNotation;
  waveColors: WaveColors;
  waveZoom: number;
  autoCue: boolean;
  autoGain: boolean;
  gainTarget: number;
  limiter: boolean;
  loadLock: boolean;
  needleLock: boolean;
  faderStart: boolean;
  xfaderCurve: XfaderCurve;
  jogSensitivity: number;
  invertPitch: boolean;
  vinylDefault: boolean;
  startTime: number;
  brakeTime: number;
  fxSlots: [string, string, string];
  fps: 60 | 30;
  timeRemaining: boolean;
  midiSysex: boolean;
  bpmTolerance: number;
  libraryBig: boolean;
  fourDecks: boolean;
  padOnValue: number;
  padOffValue: number;
  mpdClock: boolean;
  view: "library" | "live";
}

export const DEFAULTS: Settings = {
  outputMode: "multi",
  masterDevice: "",
  cueDevice: "",
  latency: "interactive",
  tempoRange: 8,
  keylockDefault: false,
  quantize: true,
  quantizeBeats: 1,
  minBpm: 88,
  keyNotation: "camelot",
  waveColors: "rgb",
  waveZoom: 1,
  autoCue: true,
  autoGain: true,
  gainTarget: -9,
  limiter: true,
  loadLock: true,
  needleLock: false,
  faderStart: false,
  xfaderCurve: "smooth",
  jogSensitivity: 1,
  invertPitch: false,
  vinylDefault: true,
  startTime: 0,
  brakeTime: 0,
  fxSlots: ["echo", "reverb", "flanger"],
  fps: 60,
  timeRemaining: true,
  midiSysex: true,
  bpmTolerance: 6,
  libraryBig: false,
  fourDecks: false,
  padOnValue: 0x7f,
  padOffValue: 0x01,
  mpdClock: true,
  view: "library",
};

const KEY = "cdjpi-dj-settings";
type Listener = (s: Settings, changed: keyof Settings) => void;
const listeners: Listener[] = [];

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* storage bloqueado: defaults */ }
  return { ...DEFAULTS };
}

export const settings: Settings = load();

export function setSetting<K extends keyof Settings>(k: K, v: Settings[K]): void {
  settings[k] = v;
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ }
  for (const l of listeners) l(settings, k);
}

export function onSettings(l: Listener): void {
  listeners.push(l);
}

export function latencyHint(): AudioContextLatencyCategory | number {
  switch (settings.latency) {
    case "low": return 0.005;
    case "balanced": return 0.04;
    case "safe": return 0.08;
    default: return "interactive";
  }
}
