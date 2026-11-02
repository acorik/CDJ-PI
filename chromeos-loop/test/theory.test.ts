import test from "node:test";
import assert from "node:assert/strict";
import { diatonicChord, chordName, scaleNote } from "../src/synth/theory";
import { PRESETS, CATEGORIES } from "../src/synth/presets";

test("acordes diatónicos en La menor", () => {
  assert.equal(chordName(diatonicChord(9, "minor", 0, 3)), "Am");
  assert.equal(chordName(diatonicChord(9, "minor", 2, 3)), "C");
  assert.equal(chordName(diatonicChord(9, "minor", 1, 3)), "Bdim");
  assert.equal(chordName(diatonicChord(9, "minor", 0, 4)), "Am7");
  assert.equal(chordName(diatonicChord(0, "major", 4, 4)), "G7");
  assert.equal(chordName(diatonicChord(0, "major", 0, 4)), "Cmaj7");
});

test("notas de escala", () => {
  assert.equal(scaleNote(9, "minor", 0, 48), 57);
  assert.equal(scaleNote(9, "minor", 7, 48), 69);
  assert.equal(scaleNote(0, "penta_minor", 5, 60), 72);
});

test("banco de presets", () => {
  assert.ok(PRESETS.length >= 130, `${PRESETS.length} presets`);
  assert.ok(CATEGORIES.length >= 10);
  assert.equal(new Set(PRESETS.map((p) => p.name)).size, PRESETS.length, "nombres únicos");
  for (const p of PRESETS) {
    assert.ok(p.vol > 0 && p.vol <= 1, p.name);
    assert.ok(p.fc > 0 && p.a >= 0 && p.r >= 0, p.name);
  }
});
