import test from "node:test";
import assert from "node:assert/strict";
import { camelot, openKey, parseKeyTag, isCompatible, keySyncShift, shiftKey } from "../src/util/key";

test("Camelot y Open Key", () => {
  assert.equal(camelot(21), "8A"); // Am
  assert.equal(camelot(0), "8B"); // C
  assert.equal(camelot(7), "9B"); // G
  assert.equal(camelot(5), "7B"); // F
  assert.equal(camelot(11), "1B"); // B
  assert.equal(camelot(12 + 4), "9A"); // Em
  assert.equal(openKey(0), "1d");
  assert.equal(openKey(21), "1m");
});

test("parseKeyTag", () => {
  assert.equal(parseKeyTag("Am"), 21);
  assert.equal(parseKeyTag("8A"), 21);
  assert.equal(parseKeyTag("1m"), 21);
  assert.equal(parseKeyTag("F#"), 6);
  assert.equal(parseKeyTag("Bbm"), 22);
  assert.equal(parseKeyTag("Cmaj"), 0);
});

test("compatibilidad y key sync", () => {
  assert.ok(isCompatible(21, 0)); // Am - C relativa
  assert.ok(isCompatible(21, 12 + 4)); // 8A - 9A
  assert.ok(!isCompatible(21, 12 + 6)); // 8A - F#m(11A)
  const s = keySyncShift(12 + 6, 21);
  assert.ok(isCompatible(shiftKey(12 + 6, s), 21));
  assert.ok(Math.abs(s) <= 3);
});
