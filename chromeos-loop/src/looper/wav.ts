/** WAV estéreo 16 bits (para exportar loops y mezclas). */
export function encodeWav(L: Float32Array, R: Float32Array, sr: number): Blob {
  const n = L.length;
  const buf = new ArrayBuffer(44 + n * 4);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + n * 4, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, n * 4, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, L[i])), r = Math.max(-1, Math.min(1, R[i]));
    v.setInt16(o, l * 32767, true); v.setInt16(o + 2, r * 32767, true); o += 4;
  }
  return new Blob([buf], { type: "audio/wav" });
}

/** Mezcla de todas las pistas alineadas a la rejilla, de la longitud del loop más largo. */
export function mixdown(tracks: ({ L: Float32Array; R: Float32Array; offset: number; vol: number; rev: boolean } | null)[]): { L: Float32Array; R: Float32Array } | null {
  const live = tracks.filter((t): t is NonNullable<typeof t> => !!t);
  if (!live.length) return null;
  const len = Math.max(...live.map((t) => t.L.length));
  const L = new Float32Array(len), R = new Float32Array(len);
  // empieza en el inicio del loop más largo
  const ref = live.find((t) => t.L.length === len)!;
  for (const t of live) {
    const n = t.L.length;
    for (let i = 0; i < len; i++) {
      let p = (((ref.offset + i - t.offset) % n) + n) % n;
      if (t.rev) p = n - 1 - p;
      L[i] += t.L[p] * t.vol; R[i] += t.R[p] * t.vol;
    }
  }
  return { L, R };
}
