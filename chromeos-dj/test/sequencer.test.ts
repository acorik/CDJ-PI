import test from "node:test";
import assert from "node:assert/strict";
(globalThis as any).window = globalThis;
import { Sequencer, BASS_TRACK } from "../src/live/sequencer";

// reloj falso: 120 BPM -> paso (1/16) = 0.125 s, paso 0 en t = 0
function fakeClock() {
  const c: any = { ref: { t: 0, s: 0, dur: 0.125 }, update() {}, stepAt(t: number) { return c.ref.s + (t - c.ref.t) / c.ref.dur; }, timeOf(s: number) { return c.ref.t + (s - c.ref.s) * c.ref.dur; } };
  return c;
}

function setup(latency = 0) {
  let now = 0;
  const hits: { tr: number; t: number }[] = [];
  const clock = fakeClock();
  const seq = new Sequencer(clock, { drum: (tr, _v, t) => hits.push({ tr, t }), bass: (n, _v, t) => hits.push({ tr: 100 + n, t }) }, () => now, () => latency);
  const tick = () => (seq as any).tick();
  return { seq, clock, hits, tick, setNow: (t: number) => { now = t; } };
}

test("graba cuantizado a la semicorchea más cercana, descontando la latencia", () => {
  const { seq, setNow } = setup(0.04);
  seq.start(); seq.stop(); seq.playing = true;
  setNow(0.54); // se oye 0.50 = paso 4
  const idx = seq.record(0, 110);
  assert.equal(idx, 4);
  assert.equal(seq.pat.vel[0][4], 110);
  setNow(1.0 + 0.05); // se oye ~1.01 -> paso 8
  assert.equal(seq.record(BASS_TRACK, 90, 3), 8);
  assert.equal(seq.pat.bass[8], 3);
});

test("reproduce en su sitio y no duplica un golpe grabado por delante", () => {
  const { seq, hits, tick, setNow } = setup(0);
  seq.pat.vel[2][0] = 100; // paso 0 de cada compás
  setNow(0); (seq as any).lastStep = -1; seq.playing = true;
  for (let t = 0; t < 2.1; t += 0.02) { setNow(t); tick(); }
  const times = hits.filter((x) => x.tr === 2).map((x) => +x.t.toFixed(3));
  assert.deepEqual(times, [0, 2]);
  // golpe tocado justo antes del paso 20 (t=2.49): se graba en el 20 y no vuelve a sonar en esa pasada
  hits.length = 0;
  setNow(2.47); tick();
  seq.record(5, 100);
  for (let t = 2.48; t < 2.7; t += 0.02) { setNow(t); tick(); }
  assert.equal(hits.filter((x) => x.tr === 5).length, 0);
});

test("si el master salta atrás (loop), el secuenciador le sigue", () => {
  const { seq, hits, tick, setNow, clock } = setup(0);
  seq.pat.vel[0][0] = 100;
  seq.playing = true; (seq as any).lastStep = -1;
  for (let t = 0; t < 1.9; t += 0.02) { setNow(t); tick(); }
  // el deck vuelve 1 compás atrás: en t=1.9 vuelve a estar en el paso 0
  clock.ref = { t: 1.9, s: 0, dur: 0.125 };
  hits.length = 0;
  for (let t = 1.9; t < 2.0; t += 0.02) { setNow(t); tick(); }
  assert.ok(hits.some((x) => x.tr === 0), "debe volver a sonar el paso 0");
});
