export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export const SCALES: Record<string, { name: string; steps: number[] }> = {
  minor: { name: "Menor natural", steps: [0, 2, 3, 5, 7, 8, 10] },
  major: { name: "Mayor", steps: [0, 2, 4, 5, 7, 9, 11] },
  dorian: { name: "Dórica", steps: [0, 2, 3, 5, 7, 9, 10] },
  phrygian: { name: "Frigia", steps: [0, 1, 3, 5, 7, 8, 10] },
  lydian: { name: "Lidia", steps: [0, 2, 4, 6, 7, 9, 11] },
  mixolydian: { name: "Mixolidia", steps: [0, 2, 4, 5, 7, 9, 10] },
  harmonic: { name: "Menor armónica", steps: [0, 2, 3, 5, 7, 8, 11] },
  penta_minor: { name: "Pentatónica menor", steps: [0, 3, 5, 7, 10] },
  penta_major: { name: "Pentatónica mayor", steps: [0, 2, 4, 7, 9] },
  blues: { name: "Blues", steps: [0, 3, 5, 6, 7, 10] },
  chromatic: { name: "Cromática", steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
};

export function midiToHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export function noteName(m: number): string {
  return `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

/** Nota MIDI del grado `i` (0 = tónica) de la escala, a partir de la octava `baseMidi`. */
export function scaleNote(root: number, scale: string, i: number, baseMidi: number): number {
  const st = (SCALES[scale] ?? SCALES.minor).steps;
  const oct = Math.floor(i / st.length);
  const deg = ((i % st.length) + st.length) % st.length;
  return baseMidi + root + st[deg] + 12 * oct;
}

/**
 * Acorde diatónico sobre el grado `degree` (0..6) apilando terceras de la
 * escala. `size` 3 = tríada, 4 = cuatriada (7ª), 5 = novena.
 */
export function diatonicChord(root: number, scale: string, degree: number, size = 3, baseMidi = 48): number[] {
  let sc = (SCALES[scale] ?? SCALES.minor).steps;
  if (sc.length !== 7) sc = SCALES[scale.includes("major") ? "major" : "minor"].steps; // pentas/blues -> heptatónica
  const notes: number[] = [];
  for (let k = 0; k < size; k++) {
    const idx = degree + k * 2;
    notes.push(baseMidi + root + sc[idx % 7] + 12 * Math.floor(idx / 7));
  }
  // voicing compacto: que no suba demasiado
  while (notes[0] > baseMidi + 11) for (let k = 0; k < notes.length; k++) notes[k] -= 12;
  return notes;
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];

/** Nombre del acorde (p. ej. "Am", "C", "Bdim", "G7") a partir de sus notas. */
export function chordName(notes: number[]): string {
  const r = notes[0];
  const third = (notes[1] - r + 120) % 12;
  const fifth = (notes[2] - r + 120) % 12;
  let q = third === 3 ? (fifth === 6 ? "dim" : "m") : fifth === 8 ? "aug" : "";
  if (notes.length >= 4) {
    const sev = (notes[3] - r + 120) % 12;
    if (q === "" && sev === 11) q = "maj7";
    else if (q === "m" && sev === 10) q = "m7";
    else if (q === "" && sev === 10) q = "7";
    else if (q === "dim" && sev === 10) q = "m7b5";
    else q += "7";
  }
  return `${NOTE_NAMES[((r % 12) + 12) % 12]}${q}`;
}

export function romanFor(degree: number, notes: number[]): string {
  const third = (notes[1] - notes[0] + 120) % 12;
  const fifth = (notes[2] - notes[0] + 120) % 12;
  const base = ROMAN[degree % 7];
  if (third === 3) return fifth === 6 ? `${base.toLowerCase()}°` : base.toLowerCase();
  return base;
}
