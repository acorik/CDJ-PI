export interface HotCue {
  /** segundos */
  pos: number;
  color: string;
  label?: string;
  /** si existe, es un loop guardado (CDJ "saved loop") */
  loopEnd?: number;
}

export interface MemoryCue {
  pos: number;
  label?: string;
  loopEnd?: number;
}

export interface CueData {
  main: number | null;
  hot: (HotCue | null)[];
  memory: MemoryCue[];
}

export interface BeatGrid {
  bpm: number;
  /** segundo del primer beat */
  firstBeat: number;
  /** 0..3 -> qué beat es el "1" del compás */
  downbeat: number;
}

export interface Track {
  id: string;
  rootId: string;
  path: string;
  name: string;
  size: number;
  mtime: number;
  title: string;
  artist: string;
  album: string;
  genre: string;
  year: string;
  comment: string;
  tagBpm: number;
  tagKey: string;
  duration: number;
  bpm: number;
  key: number;
  grid: BeatGrid | null;
  loudness: number | null;
  firstSound: number;
  rating: number;
  color: string;
  playCount: number;
  lastPlayed: number;
  addedAt: number;
  analyzed: number; // versión del análisis, 0 = sin analizar
  cues: CueData;
}

export interface Crate {
  id: string;
  name: string;
  trackIds: string[];
}

export interface HistoryEntry {
  trackId: string;
  title: string;
  artist: string;
  bpm: number;
  key: number;
  deck: number;
  at: number;
}

export interface HistorySession {
  id: string;
  startedAt: number;
  entries: HistoryEntry[];
}

export const HOTCUE_COLORS = ["#e8384f", "#fd9a00", "#f5d200", "#30c94c", "#21b8c9", "#3a7bff", "#a35cff", "#ff5fb0"];

export function emptyCues(): CueData {
  return { main: null, hot: new Array(8).fill(null), memory: [] };
}
