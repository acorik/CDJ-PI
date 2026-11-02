// Utilidades DSP sin dependencias, compartidas por el worker de análisis
// y por los tests (se ejecutan en Node).

/** Biquad RBJ (forma directa transpuesta II). */
export class Biquad {
  private z1 = 0;
  private z2 = 0;
  constructor(
    private b0: number,
    private b1: number,
    private b2: number,
    private a1: number,
    private a2: number,
  ) {}

  static lowpass(sr: number, f: number, q = Math.SQRT1_2): Biquad {
    const w = (2 * Math.PI * f) / sr;
    const c = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    return new Biquad(((1 - c) / 2) / a0, (1 - c) / a0, ((1 - c) / 2) / a0, (-2 * c) / a0, (1 - alpha) / a0);
  }

  static highpass(sr: number, f: number, q = Math.SQRT1_2): Biquad {
    const w = (2 * Math.PI * f) / sr;
    const c = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    return new Biquad(((1 + c) / 2) / a0, (-(1 + c)) / a0, ((1 + c) / 2) / a0, (-2 * c) / a0, (1 - alpha) / a0);
  }

  /** High-shelf (para la ponderación K aproximada del loudness). */
  static highshelf(sr: number, f: number, gainDb: number): Biquad {
    const A = Math.pow(10, gainDb / 40);
    const w = (2 * Math.PI * f) / sr;
    const c = Math.cos(w);
    const s = Math.sin(w);
    const alpha = (s / 2) * Math.SQRT2;
    const sq = 2 * Math.sqrt(A) * alpha;
    const a0 = A + 1 - (A - 1) * c + sq;
    return new Biquad(
      (A * (A + 1 + (A - 1) * c + sq)) / a0,
      (-2 * A * (A - 1 + (A + 1) * c)) / a0,
      (A * (A + 1 + (A - 1) * c - sq)) / a0,
      (2 * (A - 1 - (A + 1) * c)) / a0,
      (A + 1 - (A - 1) * c - sq) / a0,
    );
  }

  process(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

/** FFT compleja radix-2 in-place. `re`/`im` de longitud potencia de 2. */
export class FFT {
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly rev: Uint32Array;
  constructor(readonly n: number) {
    if ((n & (n - 1)) !== 0) throw new Error("FFT size must be a power of 2");
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((-2 * Math.PI * i) / n);
    }
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
  }

  transform(re: Float64Array, im: Float64Array): void {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const j = this.rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step];
          const wi = this.sin[k * step];
          const a = start + k;
          const b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  }
}

/** Downsample por factor entero promediando (filtro caja + diezmado). */
export function decimate(x: Float32Array, factor: number): Float32Array {
  if (factor <= 1) return x;
  const n = Math.floor(x.length / factor);
  const out = new Float32Array(n);
  const inv = 1 / factor;
  for (let i = 0, j = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < factor; k++) s += x[j++];
    out[i] = s * inv;
  }
  return out;
}
