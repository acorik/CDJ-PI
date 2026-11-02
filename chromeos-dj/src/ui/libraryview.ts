import type { App } from "../app";
import type { Track } from "../types";
import { settings } from "../settings";
import { formatKey, keyColor, harmonicDistance } from "../util/key";
import { h, setText, cls, fmtTime } from "./dom";
import { ANALYSIS_VERSION } from "../analysis/analyze";

const ROW_H = 24;
type SortKey = "title" | "artist" | "bpm" | "key" | "duration" | "genre" | "rating" | "playCount" | "addedAt";
type View = { kind: "all" } | { kind: "crate"; id: string } | { kind: "history"; id: string } | { kind: "root"; id: string };

const COLUMNS: { key: SortKey | "color" | "status"; label: string; cls: string }[] = [
  { key: "color", label: "", cls: "c-color" },
  { key: "status", label: "", cls: "c-st" },
  { key: "title", label: "Título", cls: "c-title" },
  { key: "artist", label: "Artista", cls: "c-artist" },
  { key: "bpm", label: "BPM", cls: "c-bpm" },
  { key: "key", label: "Key", cls: "c-key" },
  { key: "duration", label: "Tiempo", cls: "c-time" },
  { key: "genre", label: "Género", cls: "c-genre" },
  { key: "rating", label: "★", cls: "c-rating" },
  { key: "playCount", label: "▶", cls: "c-plays" },
];

const TRACK_COLORS = ["", "#e8384f", "#fd9a00", "#f5d200", "#30c94c", "#21b8c9", "#3a7bff", "#a35cff"];

export class LibraryView {
  readonly el: HTMLElement;
  private side: HTMLElement;
  private scroller: HTMLElement;
  private spacer: HTMLElement;
  private rowsEl: HTMLElement;
  private rows: HTMLElement[] = [];
  private search: HTMLInputElement;
  private info: HTMLElement;
  private compatBtn: HTMLButtonElement;
  private banner: HTMLElement;
  private headerEls: HTMLElement[] = [];
  view: View = { kind: "all" };
  list: Track[] = [];
  sel = 0;
  private sortKey: SortKey | "" = "";
  private sortDir = 1;
  compat: "off" | "on" = "off";
  focus: "list" | "side" = "list";
  private sideItems: { view: View; el: HTMLElement }[] = [];
  private sideSel = 0;
  private dirty = true;
  private renderedKey = "";

  constructor(private app: App) {
    this.side = h("nav", { class: "libside" });
    this.search = h("input", { type: "search", placeholder: "Buscar (título, artista, género, 128, 8A…)", class: "search" });
    this.search.addEventListener("input", () => { this.dirty = true; this.sel = 0; this.refresh(); });
    this.search.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); this.move(e.key === "ArrowDown" ? 1 : -1); }
      if (e.key === "Enter") { e.preventDefault(); this.loadSelected(this.firstFreeDeck()); }
      if (e.key === "Escape") this.search.blur();
    });
    this.compatBtn = h("button", { class: "btn small", title: "Solo pistas compatibles (tonalidad Camelot ±1 y BPM ±tolerancia) con el master", onclick: () => { this.compat = this.compat === "on" ? "off" : "on"; this.dirty = true; this.refresh(); } });
    this.compatBtn.textContent = "♫ COMPATIBLES";
    this.info = h("span", { class: "libinfo" });
    const load = (i: number) => { const b = h("button", { class: "btn small", onclick: () => this.loadSelected(i) }); b.textContent = `→ ${i + 1}`; return b; };
    const analyze = h("button", { class: "btn small", title: "Analiza BPM, tonalidad y waveform de la vista actual", onclick: () => this.app.analyzeBatch(this.list.filter((t) => t.analyzed !== ANALYSIS_VERSION).map((t) => t.id)) });
    analyze.textContent = "ANALIZAR";
    const prep = h("button", { class: "btn small", title: "Añadir a ★ Preparar (shift + push del navegador)", onclick: () => this.addToPrepare() });
    prep.textContent = "+★";
    const toCrate = h("select", { class: "tocrate", title: "Añadir la pista seleccionada a un crate" });
    toCrate.addEventListener("focus", () => {
      toCrate.innerHTML = "";
      toCrate.append(h("option", { value: "" }, "+ crate…"));
      for (const c of this.app.library.crates) toCrate.append(h("option", { value: c.id }, c.name));
    });
    toCrate.append(h("option", { value: "" }, "+ crate…"));
    toCrate.addEventListener("change", () => {
      const t = this.list[this.sel];
      if (toCrate.value && t) { this.app.library.addToCrate(toCrate.value, [t.id]); this.app.toast(`Añadida a ${this.app.library.crates.find((c) => c.id === toCrate.value)?.name}`); }
      toCrate.value = "";
    });
    const removeBtn = h("button", { class: "btn small", title: "Quitar del crate actual", onclick: () => {
      const t = this.list[this.sel];
      if (t && this.view.kind === "crate") { this.app.library.removeFromCrate(this.view.id, [t.id]); this.dirty = true; }
    } });
    removeBtn.textContent = "−";

    this.banner = h("div", { class: "banner hidden" });

    const header = h("div", { class: "lhead" });
    for (const c of COLUMNS) {
      const e = h("div", { class: c.cls, onclick: () => this.sortBy(c.key) }, c.label);
      this.headerEls.push(e);
      header.append(e);
    }
    this.spacer = h("div", { class: "spacer" });
    this.rowsEl = h("div", { class: "lrows" });
    this.scroller = h("div", { class: "lscroll" }, this.spacer, this.rowsEl);
    this.scroller.addEventListener("scroll", () => this.renderRows(true));
    this.rowsEl.addEventListener("click", (e) => {
      const row = (e.target as HTMLElement).closest(".lrow") as HTMLElement | null;
      if (!row) return;
      const idx = Number(row.dataset.i);
      const cell = (e.target as HTMLElement).closest("div[data-c]") as HTMLElement | null;
      const t = this.list[idx];
      if (cell && t) {
        if (cell.dataset.c === "rating") {
          const r = Math.min(5, Math.max(0, Math.ceil(((e as MouseEvent).offsetX / cell.clientWidth) * 5)));
          t.rating = t.rating === r ? 0 : r; this.app.library.saveTrack(t);
        } else if (cell.dataset.c === "color") {
          t.color = TRACK_COLORS[(TRACK_COLORS.indexOf(t.color) + 1) % TRACK_COLORS.length]; this.app.library.saveTrack(t);
        }
      }
      this.sel = idx; this.focus = "list"; this.renderRows(true);
    });
    this.rowsEl.addEventListener("dblclick", () => this.loadSelected(this.firstFreeDeck()));
    this.rowsEl.addEventListener("dragstart", (e) => {
      const row = (e.target as HTMLElement).closest(".lrow") as HTMLElement | null;
      const t = row && this.list[Number(row.dataset.i)];
      if (t) e.dataTransfer?.setData("text/x-track", t.id);
    });

    const fileInput = h("input", { type: "file", multiple: true, accept: "audio/*,.mp3,.m4a,.flac,.wav,.ogg,.opus", class: "hidden", id: "fileInput" });
    fileInput.addEventListener("change", async () => {
      if (fileInput.files?.length) {
        const added = await this.app.library.addFiles(fileInput.files);
        this.app.toast(`${added.length} pistas añadidas (solo esta sesión si tu navegador no permite acceso a carpetas)`);
      }
      fileInput.value = "";
    });
    const dirInput = h("input", { type: "file", class: "hidden", id: "dirInput" }) as HTMLInputElement;
    dirInput.setAttribute("webkitdirectory", "");
    dirInput.addEventListener("change", async () => {
      if (dirInput.files?.length) {
        const added = await this.app.library.addFiles(dirInput.files);
        this.app.toast(`${added.length} pistas cargadas de la carpeta (esta sesión)`);
      }
      dirInput.value = "";
    });
    this.fileInput = fileInput;
    this.dirInput = dirInput;

    this.el = h("section", { class: "library" },
      this.side,
      h("div", { class: "libmain" },
        this.banner,
        h("div", { class: "libbar" }, this.search, this.compatBtn, load(0), load(1), prep, toCrate, removeBtn, analyze, this.info),
        header, this.scroller, fileInput, dirInput,
      ),
    );
    app.library.onChange(() => { this.dirty = true; });
  }
  fileInput: HTMLInputElement;
  dirInput: HTMLInputElement;

  firstFreeDeck(): number {
    const [a, b] = this.app.side;
    const da = this.app.decks[a], db = this.app.decks[b];
    if (!da.loaded) return a;
    if (!db.loaded) return b;
    if (!da.playing) return a;
    if (!db.playing) return b;
    return a;
  }

  async addToPrepare(): Promise<void> {
    const t = this.list[this.sel];
    if (!t) return;
    await this.app.library.addToCrate("prepare", [t.id]);
    this.app.toast(`★ ${t.title}`);
  }

  loadSelected(deck: number): void {
    const t = this.list[this.sel];
    if (!t) return;
    this.app.loadTrack(deck, t);
  }

  move(delta: number): void {
    if (this.focus === "side") {
      this.sideSel = Math.max(0, Math.min(this.sideItems.length - 1, this.sideSel + delta));
      this.setView(this.sideItems[this.sideSel].view);
      return;
    }
    this.sel = Math.max(0, Math.min(this.list.length - 1, this.sel + delta));
    const top = this.sel * ROW_H;
    const st = this.scroller.scrollTop, hh = this.scroller.clientHeight;
    if (top < st) this.scroller.scrollTop = top;
    else if (top + ROW_H > st + hh) this.scroller.scrollTop = top + ROW_H - hh;
    this.renderRows(true);
  }

  setView(v: View): void {
    this.view = v;
    this.sel = 0;
    this.scroller.scrollTop = 0;
    this.dirty = true;
    this.refresh();
  }

  private sortBy(k: SortKey | "color" | "status"): void {
    if (k === "color" || k === "status") return;
    if (this.sortKey === k) this.sortDir = -this.sortDir; else { this.sortKey = k; this.sortDir = 1; }
    this.dirty = true;
    this.refresh();
  }

  private compute(): void {
    const lib = this.app.library;
    let base: Track[];
    const v = this.view;
    if (v.kind === "crate") {
      const c = lib.crates.find((x) => x.id === v.id);
      base = (c?.trackIds ?? []).map((id) => lib.tracks.get(id)).filter((t): t is Track => !!t);
    } else if (v.kind === "history") {
      const s = lib.history.find((x) => x.id === v.id) ?? lib.session;
      base = s.entries.map((e) => lib.tracks.get(e.trackId)).filter((t): t is Track => !!t);
    } else if (v.kind === "root") {
      base = [...lib.tracks.values()].filter((t) => t.rootId === v.id);
    } else base = [...lib.tracks.values()];

    const q = this.search.value.trim().toLowerCase();
    if (q) {
      const toks = q.split(/\s+/);
      base = base.filter((t) => {
        const hay = `${t.title} ${t.artist} ${t.album} ${t.genre} ${t.comment} ${t.bpm ? Math.round(t.bpm) : ""} ${formatKey(t.key, settings.keyNotation)} ${t.name}`.toLowerCase();
        return toks.every((k) => hay.includes(k));
      });
    }
    if (this.compat === "on") {
      const ref = this.app.keyReference(null);
      if (ref?.loaded) {
        const rk = ref.effKey(), rb = ref.effBpm;
        const tol = settings.bpmTolerance / 100;
        base = base.filter((t) => {
          if (rk >= 0 && t.key >= 0 && harmonicDistance(t.key, rk) > 1) return false;
          if (rb > 0 && t.bpm > 0) {
            const ok = [1, 2, 0.5].some((m) => Math.abs(t.bpm * m / rb - 1) <= tol);
            if (!ok) return false;
          }
          return true;
        });
      }
    }
    if (this.sortKey) {
      const k = this.sortKey, dir = this.sortDir;
      base = [...base].sort((a, b) => {
        const va = a[k] as string | number, vb = b[k] as string | number;
        if (typeof va === "string") return va.localeCompare(vb as string) * dir;
        return ((va as number) - (vb as number)) * dir;
      });
    } else if (v.kind === "all" || v.kind === "root") {
      base = [...base].sort((a, b) => (a.artist || "~").localeCompare(b.artist || "~") || a.title.localeCompare(b.title));
    }
    this.list = base;
    if (this.sel >= base.length) this.sel = Math.max(0, base.length - 1);
  }

  private renderSide(): void {
    const lib = this.app.library;
    this.side.innerHTML = "";
    this.sideItems = [];
    const item = (label: string, view: View, extra?: HTMLElement, count?: number) => {
      const active = JSON.stringify(view) === JSON.stringify(this.view);
      const el = h("div", { class: `sitem${active ? " on" : ""}`, onclick: () => { this.sideSel = this.sideItems.findIndex((s) => s.el === el); this.setView(view); } },
        h("span", { class: "slabel" }, label), count !== undefined ? h("span", { class: "scount" }, String(count)) : null, extra ?? null);
      el.addEventListener("dragover", (e) => { if (view.kind === "crate") e.preventDefault(); });
      el.addEventListener("drop", (e) => {
        const id = e.dataTransfer?.getData("text/x-track");
        if (id && view.kind === "crate") { e.preventDefault(); lib.addToCrate(view.id, [id]); }
      });
      if (active) this.sideSel = this.sideItems.length;
      this.sideItems.push({ view, el });
      this.side.append(el);
    };
    const title = (t: string, ...btns: HTMLElement[]) => this.side.append(h("div", { class: "stitle" }, t, ...btns));
    const mini = (label: string, fn: () => void, tip: string) => { const b = h("button", { class: "btn tiny", title: tip, onclick: (e: Event) => { e.stopPropagation(); fn(); } }); b.textContent = label; return b; };

    title("BIBLIOTECA");
    item("Todas las pistas", { kind: "all" }, undefined, lib.tracks.size);
    title("CRATES", mini("+", async () => { const n = prompt("Nombre del crate"); if (n) await lib.createCrate(n); }, "Nuevo crate"));
    for (const c of lib.crates) {
      const ex = c.id === "prepare" ? undefined : h("span", { class: "sbtns" },
        mini("✎", async () => { const n = prompt("Nuevo nombre", c.name); if (n) await lib.renameCrate(c.id, n); }, "Renombrar"),
        mini("✕", async () => { if (confirm(`¿Borrar el crate "${c.name}"? (las pistas no se borran)`)) { await lib.deleteCrate(c.id); this.setView({ kind: "all" }); } }, "Borrar"));
      item(c.name, { kind: "crate", id: c.id }, ex, c.trackIds.length);
    }
    title("HISTORIAL");
    item(`Sesión actual`, { kind: "history", id: lib.session.id }, h("span", { class: "sbtns" }, mini("⤓", () => this.exportHistory(lib.session.id), "Exportar setlist")), lib.session.entries.length);
    for (const s of lib.history.filter((x) => x !== lib.session).slice(0, 12)) {
      item(new Date(s.startedAt).toLocaleDateString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }), { kind: "history", id: s.id },
        h("span", { class: "sbtns" }, mini("⤓", () => this.exportHistory(s.id), "Exportar setlist")), s.entries.length);
    }
    title("CARPETAS",
      lib.hasFsAccess ? mini("+", () => lib.addFolder().catch((e) => { if ((e as Error).name !== "AbortError") this.app.toast((e as Error).message, "error"); }), "Añadir carpeta (USB, SD, Drive…)") : mini("+", () => this.dirInput.click(), "Abrir carpeta (solo esta sesión)"),
      mini("♪", () => this.fileInput.click(), "Añadir archivos sueltos"));
    for (const r of lib.roots.filter((x) => x.kind === "dir")) {
      const need = lib.needsPermission.has(r.id);
      const ex = h("span", { class: "sbtns" },
        need ? mini("⟳", () => lib.reconnect(r.id), "Reconectar (dar permiso)") : mini("↻", () => lib.scanRoot(r), "Re-escanear"),
        mini("✕", async () => { if (confirm(`¿Quitar "${r.name}" de la biblioteca? (no borra archivos)`)) await lib.removeRoot(r.id); }, "Quitar"));
      item(`${need ? "⚠ " : ""}${r.name}`, { kind: "root", id: r.id }, ex, [...lib.tracks.values()].filter((t) => t.rootId === r.id).length);
    }
    const loose = [...lib.tracks.values()].filter((t) => !lib.roots.some((r) => r.id === t.rootId && r.kind === "dir")).length;
    if (loose) item("Archivos sueltos", { kind: "root", id: "session" }, undefined, loose);
  }

  private exportHistory(id: string): void {
    const lib = this.app.library;
    const s = lib.history.find((x) => x.id === id) ?? lib.session;
    const blob = new Blob([lib.historyText(s)], { type: "text/plain" });
    h("a", { href: URL.createObjectURL(blob), download: `setlist-${new Date(s.startedAt).toISOString().slice(0, 10)}.txt` }).click();
  }

  refresh(): void {
    if (this.dirty) {
      this.dirty = false;
      this.compute();
      this.renderSide();
      this.renderedKey = "";
    }
    const lib = this.app.library;
    const need = lib.needsPermission.size;
    const b = this.app.batch, sp = lib.scanProgress;
    let banner = "";
    if (need) banner = `⚠ ${need} carpeta(s) necesitan permiso de nuevo tras reiniciar Chrome.`;
    cls(this.banner, "hidden", !banner);
    if (banner && this.banner.dataset.t !== banner) {
      this.banner.dataset.t = banner;
      this.banner.innerHTML = "";
      const btn = h("button", { class: "btn small", onclick: () => lib.reconnectAll() }); btn.textContent = "RECONECTAR";
      this.banner.append(banner + " ", btn);
    }
    setText(this.info, sp ? `${sp.label}: ${sp.done}/${sp.total}` : b ? `Analizando ${b.done + 1}/${b.total}: ${b.current}` : `${this.list.length} pistas`);
    cls(this.compatBtn, "on", this.compat === "on");
    this.renderRows(false);
  }

  private renderRows(force: boolean): void {
    const n = this.list.length;
    const hh = this.scroller.clientHeight || 300;
    this.spacer.style.height = `${n * ROW_H}px`;
    const first = Math.max(0, Math.floor(this.scroller.scrollTop / ROW_H) - 2);
    const count = Math.ceil(hh / ROW_H) + 5;
    const decks = this.app.decks;
    const loadedIds = decks.map((d) => d.track?.id);
    const played = new Set(this.app.library.session.entries.map((e) => e.trackId));
    const key = `${first}:${count}:${this.sel}:${n}:${loadedIds.join(",")}:${played.size}:${settings.keyNotation}`;
    if (!force && key === this.renderedKey) return;
    this.renderedKey = key;
    while (this.rows.length < count) {
      const r = h("div", { class: "lrow", draggable: "true" });
      for (const c of COLUMNS) r.append(h("div", { class: c.cls, "data-c": c.key }));
      this.rowsEl.append(r);
      this.rows.push(r);
    }
    for (let k = 0; k < this.rows.length; k++) {
      const r = this.rows[k];
      const idx = first + k;
      const t = this.list[idx];
      if (!t || k >= count) { r.style.display = "none"; continue; }
      r.style.display = "";
      r.style.transform = `translateY(${idx * ROW_H}px)`;
      r.dataset.i = String(idx);
      cls(r, "sel", idx === this.sel);
      cls(r, "focus", idx === this.sel && this.focus === "list");
      cls(r, "played", played.has(t.id));
      cls(r, "missing", !this.app.library.isAvailable(t));
      const cells = r.children as HTMLCollectionOf<HTMLElement>;
      cells[0].style.background = t.color || "transparent";
      const dk = loadedIds.indexOf(t.id);
      setText(cells[1], dk >= 0 ? String(dk + 1) : played.has(t.id) ? "✓" : "");
      setText(cells[2], t.title);
      setText(cells[3], t.artist);
      setText(cells[4], t.bpm ? t.bpm.toFixed(t.bpm % 1 ? 1 : 0) : "—");
      setText(cells[5], formatKey(t.key, settings.keyNotation));
      cells[5].style.color = t.key >= 0 ? keyColor(t.key) : "";
      setText(cells[6], t.duration ? fmtTime(t.duration, false) : "");
      setText(cells[7], t.genre);
      setText(cells[8], "★★★★★".slice(0, t.rating) + "·····".slice(t.rating));
      setText(cells[9], t.playCount ? String(t.playCount) : "");
    }
    this.headerEls.forEach((e, i) => cls(e, "sorted", COLUMNS[i].key === this.sortKey));
  }

  // ---- navegador desde la controladora
  browse(delta: number, shift: boolean): void {
    if (shift) { this.focus = "side"; this.move(delta); this.focus = "list"; return; }
    this.move(delta);
  }

  browsePush(shift: boolean): void {
    if (shift) { void this.addToPrepare(); return; }
    this.focus = this.focus === "list" ? "side" : "list";
    if (this.focus === "side") this.app.toast("Navegador: carpetas/crates (gira para elegir, pulsa para volver a la lista)");
    this.renderRows(true);
  }
}
