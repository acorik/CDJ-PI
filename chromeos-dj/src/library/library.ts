import { dbAll, dbDelete, dbGet, dbPut, dbPutMany } from "./db";
import { readTags, tagsFromFilename } from "./tags";
import { parseKeyTag } from "../util/key";
import type { Crate, HistoryEntry, HistorySession, Track } from "../types";
import { emptyCues } from "../types";

export const AUDIO_EXT = /\.(mp3|m4a|aac|mp4|wav|flac|ogg|oga|opus|webm)$/i;

export interface Root {
  id: string;
  name: string;
  kind: "dir" | "file" | "session";
  handle?: FileSystemHandle;
  addedAt: number;
}

type Listener = () => void;

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export class Library {
  tracks = new Map<string, Track>();
  roots: Root[] = [];
  crates: Crate[] = [];
  history: HistorySession[] = [];
  session: HistorySession = { id: uid(), startedAt: Date.now(), entries: [] };
  /** Archivos accesibles solo durante esta sesión (input de archivos / sin FSA). */
  private sessionFiles = new Map<string, File>();
  /** Raíces cuyo permiso hay que volver a pedir (tras reiniciar el navegador). */
  needsPermission = new Set<string>();
  private listeners: Listener[] = [];
  private saveTimers = new Map<string, number>();
  scanProgress: { done: number; total: number; label: string } | null = null;

  onChange(l: Listener): void { this.listeners.push(l); }
  emit(): void { for (const l of this.listeners) l(); }

  async init(): Promise<void> {
    const [tracks, roots, crates, history] = await Promise.all([
      dbAll<Track>("tracks"), dbAll<Root>("roots"), dbAll<Crate>("crates"), dbAll<HistorySession>("history"),
    ]);
    for (const t of tracks) this.tracks.set(t.id, t);
    this.roots = roots.filter((r) => r.kind !== "session");
    this.crates = crates.sort((a, b) => a.name.localeCompare(b.name));
    this.history = history.sort((a, b) => b.startedAt - a.startedAt);
    if (!this.crates.some((c) => c.id === "prepare")) {
      this.crates.unshift({ id: "prepare", name: "★ Preparar", trackIds: [] });
    }
    for (const r of this.roots) {
      const h = r.handle as any;
      if (h?.queryPermission) {
        try {
          const st = await h.queryPermission({ mode: "read" });
          if (st !== "granted") this.needsPermission.add(r.id);
        } catch { this.needsPermission.add(r.id); }
      }
    }
    this.emit();
  }

  get hasFsAccess(): boolean {
    return typeof (window as any).showDirectoryPicker === "function";
  }

  // ------------------------------------------------------------- carpetas
  async addFolder(): Promise<void> {
    const dir: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker({ id: "music", mode: "read" });
    const existing = await this.findSameRoot(dir);
    const root: Root = existing ?? { id: uid(), name: dir.name, kind: "dir", handle: dir, addedAt: Date.now() };
    if (!existing) {
      this.roots.push(root);
      await dbPut("roots", root.id, root);
    }
    this.needsPermission.delete(root.id);
    await this.scanRoot(root);
  }

  private async findSameRoot(h: FileSystemHandle): Promise<Root | undefined> {
    for (const r of this.roots) {
      try { if (r.handle && (await (r.handle as any).isSameEntry(h))) return r; } catch { /* */ }
    }
    return undefined;
  }

  async reconnect(rootId: string): Promise<boolean> {
    const r = this.roots.find((x) => x.id === rootId);
    const h = r?.handle as any;
    if (!h?.requestPermission) return false;
    const st = await h.requestPermission({ mode: "read" });
    if (st === "granted") { this.needsPermission.delete(rootId); this.emit(); return true; }
    return false;
  }

  async reconnectAll(): Promise<void> {
    for (const id of [...this.needsPermission]) await this.reconnect(id);
  }

  async removeRoot(rootId: string): Promise<void> {
    this.roots = this.roots.filter((r) => r.id !== rootId);
    await dbDelete("roots", rootId);
    for (const t of [...this.tracks.values()]) {
      if (t.rootId === rootId) { this.tracks.delete(t.id); await dbDelete("tracks", t.id); await dbDelete("waves", t.id); }
    }
    this.emit();
  }

  async scanRoot(root: Root): Promise<void> {
    if (root.kind !== "dir" || !root.handle) return;
    const found: { path: string; handle: FileSystemFileHandle }[] = [];
    this.scanProgress = { done: 0, total: 0, label: `Buscando en ${root.name}…` };
    this.emit();
    const walk = async (dir: FileSystemDirectoryHandle, prefix: string, depth: number) => {
      if (depth > 12) return;
      for await (const [name, h] of (dir as any).entries() as AsyncIterable<[string, FileSystemHandle]>) {
        if (name.startsWith(".")) continue;
        if (h.kind === "directory") await walk(h as FileSystemDirectoryHandle, `${prefix}${name}/`, depth + 1);
        else if (AUDIO_EXT.test(name)) found.push({ path: prefix + name, handle: h as FileSystemFileHandle });
      }
    };
    await walk(root.handle as FileSystemDirectoryHandle, "", 0);
    this.scanProgress = { done: 0, total: found.length, label: `Leyendo etiquetas (${root.name})` };
    const batch: [string, unknown][] = [];
    const seen = new Set<string>();
    for (const f of found) {
      const id = `${root.id}:${f.path}`;
      seen.add(id);
      try {
        const file = await f.handle.getFile();
        await this.upsertFromFile(id, root.id, f.path, file, batch);
      } catch { /* archivo ilegible: se ignora */ }
      this.scanProgress.done++;
      if (batch.length >= 50) { await dbPutMany("tracks", batch.splice(0)); this.emit(); }
    }
    await dbPutMany("tracks", batch);
    // pistas que ya no existen en la carpeta
    for (const t of [...this.tracks.values()]) {
      if (t.rootId === root.id && !seen.has(t.id)) { this.tracks.delete(t.id); await dbDelete("tracks", t.id); }
    }
    this.scanProgress = null;
    this.emit();
  }

  private async upsertFromFile(id: string, rootId: string, path: string, file: File, batch: [string, unknown][]): Promise<Track> {
    const prev = this.tracks.get(id);
    if (prev && prev.size === file.size && prev.mtime === file.lastModified) return prev;
    const tags = { ...tagsFromFilename(file.name), ...(await readTags(file).catch(() => ({}))) };
    const t: Track = {
      id, rootId, path, name: file.name, size: file.size, mtime: file.lastModified,
      title: tags.title || file.name, artist: tags.artist || "", album: tags.album || "",
      genre: tags.genre || "", year: tags.year || "", comment: tags.comment || "",
      tagBpm: tags.bpm || 0, tagKey: tags.key || "",
      duration: prev?.duration ?? 0,
      bpm: prev?.bpm ?? (tags.bpm || 0),
      key: prev?.key ?? (tags.key ? parseKeyTag(tags.key) : -1),
      grid: prev && prev.size === file.size ? prev.grid : null,
      loudness: prev?.loudness ?? null,
      firstSound: prev?.firstSound ?? 0,
      rating: prev?.rating ?? 0,
      color: prev?.color ?? "",
      playCount: prev?.playCount ?? 0,
      lastPlayed: prev?.lastPlayed ?? 0,
      addedAt: prev?.addedAt ?? Date.now(),
      analyzed: prev && prev.size === file.size ? prev.analyzed : 0,
      cues: prev?.cues ?? emptyCues(),
    };
    this.tracks.set(id, t);
    batch.push([id, t]);
    return t;
  }

  /** Archivos sueltos: input de archivos, drag & drop o modo sin File System Access. */
  async addFiles(files: File[] | FileList, handles?: (FileSystemFileHandle | null)[]): Promise<Track[]> {
    const out: Track[] = [];
    const batch: [string, unknown][] = [];
    const arr = Array.from(files);
    for (let i = 0; i < arr.length; i++) {
      const file = arr[i];
      if (!AUDIO_EXT.test(file.name)) continue;
      const handle = handles?.[i] ?? null;
      let rootId = "session";
      if (handle) {
        const existing = await this.findSameRoot(handle);
        if (existing) rootId = existing.id;
        else {
          const r: Root = { id: uid(), name: file.name, kind: "file", handle, addedAt: Date.now() };
          this.roots.push(r);
          await dbPut("roots", r.id, r);
          rootId = r.id;
        }
      }
      const rel = (file as any).webkitRelativePath || file.name;
      const id = rootId === "session" ? `session:${rel}:${file.size}` : `${rootId}:${file.name}`;
      // reutiliza análisis/cues si ya conocíamos esta pista (mismo nombre y tamaño)
      if (rootId === "session" && !this.tracks.has(id)) {
        const twin = [...this.tracks.values()].find((t) => t.name === file.name && t.size === file.size);
        if (twin) { this.sessionFiles.set(twin.id, file); out.push(twin); continue; }
      }
      if (rootId === "session") this.sessionFiles.set(id, file);
      out.push(await this.upsertFromFile(id, rootId, rel, file, batch));
    }
    await dbPutMany("tracks", batch);
    this.emit();
    return out;
  }

  async getFile(t: Track): Promise<File> {
    const s = this.sessionFiles.get(t.id);
    if (s) return s;
    const root = this.roots.find((r) => r.id === t.rootId);
    if (!root?.handle) throw new Error("Archivo no disponible en esta sesión: vuelve a añadir la carpeta o el archivo.");
    if (this.needsPermission.has(root.id)) {
      const ok = await this.reconnect(root.id);
      if (!ok) throw new Error(`Sin permiso para leer "${root.name}". Pulsa "Reconectar".`);
    }
    if (root.kind === "file") return (root.handle as FileSystemFileHandle).getFile();
    let dir = root.handle as FileSystemDirectoryHandle;
    const parts = t.path.split("/");
    for (let i = 0; i < parts.length - 1; i++) dir = await dir.getDirectoryHandle(parts[i]);
    const fh = await dir.getFileHandle(parts[parts.length - 1]);
    return fh.getFile();
  }

  isAvailable(t: Track): boolean {
    if (this.sessionFiles.has(t.id)) return true;
    const r = this.roots.find((x) => x.id === t.rootId);
    return !!r?.handle;
  }

  // ------------------------------------------------------------- guardado
  saveTrack(t: Track, immediate = false): void {
    const prev = this.saveTimers.get(t.id);
    if (prev) clearTimeout(prev);
    const run = () => { this.saveTimers.delete(t.id); dbPut("tracks", t.id, t).catch(() => {}); };
    if (immediate) run();
    else this.saveTimers.set(t.id, window.setTimeout(run, 600));
  }

  async getWave(id: string): Promise<Uint8Array | undefined> {
    return dbGet<Uint8Array>("waves", id);
  }

  async putWave(id: string, wf: Uint8Array): Promise<void> {
    await dbPut("waves", id, wf);
  }

  // ------------------------------------------------------------- crates
  async createCrate(name: string): Promise<Crate> {
    const c: Crate = { id: uid(), name, trackIds: [] };
    this.crates.push(c);
    await dbPut("crates", c.id, c);
    this.emit();
    return c;
  }

  async renameCrate(id: string, name: string): Promise<void> {
    const c = this.crates.find((x) => x.id === id);
    if (!c) return;
    c.name = name;
    await dbPut("crates", c.id, c);
    this.emit();
  }

  async deleteCrate(id: string): Promise<void> {
    if (id === "prepare") return;
    this.crates = this.crates.filter((c) => c.id !== id);
    await dbDelete("crates", id);
    this.emit();
  }

  async addToCrate(id: string, trackIds: string[]): Promise<void> {
    const c = this.crates.find((x) => x.id === id);
    if (!c) return;
    for (const t of trackIds) if (!c.trackIds.includes(t)) c.trackIds.push(t);
    await dbPut("crates", c.id, c);
    this.emit();
  }

  async removeFromCrate(id: string, trackIds: string[]): Promise<void> {
    const c = this.crates.find((x) => x.id === id);
    if (!c) return;
    c.trackIds = c.trackIds.filter((t) => !trackIds.includes(t));
    await dbPut("crates", c.id, c);
    this.emit();
  }

  // ------------------------------------------------------------- historial
  logPlay(t: Track, deck: number): void {
    const e: HistoryEntry = { trackId: t.id, title: t.title, artist: t.artist, bpm: t.bpm, key: t.key, deck, at: Date.now() };
    const last = this.session.entries[this.session.entries.length - 1];
    if (last && last.trackId === t.id) return;
    this.session.entries.push(e);
    if (!this.history.includes(this.session)) this.history.unshift(this.session);
    t.playCount++;
    t.lastPlayed = Date.now();
    this.saveTrack(t);
    dbPut("history", this.session.id, this.session).catch(() => {});
    this.emit();
  }

  historyText(s: HistorySession): string {
    const d = new Date(s.startedAt);
    const lines = [`Sesión ${d.toLocaleString()}`, ""];
    s.entries.forEach((e, i) => {
      const tm = new Date(e.at).toLocaleTimeString().slice(0, 5);
      lines.push(`${String(i + 1).padStart(2, "0")}. [${tm}] ${e.artist ? e.artist + " - " : ""}${e.title}${e.bpm ? ` (${e.bpm.toFixed(1)} BPM)` : ""}`);
    });
    return lines.join("\n");
  }

  // ------------------------------------------------------------- backup
  /** Exporta biblioteca (sin audio): cues, grids, análisis, crates, historial. */
  exportJson(): string {
    return JSON.stringify({
      app: "cdj-pi-dj", version: 1, exportedAt: Date.now(),
      tracks: [...this.tracks.values()], crates: this.crates, history: this.history,
    });
  }

  async importJson(text: string): Promise<number> {
    const data = JSON.parse(text);
    if (data?.app !== "cdj-pi-dj") throw new Error("Archivo de backup no válido");
    let n = 0;
    const batch: [string, unknown][] = [];
    for (const t of data.tracks as Track[]) {
      // empareja por id o por nombre+tamaño (otra carpeta/otro ordenador)
      let local = this.tracks.get(t.id) ?? [...this.tracks.values()].find((x) => x.name === t.name && x.size === t.size);
      if (!local) continue;
      local.cues = t.cues; local.grid = t.grid; local.bpm = t.bpm; local.key = t.key;
      local.rating = t.rating; local.color = t.color; local.playCount = Math.max(local.playCount, t.playCount);
      batch.push([local.id, local]);
      n++;
    }
    await dbPutMany("tracks", batch);
    for (const c of data.crates as Crate[]) {
      if (!this.crates.some((x) => x.id === c.id)) { this.crates.push(c); await dbPut("crates", c.id, c); }
    }
    this.emit();
    return n;
  }
}
