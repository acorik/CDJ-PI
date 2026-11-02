// Notaciones de tonalidad: índice interno 0..11 = mayor (C=0), 12..23 = menor.

export type KeyNotation = "camelot" | "openkey" | "classic";

const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const MINOR_NAMES = ["Cm", "C#m", "Dm", "Ebm", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "Bbm", "Bm"];

export function camelotNumber(key: number): number {
  const major = key < 12;
  const pc = major ? key : (key - 12 + 3) % 12; // relativo mayor de la menor
  return ((pc * 7) % 12 + 7) % 12 + 1;
}

export function camelot(key: number): string {
  if (key < 0) return "";
  return `${camelotNumber(key)}${key < 12 ? "B" : "A"}`;
}

export function openKey(key: number): string {
  if (key < 0) return "";
  const n = ((camelotNumber(key) - 8 + 12) % 12) + 1;
  return `${n}${key < 12 ? "d" : "m"}`;
}

export function classic(key: number): string {
  if (key < 0) return "";
  return key < 12 ? NAMES[key] : MINOR_NAMES[key - 12];
}

export function formatKey(key: number, notation: KeyNotation): string {
  if (notation === "openkey") return openKey(key);
  if (notation === "classic") return classic(key);
  return camelot(key);
}

/** Desplaza la tonalidad `semis` semitonos. */
export function shiftKey(key: number, semis: number): number {
  if (key < 0) return key;
  const s = Math.round(semis);
  const minor = key >= 12;
  const pc = ((key % 12) + s + 1200) % 12;
  return minor ? pc + 12 : pc;
}

/** Compatibilidad armónica (rueda Camelot): misma, ±1, relativa. */
export function harmonicDistance(a: number, b: number): number {
  if (a < 0 || b < 0) return 99;
  const na = camelotNumber(a), nb = camelotNumber(b);
  const la = a < 12, lb = b < 12;
  let d = Math.abs(na - nb);
  d = Math.min(d, 12 - d);
  if (la === lb) return d; // 0 = igual, 1 = adyacente
  return d === 0 ? 1 : d + 1; // relativa = 1
}

export function isCompatible(a: number, b: number): boolean {
  return harmonicDistance(a, b) <= 1;
}

/** Color estilo rueda Camelot para el badge de tonalidad. */
export function keyColor(key: number): string {
  if (key < 0) return "#666";
  const n = camelotNumber(key);
  const hue = ((n - 1) * 30 + 150) % 360;
  return `hsl(${hue} 70% ${key < 12 ? 60 : 50}%)`;
}

/** Interpreta etiquetas TKEY ("Am", "8A", "1m", "F#maj"...) */
export function parseKeyTag(tag: string): number {
  const t = tag.trim();
  if (!t) return -1;
  let m = /^(\d{1,2})\s*([AaBb])$/.exec(t);
  if (m) {
    const n = +m[1];
    if (n < 1 || n > 12) return -1;
    for (let k = 0; k < 24; k++) if (camelotNumber(k) === n && (k < 12) === (m[2].toUpperCase() === "B")) return k;
    return -1;
  }
  m = /^(\d{1,2})\s*([dDmM])$/.exec(t);
  if (m) {
    const n = +m[1];
    if (n < 1 || n > 12) return -1;
    const cam = ((n - 1 + 7) % 12) + 1;
    for (let k = 0; k < 24; k++) if (camelotNumber(k) === cam && (k < 12) === (m[2].toLowerCase() === "d")) return k;
    return -1;
  }
  m = /^([A-Ga-g])([#b♯♭]?)\s*(m|min|minor|maj|major)?$/i.exec(t);
  if (m) {
    const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    let pc = base[m[1].toUpperCase()];
    if (m[2] === "#" || m[2] === "♯") pc++;
    if (m[2] === "b" || m[2] === "♭") pc--;
    pc = (pc + 12) % 12;
    const minor = !!m[3] && /^m(in(or)?)?$/i.test(m[3]) && m[3] !== "M";
    return minor ? pc + 12 : pc;
  }
  return -1;
}

/**
 * Semitonos (−6..+5) a aplicar a `key` para que sea compatible con `target`.
 * Prefiere la misma tonalidad (o relativa); si no, adyacente. Menor |s| gana.
 */
export function keySyncShift(key: number, target: number): number {
  if (key < 0 || target < 0) return 0;
  let best = 0, bestScore = Infinity;
  for (let s = -6; s <= 5; s++) {
    const d = harmonicDistance(shiftKey(key, s), target);
    const score = d * 10 + Math.abs(s);
    if (score < bestScore) { bestScore = score; best = s; }
  }
  return best;
}
