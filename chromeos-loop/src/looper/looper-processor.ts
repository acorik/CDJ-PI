// Looper de 8 pistas en un único AudioWorkletProcessor.
//
// Todo va referido a una rejilla absoluta de muestras ("grid"): el compás 0
// empieza en t0Frame y cada compás dura exactamente barFrames muestras, así que
// loops de 1, 2, 4 u 8 compases nunca se desfasan entre sí.
//
// Grabación: la entrada (instrumentos en directo + micro) se guarda en un
// historial circular de 2 s. Las pistas no escriben "la muestra de ahora",
// sino que van consumiendo ese historial con un retraso = latencia: así lo
// grabado cae en el compás donde el músico lo OYÓ al tocarlo, y una pulsación
// de REC ligeramente tarde puede empezar en el compás que acaba de pasar.

declare const sampleRate: number;
declare const currentFrame: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(name: string, ctor: unknown): void;

const NT = 8;
const NIN = 2; // 0 = instrumentos, 1 = micro
const SEAM = 128; // crossfade en la costura del loop
const RAMP = 128; // rampas de entrada/salida del overdub
const STATE_EVERY = 6;

function mod(a: number, n: number): number {
  const r = a % n;
  return r < 0 ? r + n : r;
}

interface Rec {
  start: number;
  end: number; // -1 = libre (aún sin fin)
  capL: Float32Array;
  capR: Float32Array;
  tailL: Float32Array;
  tailR: Float32Array;
  then: "play" | "dub";
  playingSince: boolean;
}

interface Dub { start: number; end: number }

class Track {
  L: Float32Array | null = null;
  R: Float32Array | null = null;
  len = 0;
  offset = 0;
  playing = false;
  gain = 0;
  vol = 1;
  rev = false;
  rec: Rec | null = null;
  dub: Dub | null = null;
  wpos = new Float64Array(NIN).fill(-Infinity); // siguiente frame de grid a escribir por entrada
  undoL: Float32Array | null = null;
  undoR: Float32Array | null = null;
  canUndo = false;
  canRedo = false;
  playAt = -1;
  stopAt = -1;
  peaksDirty = false;
}

class LooperProcessor extends AudioWorkletProcessor {
  private tracks: Track[] = [];
  private t0 = 0;
  private bar = Math.round(sampleRate * 2);
  private running = false;
  private comp = [0, 0];
  private hist: Float32Array[][] = [];
  private H = Math.round(sampleRate * 2);
  private maxBars = 16;
  private tape = 1; // velocidad (tape stop)
  private tapeTarget = 1;
  private lag = 0;
  private lagArr = new Float64Array(128);
  private blocks = 0;

  constructor() {
    super();
    for (let i = 0; i < NT; i++) this.tracks.push(new Track());
    for (let k = 0; k < NIN; k++) this.hist.push([new Float32Array(this.H), new Float32Array(this.H)]);
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  private grid(frame: number): number { return frame - this.t0; }

  private onMessage(m: any): void {
    const tr = this.tracks[m.tr] as Track | undefined;
    switch (m.t) {
      case "transport":
        this.t0 = m.t0; this.bar = m.bar; this.running = !!m.running;
        if (m.maxBars) this.maxBars = m.maxBars;
        if (!this.running) for (const t of this.tracks) { t.rec = null; t.dub = null; t.playAt = -1; t.stopAt = -1; }
        break;
      case "comp": this.comp = [Math.max(0, m.live | 0), Math.max(0, m.mic | 0)]; break;
      case "rec": {
        if (!tr) return;
        const maxLen = this.bar * this.maxBars + SEAM;
        tr.L = tr.R = null; tr.len = 0; tr.playing = false; tr.dub = null; tr.canUndo = tr.canRedo = false;
        tr.rec = {
          start: m.start, end: m.end ?? -1,
          capL: new Float32Array(m.end > 0 ? m.end - m.start : maxLen), capR: new Float32Array(m.end > 0 ? m.end - m.start : maxLen),
          tailL: new Float32Array(SEAM), tailR: new Float32Array(SEAM), then: m.then ?? "play", playingSince: false,
        };
        tr.wpos.fill(m.start);
        break;
      }
      case "recEnd":
        // cierra una toma libre, o acorta una de longitud fija
        if (tr?.rec && (tr.rec.end < 0 || m.end < tr.rec.end)) tr.rec.end = Math.max(tr.rec.start + this.bar, m.end);
        break;
      case "cancel":
        if (tr) { if (tr.rec) { tr.rec = null; tr.len = 0; tr.playing = false; } tr.playAt = -1; tr.stopAt = -1; }
        break;
      case "dub":
        if (!tr || !tr.L || tr.len === 0 || tr.rec) return;
        this.snapshot(tr);
        tr.dub = { start: m.start, end: -1 };
        tr.wpos.fill(m.start - RAMP);
        tr.playing = true;
        break;
      case "dubEnd":
        if (tr?.dub && tr.dub.end < 0) tr.dub.end = m.end;
        break;
      case "play": if (tr && tr.len) { tr.playAt = m.at; tr.stopAt = -1; } break;
      case "stop":
        if (!tr) return;
        if (tr.dub && tr.dub.end < 0) tr.dub.end = m.at;
        tr.stopAt = m.at; tr.playAt = -1;
        break;
      case "clear":
        if (!tr) return;
        Object.assign(tr, { L: null, R: null, len: 0, playing: false, rec: null, dub: null, undoL: null, undoR: null, canUndo: false, canRedo: false, playAt: -1, stopAt: -1 });
        this.port.postMessage({ t: "peaks", tr: m.tr, peaks: null });
        break;
      case "undo": case "redo": {
        if (!tr || !tr.undoL || tr.dub) return;
        if ((m.t === "undo" && !tr.canUndo) || (m.t === "redo" && !tr.canRedo)) return;
        const l = tr.L, r = tr.R;
        tr.L = tr.undoL; tr.R = tr.undoR; tr.undoL = l; tr.undoR = r;
        tr.canUndo = m.t === "redo"; tr.canRedo = m.t === "undo";
        tr.peaksDirty = true;
        break;
      }
      case "vol": if (tr) tr.vol = m.v; break;
      case "rev": if (tr) tr.rev = !!m.on; break;
      case "tape": this.tapeTarget = m.on ? 0 : 1; if (!m.on) { this.tape = 1; this.lag = 0; } break;
      case "load":
        if (!tr) return;
        Object.assign(tr, { L: m.L, R: m.R, len: m.L.length, offset: m.offset ?? 0, rec: null, dub: null, canUndo: false, canRedo: false, playing: !!m.play });
        tr.peaksDirty = true;
        break;
      case "dump":
        this.port.postMessage({ t: "dump", id: m.id, tracks: this.tracks.map((t) => t.L && t.len ? { L: t.L.slice(), R: t.R!.slice(), offset: t.offset, vol: t.vol, rev: t.rev, playing: t.playing } : null) });
        break;
    }
  }

  private snapshot(tr: Track): void {
    if (!tr.L || !tr.R) return;
    if (!tr.undoL || tr.undoL.length !== tr.len) { tr.undoL = new Float32Array(tr.len); tr.undoR = new Float32Array(tr.len); }
    tr.undoL.set(tr.L); tr.undoR!.set(tr.R);
    tr.canUndo = true; tr.canRedo = false;
  }

  private finalizeRec(tr: Track, ti: number): void {
    const r = tr.rec!;
    const len = r.end - r.start;
    const L = r.capL.length === len ? r.capL : r.capL.slice(0, len);
    const R = r.capR.length === len ? r.capR : r.capR.slice(0, len);
    // costura: crossfade de lo tocado justo después del final hacia el principio
    for (let i = 0; i < SEAM && i < len; i++) {
      const w = i / SEAM;
      L[i] = L[i] * w + r.tailL[i] * (1 - w);
      R[i] = R[i] * w + r.tailR[i] * (1 - w);
    }
    tr.L = L; tr.R = R; tr.len = len; tr.offset = r.start;
    tr.rec = null;
    tr.playing = true; // el final de la toma ya pasó: la pista suena desde r.end
    if (r.then === "dub") {
      this.snapshot(tr);
      tr.canUndo = false;
      tr.dub = { start: r.end + SEAM, end: -1 };
      tr.wpos.fill(r.end + SEAM - RAMP);
    }
    this.sendPeaks(tr, ti);
  }

  private sendPeaks(tr: Track, ti: number): void {
    tr.peaksDirty = false;
    if (!tr.L || !tr.len) { this.port.postMessage({ t: "peaks", tr: ti, peaks: null }); return; }
    const N = 240, peaks = new Float32Array(N), step = tr.len / N;
    for (let b = 0; b < N; b++) {
      let p = 0;
      const a = Math.floor(b * step), e = Math.min(tr.len, Math.floor((b + 1) * step));
      for (let i = a; i < e; i += 4) { const v = Math.abs(tr.L[i]) + Math.abs(tr.R![i]); if (v > p) p = v; }
      peaks[b] = p * 0.5;
    }
    this.port.postMessage({ t: "peaks", tr: ti, peaks }, [peaks.buffer]);
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const n = outputs[0][0].length;
    const F = currentFrame;
    // 1) historial de entrada
    for (let k = 0; k < NIN; k++) {
      const inp = inputs[k];
      const l = inp && inp[0], r = inp && (inp[1] ?? inp[0]);
      const [hl, hr] = this.hist[k];
      for (let i = 0; i < n; i++) {
        const idx = (F + i) % this.H;
        hl[idx] = l ? l[i] : 0;
        hr[idx] = r ? r[i] : 0;
      }
    }
    const gEnd = this.grid(F + n); // primer frame de grid del bloque siguiente
    // tape stop global: retraso de lectura por muestra de este bloque
    const lagArr = this.lagArr;
    for (let i = 0; i < n; i++) {
      if (this.tape !== this.tapeTarget) {
        this.tape += (this.tapeTarget - this.tape) * 0.00004;
        if (Math.abs(this.tape - this.tapeTarget) < 1e-4) this.tape = this.tapeTarget;
      }
      this.lag += 1 - this.tape;
      lagArr[i] = this.lag;
    }

    for (let ti = 0; ti < NT; ti++) {
      const tr = this.tracks[ti];
      const out = outputs[ti];
      const oL = out[0], oR = out[1] ?? out[0];
      // 2) escritura (grabación / overdub) consumiendo el historial con la latencia de cada entrada
      if (this.running && (tr.rec || tr.dub)) {
        for (let k = 0; k < NIN; k++) {
          const upto = gEnd - this.comp[k];
          let g = Math.max(tr.wpos[k], upto - this.H + n + 64);
          const [hl, hr] = this.hist[k];
          for (; g < upto; g++) {
            const fi = mod(g + this.t0 + this.comp[k], this.H);
            const sl = hl[fi], sr = hr[fi];
            const rec = tr.rec;
            if (rec) {
              if (g >= rec.start && (rec.end < 0 || g < rec.end)) {
                const idx = g - rec.start;
                if (idx < rec.capL.length) { rec.capL[idx] += sl; rec.capR[idx] += sr; }
              } else if (rec.end >= 0 && g >= rec.end && g < rec.end + SEAM) {
                rec.tailL[g - rec.end] += sl; rec.tailR[g - rec.end] += sr;
              }
            } else if (tr.dub && tr.L) {
              const d = tr.dub;
              let w = Math.min(1, (g - (d.start - RAMP)) / RAMP);
              if (d.end >= 0) w = Math.min(w, (d.end + RAMP - g) / RAMP);
              if (w > 0) {
                const idx = mod(g - tr.offset, tr.len);
                tr.L[idx] += sl * w; tr.R![idx] += sr * w;
              }
            }
          }
          tr.wpos[k] = Math.max(tr.wpos[k], upto);
        }
        // grabación libre que llega al máximo de compases: se cierra sola
        if (tr.rec && tr.rec.end < 0 && gEnd - tr.rec.start >= this.bar * this.maxBars) tr.rec.end = tr.rec.start + this.bar * this.maxBars;
        const minW = Math.min(tr.wpos[0], tr.wpos[1]);
        if (tr.rec && tr.rec.end >= 0 && minW >= tr.rec.end + SEAM) this.finalizeRec(tr, ti);
        else if (tr.dub && tr.dub.end >= 0 && minW >= tr.dub.end + RAMP) { tr.dub = null; this.sendPeaks(tr, ti); }
      }
      if (tr.peaksDirty) this.sendPeaks(tr, ti);

      // 3) reproducción
      const rec = tr.rec;
      const srcL = rec ? rec.capL : tr.L, srcR = rec ? rec.capR : tr.R;
      const len = rec ? (rec.end >= 0 ? rec.end - rec.start : 0) : tr.len;
      const offset = rec ? rec.start : tr.offset;
      if (!srcL || !srcR || len <= 0 || !this.running) {
        if (!this.running) tr.gain = 0;
        oL.fill(0); if (oR !== oL) oR.fill(0);
        continue;
      }
      for (let i = 0; i < n; i++) {
        const g = this.grid(F + i);
        if (rec && rec.end >= 0 && g >= rec.end && !rec.playingSince) { rec.playingSince = true; tr.playing = true; }
        if (tr.playAt >= 0 && g >= tr.playAt) { tr.playing = true; tr.playAt = -1; }
        if (tr.stopAt >= 0 && g >= tr.stopAt) { tr.playing = false; tr.stopAt = -1; }
        const target = tr.playing && (!rec || rec.playingSince) ? tr.vol : 0;
        tr.gain += (target - tr.gain) * 0.01;
        if (tr.gain < 1e-5 && target === 0) { oL[i] = 0; oR[i] = 0; continue; }
        const pos = g - offset - lagArr[i];
        let p = mod(pos, len);
        if (tr.rev) p = len - 1 - p;
        const i0 = Math.floor(p), fr = p - i0, i1 = i0 + 1 >= len ? 0 : i0 + 1;
        oL[i] = (srcL[i0] + (srcL[i1] - srcL[i0]) * fr) * tr.gain;
        oR[i] = (srcR[i0] + (srcR[i1] - srcR[i0]) * fr) * tr.gain;
      }
    }

    if (++this.blocks >= STATE_EVERY) {
      this.blocks = 0;
      const s: number[] = [];
      for (const t of this.tracks) {
        const flags = (t.playing ? 1 : 0) | (t.rec ? 2 : 0) | (t.dub && (t.dub.end < 0) ? 4 : 0) | (t.canUndo ? 8 : 0) |
          (t.canRedo ? 16 : 0) | (t.rev ? 32 : 0) | (t.playAt >= 0 ? 64 : 0) | (t.stopAt >= 0 ? 128 : 0) |
          (t.rec && t.rec.end < 0 ? 256 : 0);
        const len = t.rec ? (t.rec.end >= 0 ? t.rec.end - t.rec.start : 0) : t.len;
        const off = t.rec ? t.rec.start : t.offset;
        s.push(len, off, flags, t.rec ? t.rec.start : 0, t.rec ? t.rec.end : 0);
      }
      this.port.postMessage({ t: "s", frame: F, s });
    }
    return true;
  }
}

registerProcessor("looper", LooperProcessor);
export {};
