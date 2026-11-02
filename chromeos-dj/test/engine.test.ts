import test from "node:test";
import assert from "node:assert/strict";

// Entorno AudioWorklet simulado.
const SR = 48000;
let ctor: any = null;
const g = globalThis as any;
g.sampleRate = SR;
g.currentTime = 0;
g.AudioWorkletProcessor = class { port: any; constructor() { this.port = { postMessage: (m: any) => sent.push(m), onmessage: null }; } };
g.registerProcessor = (_n: string, c: any) => { ctor = c; };
const sent: any[] = [];

async function makeEngine() {
  if (!ctor) await import("../src/worklet/engine-processor");
  const p = new ctor();
  const send = (m: any) => p.port.onmessage({ data: m });
  const outs = [0, 1, 2, 3].map(() => [new Float32Array(128), new Float32Array(128)]);
  const run = (blocks: number, deck = 0) => {
    const L: number[] = [];
    for (let b = 0; b < blocks; b++) { p.process([], outs); L.push(...outs[deck][0]); }
    return Float32Array.from(L);
  };
  return { p, send, run };
}

function sineTrack(freq: number, seconds: number) {
  const n = SR * seconds;
  const L = new Int16Array(n), R = new Int16Array(n);
  for (let i = 0; i < n; i++) L[i] = R[i] = Math.round(Math.sin((2 * Math.PI * freq * i) / SR) * 16000);
  return { L, R };
}

function freqOf(x: Float32Array): number {
  let z = 0;
  for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) z++;
  return (z * SR) / x.length;
}

test("tempo +10% sin keylock sube el tono un 10%", async () => {
  const { send, run } = await makeEngine();
  send({ t: "load", d: 0, ...sineTrack(440, 5), bpm: 120, firstBeat: 0 });
  send({ t: "tempo", d: 0, v: 1.1 });
  send({ t: "play", d: 0, on: true });
  run(20);
  const f = freqOf(run(200));
  assert.ok(Math.abs(f - 484) < 3, `freq ${f}`);
});

test("tempo +10% con keylock (WSOLA) mantiene el tono y avanza un 10% más rápido", async () => {
  const { p, send, run } = await makeEngine();
  send({ t: "load", d: 0, ...sineTrack(440, 8), bpm: 120, firstBeat: 0 });
  send({ t: "tempo", d: 0, v: 1.1 });
  send({ t: "keylock", d: 0, on: true });
  send({ t: "play", d: 0, on: true });
  run(40);
  const pos0 = p.decks[0].pos;
  const f = freqOf(run(375)); // 1 s
  const adv = (p.decks[0].pos - pos0) / SR;
  assert.ok(Math.abs(f - 440) < 4, `freq ${f}`);
  assert.ok(Math.abs(adv - 1.1) < 0.01, `avance ${adv}`);
});

test("loop de 1 beat se repite sin salirse", async () => {
  const { p, send, run } = await makeEngine();
  send({ t: "load", d: 0, ...sineTrack(440, 10), bpm: 120, firstBeat: 0 });
  send({ t: "loop", d: 0, start: 1, end: 1.5, on: true, jump: true });
  send({ t: "play", d: 0, on: true });
  for (let k = 0; k < 50; k++) {
    run(10);
    const s = p.decks[0].pos / SR;
    assert.ok(s >= 0.999 && s < 1.5, `pos ${s}`);
  }
});

test("sync iguala tempo y alinea la fase con el master", async () => {
  const { p, send, run } = await makeEngine();
  const t = sineTrack(220, 30);
  send({ t: "load", d: 0, ...t, bpm: 128, firstBeat: 0.1 });
  send({ t: "load", d: 1, L: t.L, R: t.R, bpm: 125, firstBeat: 0.33 });
  send({ t: "master", d: 0 });
  send({ t: "tempo", d: 0, v: 1.02 });
  send({ t: "play", d: 0, on: true });
  run(100);
  send({ t: "sync", d: 1, on: true });
  send({ t: "play", d: 1, on: true });
  run(400);
  const d0 = p.decks[0], d1 = p.decks[1];
  const eff0 = 128 * 1.02, eff1 = 125 * d1.speed;
  assert.ok(Math.abs(eff0 - eff1) < 0.3, `bpm ${eff0} vs ${eff1}`);
  const ph = (d: any, bpm: number, fb: number) => { const v = (d.pos / SR - fb) / (60 / bpm); return v - Math.floor(v); };
  let diff = Math.abs(ph(d0, 128, 0.1) - ph(d1, 125, 0.33));
  diff = Math.min(diff, 1 - diff);
  assert.ok(diff < 0.002, `desfase ${diff} beats`);
});

test("slip vuelve a la posición fantasma al soltar", async () => {
  const { p, send, run } = await makeEngine();
  send({ t: "load", d: 0, ...sineTrack(440, 10), bpm: 120, firstBeat: 0 });
  send({ t: "play", d: 0, on: true });
  run(100);
  send({ t: "slip", d: 0, on: true });
  send({ t: "loop", d: 0, start: p.decks[0].pos / SR, end: p.decks[0].pos / SR + 0.25, on: true });
  run(375);
  const before = p.decks[0].pos;
  send({ t: "loopOff", d: 0 });
  send({ t: "slip", d: 0, on: false, ret: true });
  assert.ok(p.decks[0].pos - before > SR * 0.5, "debe saltar hacia delante");
});

test("sync al dar play desde el inicio (desfase negativo) alinea un beat más adelante", async () => {
  const { p, send, run } = await makeEngine();
  const t = sineTrack(220, 30);
  send({ t: "load", d: 0, ...t, bpm: 124, firstBeat: 0.366 });
  send({ t: "load", d: 1, L: t.L, R: t.R, bpm: 128, firstBeat: 0.117, pos: 0 });
  send({ t: "master", d: 0 });
  send({ t: "play", d: 0, on: true });
  run(150);
  send({ t: "sync", d: 1, on: true });
  send({ t: "play", d: 1, on: true });
  run(40);
  const ph = (d: any, bpm: number, fb: number) => { const v = (d.pos / SR - fb) / (60 / bpm); return v - Math.floor(v); };
  let diff = Math.abs(ph(p.decks[0], 124, 0.366) - ph(p.decks[1], 128, 0.117));
  diff = Math.min(diff, 1 - diff);
  assert.ok(diff < 0.002, `desfase ${diff} beats`);
});
