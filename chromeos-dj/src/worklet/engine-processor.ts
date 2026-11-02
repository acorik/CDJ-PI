// Motor de reproducción: UN solo AudioWorkletProcessor para los 4 decks.
//
// Por qué uno solo: el sync con bloqueo de fase necesita leer la posición
// del deck master con precisión de muestra; entre procesadores distintos
// eso solo se podría con SharedArrayBuffer (que exige cabeceras COOP/COEP
// y no funciona abriendo la app por file://).
//
// Cada deck guarda su pista como Int16 (la mitad de RAM que Float32: ~63 MB
// para 6 min a 48 kHz estéreo), con interpolación cúbica para el pitch y
// scratch, y WSOLA para el key lock (master tempo).
//
// Este archivo se ejecuta en AudioWorkletGlobalScope: sin DOM, sin imports
// en runtime más allá de lo que esbuild empaquete.

declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(name: string, ctor: unknown): void;

const NDECK = 4;
const BLOCK = 128;
const FADE = 96; // muestras de crossfade anti-click en saltos
const WS_N = 2048; // tamaño de grano WSOLA
const WS_H = 1024; // hop de síntesis (50 % solape)
const WS_OV = WS_N - WS_H;
const WS_SEEK = 448; // ventana de búsqueda ±muestras
const STATE_EVERY = 4; // enviar estado cada 4 bloques (~10 ms)
const I16 = 1 / 32768;

const WS_STEP = 16; // diezmado de la correlación
const WS_PTS = Math.floor(WS_OV / WS_STEP);
const WS_REF = new Float64Array(WS_PTS);
const HANN = new Float32Array(WS_N);
for (let i = 0; i < WS_N; i++) HANN[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WS_N);

class DeckState {
  L: Int16Array | null = null;
  R: Int16Array | null = null;
  len = 0;
  pos = 0;
  speed = 0;
  playing = false;
  tempo = 1;
  bend = 0;
  nudge = 0;
  reverse = false;
  keylock = false;
  keySemis = 0;
  bpm = 0;
  firstBeat = 0; // en muestras
  sync = false;
  syncTempo = 1;
  phaseCorr = 0;
  needAlign = false;
  loopOn = false;
  loopStart = 0;
  loopEnd = 0;
  scratching = false;
  scratchTarget = 0;
  scratchVel = 0;
  slipping = false;
  slipPos = 0;
  startTime = 0;
  brakeTime = 0;
  oneShotBrake = 0;
  spinback = 0; // velocidad de spinback en curso (negativa) o 0
  endedSent = false;
  // anti-click
  tailL = new Float32Array(FADE);
  tailR = new Float32Array(FADE);
  tailRem = 0;
  // WSOLA
  wsActive = false;
  wsFresh = true;
  wsIdx = WS_H;
  wsFifoL = new Float32Array(WS_H);
  wsFifoR = new Float32Array(WS_H);
  wsOlaL = new Float32Array(WS_N);
  wsOlaR = new Float32Array(WS_N);
  wsPrevStart = 0;
  wsPrevP = 1;
}

// Variables de salida de la interpolación (evita crear objetos por muestra).
let oL = 0;
let oR = 0;

function cubic(y0: number, y1: number, y2: number, y3: number, t: number): number {
  const c1 = 0.5 * (y2 - y0);
  const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
  const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
  return ((c3 * t + c2) * t + c1) * t + y1;
}

function readAt(d: DeckState, pos: number): void {
  const L = d.L!, R = d.R!, n = d.len;
  const i = Math.floor(pos);
  const t = pos - i;
  if (i >= 1 && i + 2 < n) {
    oL = cubic(L[i - 1], L[i], L[i + 1], L[i + 2], t) * I16;
    oR = cubic(R[i - 1], R[i], R[i + 1], R[i + 2], t) * I16;
    return;
  }
  const g = (a: Int16Array, k: number) => (k >= 0 && k < n ? a[k] : 0);
  oL = cubic(g(L, i - 1), g(L, i), g(L, i + 1), g(L, i + 2), t) * I16;
  oR = cubic(g(R, i - 1), g(R, i), g(R, i + 1), g(R, i + 2), t) * I16;
}

function monoAt(d: DeckState, pos: number): number {
  const i = Math.round(pos);
  if (i < 0 || i >= d.len) return 0;
  return d.L![i] + d.R![i];
}

class EngineProcessor extends AudioWorkletProcessor {
  private decks: DeckState[] = [];
  private master = -1;
  private blockCount = 0;
  private sr = sampleRate;
  /** duración (muestras) del beat usado en la última comparación de fase */
  private slowLen = 0;
  private startPos = new Float64Array(NDECK);

  constructor() {
    super();
    for (let i = 0; i < NDECK; i++) this.decks.push(new DeckState());
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  // ---------------------------------------------------------------- mensajes
  private onMessage(m: any): void {
    const d = this.decks[m.d] as DeckState | undefined;
    switch (m.t) {
      case "load":
        if (!d) return;
        d.L = m.L; d.R = m.R; d.len = m.L.length;
        d.playing = false; d.speed = 0; d.loopOn = false; d.scratching = false;
        d.slipping = false; d.reverse = false; d.spinback = 0; d.endedSent = false;
        d.bpm = m.bpm || 0; d.firstBeat = (m.firstBeat || 0) * this.sr;
        d.pos = (m.pos || 0) * this.sr; d.wsFresh = true; d.wsIdx = WS_H; d.tailRem = 0;
        break;
      case "clone": {
        const s = this.decks[m.from];
        if (!d || !s || !s.L) return;
        d.L = s.L; d.R = s.R; d.len = s.len; d.bpm = s.bpm; d.firstBeat = s.firstBeat;
        d.pos = s.pos; d.playing = s.playing; d.speed = s.speed; d.tempo = s.tempo;
        d.loopOn = s.loopOn; d.loopStart = s.loopStart; d.loopEnd = s.loopEnd;
        d.endedSent = false; d.wsFresh = true; d.wsIdx = WS_H; d.tailRem = 0;
        break;
      }
      case "unload":
        if (!d) return;
        d.L = d.R = null; d.len = 0; d.playing = false; d.speed = 0; d.loopOn = false;
        if (this.master === m.d) this.master = -1;
        break;
      case "play":
        if (!d || !d.L) return;
        if (m.on && !d.playing) {
          d.playing = true; d.endedSent = false; d.spinback = 0;
          if (d.pos >= d.len - 1) d.pos = 0;
          if (d.sync) d.needAlign = true;
        } else if (!m.on && d.playing) {
          d.playing = false;
          d.oneShotBrake = m.brake || 0;
        }
        break;
      case "seek":
        if (!d || !d.L) return;
        this.jump(d, Math.max(0, Math.min(d.len - 1, m.pos * this.sr)));
        if (d.sync && d.playing) d.needAlign = true;
        break;
      case "jumpPhase": {
        // salto cuantizado: mantiene la fase de beat actual (como el quantize de CDJ)
        if (!d || !d.L) return;
        let target = m.pos * this.sr;
        if (d.bpm > 0) {
          const bl = (60 / d.bpm) * this.sr;
          const off = (((d.pos - d.firstBeat) % bl) + bl) % bl;
          const tb = d.firstBeat + Math.round((target - d.firstBeat) / bl) * bl;
          target = tb + off;
          if (off > bl / 2) target -= bl; // usa el beat más cercano
        }
        this.jump(d, Math.max(0, Math.min(d.len - 1, target)));
        break;
      }
      case "beatjump": {
        if (!d || !d.L || d.bpm <= 0) return;
        const delta = m.beats * (60 / d.bpm) * this.sr;
        if (d.loopOn && m.moveLoop) { d.loopStart += delta; d.loopEnd += delta; }
        this.jump(d, Math.max(0, Math.min(d.len - 1, d.pos + delta)));
        break;
      }
      case "tempo": if (d) d.tempo = Math.max(0, m.v); break;
      case "bend": if (d) d.bend = m.v; break;
      case "nudge": if (d) d.nudge = Math.max(-0.5, Math.min(0.5, d.nudge + m.v)); break;
      case "reverse": if (d) d.reverse = !!m.on; break;
      case "keylock": if (d) d.keylock = !!m.on; break;
      case "key": if (d) d.keySemis = m.v; break;
      case "grid":
        if (!d) return;
        d.bpm = m.bpm || 0; d.firstBeat = (m.firstBeat || 0) * this.sr;
        break;
      case "sync":
        if (!d) return;
        d.sync = !!m.on;
        if (d.sync && d.playing) d.needAlign = true;
        break;
      case "master": this.master = m.d; break;
      case "loop":
        if (!d || !d.L) return;
        d.loopStart = m.start * this.sr;
        d.loopEnd = m.end * this.sr;
        d.loopOn = !!m.on && d.loopEnd > d.loopStart + 32;
        if (d.loopOn && m.jump) this.jump(d, d.loopStart);
        else if (d.loopOn && (d.pos >= d.loopEnd || d.pos < d.loopStart - this.sr * 0.002) && m.wrapIfOutside) {
          const len = d.loopEnd - d.loopStart;
          const p = d.loopStart + ((((d.pos - d.loopStart) % len) + len) % len);
          this.jump(d, p);
        }
        break;
      case "loopOff": if (d) d.loopOn = false; break;
      case "scratch":
        if (!d) return;
        if (m.on && !d.scratching) {
          d.scratching = true; d.scratchTarget = d.pos; d.scratchVel = d.speed;
          if (d.wsActive) { this.captureTail(d); d.wsActive = false; }
        } else if (!m.on) d.scratching = false;
        break;
      case "scratchMove":
        if (d && d.scratching) d.scratchTarget += m.v * this.sr;
        break;
      case "slip":
        if (!d) return;
        if (m.on) { if (!d.slipping) { d.slipping = true; d.slipPos = d.pos; } }
        else if (d.slipping) {
          d.slipping = false;
          if (m.ret && d.L) this.jump(d, Math.min(d.len - 1, d.slipPos));
        }
        break;
      case "ramp": if (d) { d.startTime = m.start; d.brakeTime = m.brake; } break;
      case "spinback":
        if (!d || !d.L) return;
        d.spinback = -Math.max(1, m.v || 3); d.playing = false;
        break;
    }
  }

  // ------------------------------------------------------------- utilidades
  /** Guarda las próximas FADE muestras del camino actual para hacer crossfade. */
  private captureTail(d: DeckState): void {
    if (!d.L) return;
    let k = 0;
    if (d.wsActive) {
      for (let i = d.wsIdx; i < WS_H && k < FADE; i++, k++) {
        d.tailL[k] = d.wsFifoL[i]; d.tailR[k] = d.wsFifoR[i];
      }
    }
    if (!d.wsActive && d.speed === 0) {
      for (; k < FADE; k++) { d.tailL[k] = 0; d.tailR[k] = 0; }
      d.tailRem = FADE;
      return;
    }
    let p = d.pos;
    for (; k < FADE; k++) {
      readAt(d, p);
      d.tailL[k] = oL; d.tailR[k] = oR;
      p += d.speed;
    }
    d.tailRem = FADE;
  }

  private jump(d: DeckState, newPos: number): void {
    this.captureTail(d);
    d.pos = newPos;
    d.wsFresh = true;
    d.wsIdx = WS_H;
    d.wsOlaL.fill(0); d.wsOlaR.fill(0);
    if (d.scratching) d.scratchTarget = newPos;
  }

  private beatLen(d: DeckState): number {
    return (60 / d.bpm) * this.sr;
  }

  /** Tempo nominal (sin scratch ni correcciones) que debe llevar el deck. */
  private nominalTempo(d: DeckState, idx: number): number {
    if (!d.sync || idx === this.master) return d.tempo;
    const m = this.decks[this.master];
    if (!m || !m.L || m.bpm <= 0 || d.bpm <= 0) return d.tempo;
    const mBpm = m.bpm * (m.sync ? m.syncTempo : m.tempo);
    const r = mBpm / d.bpm;
    let mult = 1;
    if (Math.abs(r / 2 - 1) < Math.abs(r - 1)) mult = 2;
    else if (Math.abs(r * 2 - 1) < Math.abs(r - 1)) mult = 0.5;
    return r / mult;
  }

  /** Diferencia de fase (en muestras del deck d) respecto al master. */
  private phaseDiff(d: DeckState): number {
    const m = this.decks[this.master];
    if (!m || !m.L || m.bpm <= 0 || d.bpm <= 0) return 0;
    const bd = this.beatLen(d), bm = this.beatLen(m);
    const effM = m.bpm * m.tempo;
    const r = effM / d.bpm;
    let mult = 1;
    if (Math.abs(r / 2 - 1) < Math.abs(r - 1)) mult = 2;
    else if (Math.abs(r * 2 - 1) < Math.abs(r - 1)) mult = 0.5;
    const biD = (d.pos - d.firstBeat) / bd;
    // posición del master al inicio del bloque (puede haberse renderizado ya)
    const biM = (this.startPos[this.master] - m.firstBeat) / bm;
    let phD: number, phM: number, slow: number;
    if (mult === 2) { phD = biD; phM = biM / 2; slow = bd; }
    else if (mult === 0.5) { phD = biD / 2; phM = biM; slow = 2 * bd; }
    else { phD = biD; phM = biM; slow = bd; }
    this.slowLen = slow;
    phD -= Math.floor(phD); phM -= Math.floor(phM);
    let diff = phM - phD;
    if (diff >= 0.5) diff -= 1;
    if (diff < -0.5) diff += 1;
    // la posición del master avanza durante el bloque igual que la nuestra,
    // así que la comparación instantánea es suficiente
    return diff * slow;
  }

  // ---------------------------------------------------------------- render
  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const blockDur = BLOCK / this.sr;
    for (let di = 0; di < NDECK; di++) this.startPos[di] = this.decks[di].pos;
    for (let di = 0; di < NDECK; di++) {
      const out = outputs[di];
      const outL = out[0], outR = out[1] ?? out[0];
      const d = this.decks[di];
      if (!d.L) { outL.fill(0); if (outR !== outL) outR.fill(0); continue; }

      // --- velocidad objetivo del bloque
      const nominal = this.nominalTempo(d, di);
      d.syncTempo = nominal;
      d.phaseCorr = 0;
      if (d.sync && di !== this.master && this.master >= 0 && d.playing && !d.scratching) {
        const m = this.decks[this.master];
        if (!m.playing) d.needAlign = false; // master parado: solo se iguala el tempo
        else if (!m.scratching) {
          const diff = this.phaseDiff(d);
          if (d.needAlign) {
            // si alinear exigiría ir antes del inicio, se alinea un beat más adelante
            let np = d.pos + diff;
            if (np < 0) np += this.slowLen;
            this.jump(d, Math.min(d.len - 1, np));
            d.needAlign = false;
          } else {
            // cierra el desfase en ~0.35 s, limitado a ±4 %
            d.phaseCorr = Math.max(-0.04, Math.min(0.04, diff / (0.35 * this.sr)));
          }
        }
      }
      d.nudge *= 0.85;
      if (Math.abs(d.nudge) < 1e-4) d.nudge = 0;

      let target: number;
      let rampTime = 0.004;
      if (d.scratching) {
        const err = d.scratchTarget - d.pos;
        const want = err / (BLOCK * 2.5);
        d.scratchVel += (want - d.scratchVel) * 0.45;
        if (Math.abs(err) < 0.5 && Math.abs(d.scratchVel) < 0.002) d.scratchVel = 0;
        d.scratchVel = Math.max(-12, Math.min(12, d.scratchVel));
        target = d.scratchVel;
        rampTime = 0;
      } else if (d.spinback !== 0) {
        d.spinback *= Math.pow(0.02, blockDur / 1.1); // decae a ~0 en ~1.1 s
        if (Math.abs(d.spinback) < 0.03) d.spinback = 0;
        target = d.spinback;
        rampTime = 0;
      } else if (d.playing) {
        const base = nominal + d.bend + d.nudge + d.phaseCorr;
        target = d.reverse ? -base : base;
        if (Math.abs(d.speed) < 0.05 && d.startTime > 0) rampTime = d.startTime;
      } else {
        target = 0;
        const bt = d.oneShotBrake || d.brakeTime;
        if (bt > 0) rampTime = bt;
      }
      if (rampTime <= 0) d.speed = target;
      else {
        const maxDelta = blockDur / rampTime;
        const delta = target - d.speed;
        d.speed += delta > maxDelta ? maxDelta : delta < -maxDelta ? -maxDelta : delta;
      }
      if (!d.playing && d.speed === 0) d.oneShotBrake = 0;

      // --- elegir camino: WSOLA (key lock / key shift) o remuestreo directo
      const keyFactor = d.keySemis !== 0 ? Math.pow(2, d.keySemis / 12) : 1;
      const stretchable = d.playing && !d.scratching && d.spinback === 0 && d.speed > 0.25 &&
        Math.abs(d.speed - target) < 0.02;
      const useWs = stretchable && (d.keylock || d.keySemis !== 0);
      if (useWs && !d.wsActive) { d.wsActive = true; d.wsFresh = true; d.wsIdx = WS_H; d.wsOlaL.fill(0); d.wsOlaR.fill(0); }
      else if (!useWs && d.wsActive) { this.captureTail(d); d.wsActive = false; }

      const pitch = d.keylock ? keyFactor : d.speed * keyFactor;
      this.renderBlock(d, di, outL, outR, useWs, pitch);

      // slip: la posición "fantasma" sigue avanzando a velocidad normal
      if (d.slipping && d.playing) d.slipPos += nominal * BLOCK;
      else if (d.slipping && !d.playing && !d.scratching) { /* parado: no avanza */ }
    }

    if (++this.blockCount >= STATE_EVERY) {
      this.blockCount = 0;
      const s: number[] = [];
      for (let i = 0; i < NDECK; i++) {
        const d = this.decks[i];
        const flags = (d.playing ? 1 : 0) | (d.loopOn ? 2 : 0) | (d.slipping ? 4 : 0) |
          (d.scratching ? 8 : 0) | (d.wsActive ? 16 : 0) | (d.reverse ? 32 : 0);
        s.push(d.pos / this.sr, d.speed, flags, d.slipPos / this.sr, d.syncTempo, d.phaseCorr);
      }
      this.port.postMessage({ t: "s", ct: currentTime, m: this.master, s });
    }
    return true;
  }

  private renderBlock(d: DeckState, di: number, outL: Float32Array, outR: Float32Array, useWs: boolean, pitch: number): void {
    const speed = d.speed;
    for (let i = 0; i < outL.length; i++) {
      let l: number, r: number;
      if (useWs) {
        if (d.wsIdx >= WS_H) this.wsGenerate(d, pitch);
        l = d.wsFifoL[d.wsIdx]; r = d.wsFifoR[d.wsIdx]; d.wsIdx++;
      } else if (speed === 0) {
        l = 0; r = 0; // parado: silencio (no mantenemos la muestra fija -> sin DC)
      } else {
        readAt(d, d.pos); l = oL; r = oR;
      }
      if (d.tailRem > 0) {
        const g = d.tailRem / FADE;
        const k = FADE - d.tailRem;
        l = l * (1 - g) + d.tailL[k] * g;
        r = r * (1 - g) + d.tailR[k] * g;
        d.tailRem--;
      }
      outL[i] = l; outR[i] = r;

      d.pos += speed;
      if (d.loopOn && !d.scratching) {
        if (speed > 0 && d.pos >= d.loopEnd) this.jump(d, d.pos - (d.loopEnd - d.loopStart));
        else if (speed < 0 && d.pos < d.loopStart) this.jump(d, d.pos + (d.loopEnd - d.loopStart));
      }
      if (d.pos >= d.len) {
        d.pos = d.len - 1;
        if (!d.scratching) { d.playing = false; d.speed = 0; d.spinback = 0; }
        if (!d.endedSent) { d.endedSent = true; this.port.postMessage({ t: "end", d: di }); }
        // rellena el resto del bloque con silencio
        for (let j = i + 1; j < outL.length; j++) { outL[j] = 0; outR[j] = 0; }
        return;
      }
      if (d.pos < 0) {
        d.pos = 0;
        if (d.spinback !== 0) d.spinback = 0;
        if (d.scratching && d.scratchTarget < 0) d.scratchTarget = 0;
      }
    }
  }

  /** Genera un grano WSOLA y deja WS_H muestras listas en la FIFO. */
  private wsGenerate(d: DeckState, p: number): void {
    const A = d.pos;
    let start = A;
    if (!d.wsFresh) {
      // continuación natural del grano anterior (precalculada una vez por grano)
      const nat = d.wsPrevStart + WS_H * d.wsPrevP;
      const ref = WS_REF;
      for (let k = 0; k < WS_PTS; k++) ref[k] = monoAt(d, nat + k * WS_STEP * p);
      const seek = WS_SEEK * Math.max(1, p);
      let best = 0, bestScore = -Infinity;
      const corr = (delta: number) => {
        let num = 0, en = 0;
        const c = A + delta;
        for (let k = 0; k < WS_PTS; k++) {
          const b = monoAt(d, c + k * WS_STEP * p);
          num += ref[k] * b; en += b * b;
        }
        return en > 0 ? num / Math.sqrt(en) : 0;
      };
      for (let delta = -seek; delta <= seek; delta += 8) {
        const sc = corr(delta);
        if (sc > bestScore) { bestScore = sc; best = delta; }
      }
      const coarse = best;
      for (let delta = coarse - 7; delta <= coarse + 7; delta++) {
        if (delta === coarse) continue;
        const sc = corr(delta);
        if (sc > bestScore) { bestScore = sc; best = delta; }
      }
      start = A + best;
    }
    const olaL = d.wsOlaL, olaR = d.wsOlaR;
    for (let j = 0; j < WS_N; j++) {
      const w = d.wsFresh && j < WS_H ? 1 : HANN[j];
      readAt(d, start + j * p);
      olaL[j] += oL * w;
      olaR[j] += oR * w;
    }
    d.wsFifoL.set(olaL.subarray(0, WS_H));
    d.wsFifoR.set(olaR.subarray(0, WS_H));
    olaL.copyWithin(0, WS_H); olaR.copyWithin(0, WS_H);
    olaL.fill(0, WS_N - WS_H); olaR.fill(0, WS_N - WS_H);
    d.wsPrevStart = start;
    d.wsPrevP = p;
    d.wsFresh = false;
    d.wsIdx = 0;
  }
}

registerProcessor("dj-engine", EngineProcessor);
export {};
