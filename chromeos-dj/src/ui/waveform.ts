import type { Deck } from "../deck";
import { settings } from "../settings";
import { fitCanvas } from "./dom";

export const DECK_COLORS = ["#2f8cff", "#ff8a1f", "#3ccf6e", "#c46bff"];

const TILE = 256;

function colorFor(lo: number, mi: number, hi: number, mode: string): string {
  if (mode === "blue") return "";
  // RGB tipo Serato: graves rojo, medios verde, agudos azul; normalizado a brillo
  const m = Math.max(lo, mi, hi, 1);
  const k = 255 / m;
  return `rgb(${Math.round(lo * k)},${Math.round(mi * k * 0.9)},${Math.round(hi * k)})`;
}

/** Dibuja columnas del waveform en el rango [t0, t0 + w/pps). */
function paintWave(g: CanvasRenderingContext2D, wave: Uint8Array, rate: number, t0: number, pps: number, w: number, hgt: number, mode: string, dim = 1): void {
  const mid = hgt / 2;
  const nb = wave.length / 4;
  const binsPerPx = rate / pps;
  for (let x = 0; x < w; x++) {
    const ta = t0 + x / pps;
    let b0 = Math.floor(ta * rate);
    let b1 = Math.floor((ta + 1 / pps) * rate);
    if (b1 <= b0) b1 = b0 + 1;
    if (b1 <= 0 || b0 >= nb) continue;
    b0 = Math.max(0, b0); b1 = Math.min(nb, b1);
    let pk = 0, lo = 0, mi = 0, hi = 0;
    for (let b = b0; b < b1; b++) {
      const o = b * 4;
      if (wave[o] > pk) pk = wave[o];
      if (wave[o + 1] > lo) lo = wave[o + 1];
      if (wave[o + 2] > mi) mi = wave[o + 2];
      if (wave[o + 3] > hi) hi = wave[o + 3];
    }
    void binsPerPx;
    if (mode === "3band") {
      const hl = (lo / 255) * mid * 0.98, hm = (mi / 255) * mid * 0.8, hh = (hi / 255) * mid * 0.6;
      g.fillStyle = `rgba(40,110,255,${dim})`; g.fillRect(x, mid - hl, 1, hl * 2);
      g.fillStyle = `rgba(255,165,40,${dim})`; g.fillRect(x, mid - hm, 1, hm * 2);
      g.fillStyle = `rgba(255,255,255,${dim})`; g.fillRect(x, mid - hh, 1, hh * 2);
    } else if (mode === "blue") {
      const hp = (pk / 255) * mid * 0.98;
      const hr = Math.max(lo, mi, hi) / 255 * mid * 0.7;
      g.fillStyle = `rgba(30,120,255,${dim})`; g.fillRect(x, mid - hp, 1, hp * 2);
      g.fillStyle = `rgba(150,210,255,${dim})`; g.fillRect(x, mid - hr, 1, hr * 2);
    } else {
      const hp = (pk / 255) * mid * 0.98;
      g.globalAlpha = dim;
      g.fillStyle = colorFor(lo, mi, hi, mode);
      g.fillRect(x, mid - hp, 1, hp * 2);
      g.globalAlpha = 1;
    }
  }
}

/** Waveform de detalle con scroll (estilo "parallel waveforms"). */
export class ScrollWave {
  private tiles = new Map<number, HTMLCanvasElement>();
  private key = "";
  constructor(readonly canvas: HTMLCanvasElement, readonly deck: Deck) {}

  draw(secondsVisible: number, masterBeatPhase: number | null): void {
    const c = this.canvas;
    const { w, h: hh, dpr } = fitCanvas(c);
    const g = c.getContext("2d", { alpha: false })!;
    const d = this.deck;
    g.fillStyle = "#08090b";
    g.fillRect(0, 0, w, hh);
    const color = DECK_COLORS[d.i];
    if (!d.wave || !d.track) {
      g.fillStyle = "#333";
      g.fillRect(0, hh / 2, w, 1);
      if (d.loading || d.analyzing) {
        g.fillStyle = "#888";
        g.font = `${12 * dpr}px system-ui`;
        g.fillText(d.loading ? "Cargando…" : "Analizando…", 10 * dpr, hh / 2 - 6 * dpr);
      }
      return;
    }
    const pps = w / secondsVisible;
    const key = `${w}x${hh}:${secondsVisible}:${settings.waveColors}:${d.track.id}:${d.wave.length}`;
    if (key !== this.key) { this.tiles.clear(); this.key = key; }
    const now = d.now(true);
    const cx = Math.round(w / 2);
    const tw = TILE / pps; // segundos por tile
    const tStart = now - cx / pps;
    const k0 = Math.floor(tStart / tw), k1 = Math.floor((tStart + w / pps) / tw);
    for (let k = k0; k <= k1; k++) {
      let tile = this.tiles.get(k);
      if (!tile) {
        tile = document.createElement("canvas");
        tile.width = TILE; tile.height = hh;
        const tg = tile.getContext("2d")!;
        paintWave(tg, d.wave, d.wfRate, k * tw, pps, TILE, hh, settings.waveColors);
        this.tiles.set(k, tile);
        if (this.tiles.size > 40) { const first = this.tiles.keys().next().value; if (first !== undefined) this.tiles.delete(first); }
      }
      g.drawImage(tile, Math.round(cx + (k * tw - now) * pps), 0);
    }
    const X = (t: number) => cx + (t - now) * pps;

    // loop
    if (d.loop) {
      g.fillStyle = d.loopOn ? "rgba(60,220,110,0.22)" : "rgba(200,200,200,0.08)";
      g.fillRect(X(d.loop.start), 0, (d.loop.end - d.loop.start) * pps, hh);
      g.fillStyle = d.loopOn ? "#3cdc6e" : "#777";
      g.fillRect(X(d.loop.start), 0, 2, hh);
      g.fillRect(X(d.loop.end) - 2, 0, 2, hh);
    }
    if (d.loopIn !== null) { g.fillStyle = "#3cdc6e"; g.fillRect(X(d.loopIn), 0, 2, hh); }

    // beatgrid
    if (d.bpm > 0) {
      const bl = d.beatLen;
      const db = d.track.grid?.downbeat ?? 0;
      let b = Math.floor((tStart - d.firstBeat) / bl);
      const bEnd = Math.ceil((tStart + w / pps - d.firstBeat) / bl);
      for (; b <= bEnd; b++) {
        const x = Math.round(X(d.firstBeat + b * bl));
        const bar = ((b - db) % 4 + 4) % 4 === 0;
        g.fillStyle = bar ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.18)";
        g.fillRect(x, 0, bar ? 2 : 1, bar ? hh : hh * 0.12);
        if (!bar) g.fillRect(x, hh * 0.88, 1, hh * 0.12);
      }
    }

    // cues
    const cues = d.track.cues;
    g.font = `bold ${10 * dpr}px system-ui`;
    cues.memory.forEach((m) => {
      const x = X(m.pos);
      g.fillStyle = "#ff3b3b";
      g.beginPath(); g.moveTo(x - 5 * dpr, hh); g.lineTo(x + 5 * dpr, hh); g.lineTo(x, hh - 7 * dpr); g.fill();
    });
    cues.hot.forEach((hc, i) => {
      if (!hc) return;
      const x = X(hc.pos);
      if (x < -40 || x > w + 40) return;
      g.fillStyle = hc.color;
      g.fillRect(x, 0, 2, hh);
      g.fillRect(x, 0, 14 * dpr, 13 * dpr);
      g.fillStyle = "#000";
      g.fillText(String.fromCharCode(65 + i), x + 3 * dpr, 10 * dpr);
    });
    if (cues.main !== null) {
      const x = X(cues.main);
      g.fillStyle = "#ffb000";
      g.beginPath(); g.moveTo(x - 6 * dpr, 0); g.lineTo(x + 6 * dpr, 0); g.lineTo(x, 8 * dpr); g.fill();
    }

    // slip: posición "fantasma"
    if (d.slipping) {
      const x = X(d.slipPos);
      g.fillStyle = "rgba(255,80,200,0.9)";
      g.fillRect(x - 1, 0, 2, hh);
    }

    // cabezal
    g.fillStyle = color;
    g.fillRect(cx - 1, 0, 3 * dpr, hh);
    g.fillStyle = "#fff";
    g.fillRect(cx, 0, 1, hh);

    // indicador de fase vs master (barra fina arriba)
    if (masterBeatPhase !== null && d.bpm > 0) {
      const ph = ((now - d.firstBeat) / d.beatLen) % 1;
      let diff = (ph < 0 ? ph + 1 : ph) - masterBeatPhase;
      if (diff > 0.5) diff -= 1;
      if (diff < -0.5) diff += 1;
      const ok = Math.abs(diff) < 0.03;
      g.fillStyle = ok ? "#3cdc6e" : "#ff4d4d";
      g.fillRect(cx, hh - 3 * dpr, diff * pps * d.beatLen, 3 * dpr);
    }
  }
}

/** Waveform completo de la pista (barra de "needle search"). */
export class Overview {
  private cache: HTMLCanvasElement | null = null;
  private key = "";
  constructor(readonly canvas: HTMLCanvasElement, readonly deck: Deck) {
    canvas.addEventListener("pointerdown", (e) => {
      const r = canvas.getBoundingClientRect();
      this.deck.needle((e.clientX - r.left) / r.width);
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (e.buttons !== 1) return;
      const r = canvas.getBoundingClientRect();
      this.deck.needle(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
    });
  }

  draw(): void {
    const c = this.canvas;
    const { w, h: hh, dpr } = fitCanvas(c);
    const g = c.getContext("2d", { alpha: false })!;
    const d = this.deck;
    g.fillStyle = "#0b0c0f";
    g.fillRect(0, 0, w, hh);
    if (!d.wave || !d.track || d.duration <= 0) return;
    const key = `${w}x${hh}:${settings.waveColors}:${d.track.id}:${d.wave.length}`;
    if (key !== this.key || !this.cache) {
      this.key = key;
      this.cache = document.createElement("canvas");
      this.cache.width = w; this.cache.height = hh;
      paintWave(this.cache.getContext("2d")!, d.wave, d.wfRate, 0, w / d.duration, w, hh, settings.waveColors);
    }
    g.drawImage(this.cache, 0, 0);
    const X = (t: number) => (t / d.duration) * w;
    const now = d.now(true);
    // parte ya reproducida, atenuada (como en CDJ)
    g.fillStyle = "rgba(0,0,0,0.55)";
    g.fillRect(0, 0, X(now), hh);
    // compases cada 16 beats
    if (d.bpm > 0) {
      g.fillStyle = "rgba(255,255,255,0.12)";
      const phrase = d.beatLen * 32;
      for (let t = d.firstBeat + (d.track.grid?.downbeat ?? 0) * d.beatLen; t < d.duration; t += phrase) g.fillRect(X(t), 0, 1, hh);
    }
    if (d.loop) { g.fillStyle = d.loopOn ? "rgba(60,220,110,0.5)" : "rgba(200,200,200,0.25)"; g.fillRect(X(d.loop.start), 0, Math.max(2, X(d.loop.end) - X(d.loop.start)), hh); }
    d.track.cues.memory.forEach((m) => { g.fillStyle = "#ff3b3b"; g.fillRect(X(m.pos), hh - 4 * dpr, 2, 4 * dpr); });
    d.track.cues.hot.forEach((hc) => { if (hc) { g.fillStyle = hc.color; g.fillRect(X(hc.pos), 0, 2 * dpr, hh); } });
    if (d.cue !== null) { g.fillStyle = "#ffb000"; g.fillRect(X(d.cue), 0, 2, hh); }
    g.fillStyle = "#fff";
    g.fillRect(X(now) - 1, 0, 2 * dpr, hh);
    // aviso de fin de pista (< 30 s)
    const left = d.duration - now;
    if (d.playing && left < 30 && Math.floor(performance.now() / 400) % 2 === 0) {
      g.strokeStyle = "#ff3030"; g.lineWidth = 3 * dpr; g.strokeRect(0, 0, w, hh);
    }
  }
}

/** Plato virtual: rota a 33⅓ rpm con la posición y muestra el progreso. */
export function drawPlatter(c: HTMLCanvasElement, d: Deck): void {
  const { w, h: hh, dpr } = fitCanvas(c);
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, w, hh);
  const r = Math.min(w, hh) / 2 - 2 * dpr;
  const cx = w / 2, cy = hh / 2;
  g.fillStyle = "#121418";
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "#262a31"; g.lineWidth = 1;
  for (let k = 0.45; k < 1; k += 0.12) { g.beginPath(); g.arc(cx, cy, r * k, 0, Math.PI * 2); g.stroke(); }
  if (!d.track) return;
  const pos = d.now(true);
  const frac = d.duration > 0 ? pos / d.duration : 0;
  const left = d.duration - pos;
  g.strokeStyle = left < 30 && d.playing ? "#ff3b3b" : DECK_COLORS[d.i];
  g.lineWidth = 4 * dpr;
  g.beginPath(); g.arc(cx, cy, r - 2 * dpr, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); g.stroke();
  const ang = (pos / 1.8) * Math.PI * 2 - Math.PI / 2;
  g.strokeStyle = d.scratching || d.touched ? "#fff" : "#ddd";
  g.lineWidth = 3 * dpr;
  g.beginPath(); g.moveTo(cx + Math.cos(ang) * r * 0.25, cy + Math.sin(ang) * r * 0.25); g.lineTo(cx + Math.cos(ang) * r * 0.85, cy + Math.sin(ang) * r * 0.85); g.stroke();
  if (d.cue !== null) {
    const ca = (d.cue / 1.8) * Math.PI * 2 - Math.PI / 2;
    g.fillStyle = "#ffb000";
    g.beginPath(); g.arc(cx + Math.cos(ca) * r * 0.9, cy + Math.sin(ca) * r * 0.9, 2.5 * dpr, 0, Math.PI * 2); g.fill();
  }
}
