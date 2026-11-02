import test from "node:test";
import assert from "node:assert/strict";
import { detectBeats } from "../src/analysis/bpm";
import { detectKey } from "../src/analysis/key";
import { analyzeMono } from "../src/analysis/analyze";
import { synthTrack } from "./synth";

const SR = 22050;

for (const bpm of [124, 128, 140, 174, 95.5]) {
  test(`detecta ${bpm} BPM y la fase del grid`, () => {
    const offset = 0.37;
    const x = synthTrack({ bpm, seconds: 60, sr: SR, offset, rootHz: 220, minor: true });
    const b = detectBeats(x, SR, 88);
    assert.ok(Math.abs(b.bpm - bpm) < 0.05, `bpm ${b.bpm}`);
    const beat = 60 / bpm;
    const expected = offset % beat;
    let err = Math.abs(b.firstBeat - expected);
    err = Math.min(err, beat - err);
    assert.ok(err < 0.015, `firstBeat ${b.firstBeat} esperado ${expected}`);
  });
}

test("detecta La menor (8A)", () => {
  const x = synthTrack({ bpm: 124, seconds: 40, sr: SR, offset: 0, rootHz: 220, minor: true });
  assert.equal(detectKey(x, SR).key, 12 + 9);
});

test("detecta Sol mayor (9B)", () => {
  const x = synthTrack({ bpm: 124, seconds: 40, sr: SR, offset: 0, rootHz: 196, minor: false });
  assert.equal(detectKey(x, SR).key, 7);
});

test("analyzeMono devuelve waveform y loudness coherentes", () => {
  const x = synthTrack({ bpm: 126, seconds: 30, sr: SR, offset: 0.2, rootHz: 220, minor: true });
  const r = analyzeMono(x, SR);
  assert.equal(r.wf.length % 4, 0);
  assert.ok(Math.abs(r.wf.length / 4 - 30 * r.wfRate) < 3);
  assert.ok(r.loudness < 0 && r.loudness > -40, `loudness ${r.loudness}`);
  assert.ok(r.firstSound < 0.25);
});
