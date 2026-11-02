import type { AnalysisResult } from "../analysis/analyze";

export interface PlaybackData {
  L: Int16Array;
  R: Int16Array;
  sr: number;
  /** mono a sr/2 para analizar sin volver a decodificar */
  mono: Float32Array;
  monoSr: number;
  duration: number;
}

function toInt16(src: Float32Array): Int16Array {
  const out = new Int16Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    out[i] = v >= 1 ? 32767 : v <= -1 ? -32768 : Math.round(v * 32767);
  }
  return out;
}

/** Decodifica para reproducir (a la frecuencia del AudioContext) y prepara un mono para análisis. */
export async function decodeForPlayback(ctx: BaseAudioContext, file: File): Promise<PlaybackData> {
  const ab = await file.arrayBuffer();
  const buf = await ctx.decodeAudioData(ab);
  const l = buf.getChannelData(0);
  const r = buf.numberOfChannels > 1 ? buf.getChannelData(1) : l;
  const L = toInt16(l);
  const R = r === l ? L.slice() : toInt16(r);
  // mono a la mitad de frecuencia (promedio de pares) -> 4x menos que el estéreo float
  const n = Math.floor(l.length / 2);
  const mono = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 2) mono[i] = (l[j] + l[j + 1] + r[j] + r[j + 1]) * 0.25;
  return { L, R, sr: buf.sampleRate, mono, monoSr: buf.sampleRate / 2, duration: buf.duration };
}

/** Decodificación barata solo para análisis por lotes (22.05 kHz). */
export async function decodeForAnalysis(file: File): Promise<{ mono: Float32Array; sr: number }> {
  const SR = 22050;
  const ab = await file.arrayBuffer();
  const off = new OfflineAudioContext(1, 1, SR);
  const buf = await off.decodeAudioData(ab);
  const l = buf.getChannelData(0);
  if (buf.numberOfChannels === 1) return { mono: l, sr: SR };
  const r = buf.getChannelData(1);
  const mono = new Float32Array(l.length);
  for (let i = 0; i < l.length; i++) mono[i] = (l[i] + r[i]) * 0.5;
  return { mono, sr: SR };
}

export class AnalyzerClient {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, { res: (r: AnalysisResult) => void; rej: (e: Error) => void }>();

  constructor() {
    const url = URL.createObjectURL(new Blob([__WORKER_SRC__], { type: "text/javascript" }));
    this.worker = new Worker(url);
    this.worker.onmessage = (e) => {
      const { id, result, error } = e.data;
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      if (error) p.rej(new Error(error));
      else p.res(result);
    };
  }

  analyze(mono: Float32Array, sr: number, minBpm: number): Promise<AnalysisResult> {
    const id = ++this.seq;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      // se transfiere: el hilo principal suelta esa memoria inmediatamente
      this.worker.postMessage({ id, x: mono, sr, minBpm }, [mono.buffer]);
    });
  }
}
