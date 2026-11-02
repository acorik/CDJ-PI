// Web Worker de análisis: BPM + beatgrid, tonalidad, loudness y waveform.
// Se empaqueta como string y se arranca desde un Blob URL, así funciona
// también abriendo la app con file:// (sin servidor).
import { analyzeMono } from "../analysis/analyze";

interface Req { id: number; x: Float32Array; sr: number; minBpm: number }

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Req>) => void) | null;
  postMessage(msg: unknown, transfer?: Transferable[]): void;
};

scope.onmessage = (e) => {
  const { id, x, sr, minBpm } = e.data;
  try {
    const result = analyzeMono(x, sr, minBpm);
    scope.postMessage({ id, result }, [result.wf.buffer]);
  } catch (err) {
    scope.postMessage({ id, error: String((err as Error)?.message ?? err) });
  }
};
