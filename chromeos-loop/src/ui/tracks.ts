import type { App } from "../app";
import { NTRACKS, type TrackState } from "../looper/looper";
import { h, setText, cls, css, fitCanvas } from "./dom";

export const TRACK_COLORS = ["#ff4d6d", "#ff9f1c", "#ffd23f", "#3ddc97", "#21b8c9", "#4d8dff", "#a06cff", "#ff5fd2"];

const LABEL: Record<TrackState, string> = {
  empty: "REC", armed: "ESPERA", rec: "● REC", play: "PLAY", dub: "DUB", stopped: "PARADO", playArmed: "ENTRA…", stopArmed: "SALE…",
};

const STATE_COLOR: Record<TrackState, string> = {
  empty: "#3a3f48", armed: "#ff3b3b", rec: "#ff3b3b", play: "#3ddc97", dub: "#ff9f1c", stopped: "#596170", playArmed: "#3ddc97", stopArmed: "#3ddc97",
};

/** Las 8 pistas del looper. */
export class TracksView {
  readonly el: HTMLElement;
  private cards: { root: HTMLElement; btn: HTMLCanvasElement; wave: HTMLCanvasElement; label: HTMLElement; bars: HTMLElement; undo: HTMLButtonElement; redo: HTMLButtonElement; rev: HTMLButtonElement; vol: HTMLInputElement }[] = [];

  constructor(private app: App) {
    this.el = h("section", { class: "tracks" });
    for (let i = 0; i < NTRACKS; i++) {
      const L = () => app.looper;
      const b = (label: string, title: string, fn: () => void) => { const e = h("button", { class: "btn tiny", title, onclick: () => fn() }); e.textContent = label; return e; };
      const btn = h("canvas", { class: "tbtn", title: `Pista ${i + 1}: REC → PLAY/DUB → … (tecla ${i + 1})` });
      btn.addEventListener("pointerdown", (e) => { e.preventDefault(); L().press(i); });
      const wave = h("canvas", { class: "twave" });
      const label = h("div", { class: "tstate" });
      const bars = h("span", { class: "tbars" });
      const undo = b("↶", "Deshacer la última capa (overdub)", () => L().undo(i));
      const redo = b("↷", "Rehacer", () => L().redo(i));
      const rev = b("⇄", "Reverse", () => L().toggleRev(i));
      const vol = h("input", { type: "range", min: "0", max: "1.2", step: "0.01", class: "tvol", title: "Volumen de la pista" }) as HTMLInputElement;
      vol.value = "0.9";
      vol.addEventListener("input", () => L().setVol(i, parseFloat(vol.value)));
      const root = h("div", { class: "track" },
        h("div", { class: "thead" }, h("b", {}, String(i + 1)), label, bars),
        btn, wave,
        h("div", { class: "tbtns" }, b("■", "Parar pista (Mayús+número)", () => L().stop(i)), undo, redo, rev, b("✕", "Borrar pista", () => L().clear(i))),
        vol,
      );
      css(root, "--tc", TRACK_COLORS[i]);
      this.el.append(root);
      this.cards.push({ root, btn, wave, label, bars, undo, redo, rev, vol });
    }
  }

  update(): void {
    const L = this.app.looper;
    this.cards.forEach((c, i) => {
      const t = L.tracks[i];
      setText(c.label, LABEL[t.state]);
      const bars = L.bars(i);
      setText(c.bars, t.state === "empty" ? "" : t.state === "rec" && t.free ? "libre" : `${bars} c.`);
      cls(c.undo, "dim", !t.canUndo);
      cls(c.redo, "dim", !t.canRedo);
      cls(c.rev, "on", t.rev);
      cls(c.root, "picked", L.selected === i);
      cls(c.root, "empty", t.state === "empty");
      if (document.activeElement !== c.vol) { const v = String(t.vol); if (c.vol.value !== v) c.vol.value = v; }
    });
  }

  draw(): void {
    const app = this.app;
    const L = app.looper;
    const tr = app.transport;
    // posición actual de la rejilla extrapolada (para que el anillo gire suave)
    const g = tr.running ? tr.gridFrame(app.ctx.currentTime - app.latencyMs() / 1000) : 0;
    const blink = Math.floor(performance.now() / 250) % 2 === 0;
    this.cards.forEach((c, i) => {
      const t = L.tracks[i];
      // ---- botón con anillo de progreso
      const { w, h: hh, dpr } = fitCanvas(c.btn);
      const ctx = c.btn.getContext("2d")!;
      ctx.clearRect(0, 0, w, hh);
      const r = Math.min(w, hh) / 2 - 4 * dpr, cx = w / 2, cy = hh / 2;
      if (r < 8 * dpr) return; // aún sin tamaño (layout)
      const col = STATE_COLOR[t.state];
      const flashing = (t.state === "armed" || t.state === "playArmed" || t.state === "stopArmed") && blink;
      ctx.fillStyle = flashing ? "#1b1e23" : t.state === "empty" ? "#1f2329" : col + "33";
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = t.state === "empty" ? "#3a3f48" : col;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      if (tr.running && (t.state === "rec" || t.state === "play" || t.state === "dub" || t.state === "stopArmed")) {
        const ph = L.phase(i, g);
        ctx.lineWidth = 6 * dpr;
        ctx.strokeStyle = col;
        ctx.beginPath(); ctx.arc(cx, cy, r - 5 * dpr, -Math.PI / 2, -Math.PI / 2 + ph * Math.PI * 2); ctx.stroke();
      }
      // cuenta de beats que faltan para entrar a grabar
      let txt = t.state === "empty" ? "●" : t.state === "rec" ? "REC" : t.state === "dub" ? "DUB" : t.state === "play" ? "▶" : t.state === "stopped" ? "■" : "";
      if (t.state === "armed" && tr.running) {
        const beatsLeft = Math.ceil((t.recStart - g) / (tr.barFrames / 4));
        txt = beatsLeft > 0 ? String(beatsLeft) : "REC";
      }
      ctx.fillStyle = t.state === "empty" ? "#ff4d4d" : "#fff";
      ctx.font = `800 ${Math.round(r * (txt.length > 2 ? 0.42 : 0.6))}px system-ui`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(txt, cx, cy + 1);

      // ---- forma de onda del loop
      const W = fitCanvas(c.wave);
      const wc = c.wave.getContext("2d")!;
      wc.fillStyle = "#0e0f12";
      wc.fillRect(0, 0, W.w, W.h);
      const tc = TRACK_COLORS[i];
      if (t.peaks) {
        const n = t.peaks.length;
        wc.fillStyle = tc;
        const mid = W.h / 2;
        for (let x = 0; x < W.w; x++) {
          const p = t.peaks[Math.floor((x / W.w) * n)];
          const hgt = Math.max(1, Math.min(1, p * 1.4) * mid);
          wc.fillRect(x, mid - hgt, 1, hgt * 2);
        }
        if (tr.running && t.len) {
          wc.fillStyle = "#fff";
          wc.fillRect(L.phase(i, g) * W.w, 0, 2 * W.dpr, W.h);
        }
      } else if (t.state === "rec") {
        wc.fillStyle = "#ff3b3b55";
        wc.fillRect(0, 0, L.phase(i, g) * W.w, W.h);
      }
      // compases
      const bars = L.bars(i);
      if (bars > 1) { wc.fillStyle = "rgba(255,255,255,0.25)"; for (let b = 1; b < bars; b++) wc.fillRect((b / bars) * W.w, 0, 1, W.h); }
    });
  }
}
