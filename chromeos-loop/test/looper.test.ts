import test from "node:test";
import assert from "node:assert/strict";

const SR = 48000;
const g = globalThis as any;
let ctor: any = null;
g.sampleRate = SR;
g.currentFrame = 0;
g.AudioWorkletProcessor = class { port: any; constructor() { this.port = { postMessage: (m: any) => sent.push(m), onmessage: null }; } };
g.registerProcessor = (_n: string, c: any) => { ctor = c; };
const sent: any[] = [];

const BAR = 5120; // compás corto para tests, múltiplo de 128 (bloque del worklet)

async function make() {
  if (!ctor) await import("../src/looper/looper-processor");
  const p = new ctor();
  g.currentFrame = 0;
  const send = (m: any) => p.port.onmessage({ data: m });
  send({ t: "transport", t0: 0, bar: BAR, running: true, maxBars: 8 });
  const outs = Array.from({ length: 8 }, () => [new Float32Array(128), new Float32Array(128)]);
  /** avanza N muestras; `input(frame)` = valor de la entrada 0 en ese frame absoluto */
  const run = (frames: number, input: (f: number) => number = () => 0, capture = -1) => {
    const got: number[] = [];
    for (let done = 0; done < frames; done += 128) {
      const inL = new Float32Array(128);
      for (let i = 0; i < 128; i++) inL[i] = input(g.currentFrame + i);
      p.process([[inL, inL], [new Float32Array(128), new Float32Array(128)]], outs);
      if (capture >= 0) got.push(...outs[capture][0]);
      g.currentFrame += 128;
    }
    return got;
  };
  return { p, send, run };
}

// impulso de 1.0 en el inicio de cada beat (4 por compás) — "lo que el músico toca"
const clicks = (lat: number) => (f: number) => ((f - lat) % (BAR / 4) === 0 && f >= lat ? 1 : 0);

test("graba 1 compás alineado a la rejilla compensando la latencia", async () => {
  const { p, send, run } = await make();
  const LAT = 300;
  send({ t: "comp", live: LAT, mic: 0 });
  send({ t: "rec", tr: 0, start: BAR, end: 2 * BAR, then: "play" });
  run(3 * BAR + 1024, clicks(LAT));
  const t = p.tracks[0];
  assert.equal(t.len, BAR);
  assert.ok(!t.rec, "la grabación debe haberse cerrado");
  // los clics deben estar en cada beat (no desplazados por la latencia)
  for (const k of [0, 1280, 2560, 3840]) assert.ok(Math.abs(t.L[k]) > 0.5, `pico en ${k}: ${t.L[k]}`);
  assert.ok(Math.abs(t.L[LAT]) < 0.01);
});

test("REC pulsado tarde empieza en el compás que acaba de pasar (historial)", async () => {
  const { p, send, run } = await make();
  run(BAR + 2000, clicks(0)); // ya vamos 2000 muestras dentro del compás 1
  send({ t: "rec", tr: 1, start: BAR, end: 2 * BAR });
  run(2 * BAR, clicks(0));
  const t = p.tracks[1];
  assert.equal(t.len, BAR);
  assert.ok(t.L[0] > 0.5 && t.L[1280] > 0.5, "debe contener el principio del compás");
});

test("la pista suena en sincronía con la rejilla y loops de 1 y 2 compases cuadran", async () => {
  const { p, send, run } = await make();
  send({ t: "rec", tr: 0, start: 0, end: BAR });
  run(BAR + 512, clicks(0));
  send({ t: "rec", tr: 1, start: 2 * BAR, end: 4 * BAR });
  run(4 * BAR - (BAR + 512) + 512, clicks(0));
  // escucha desde el compás 10: ambas pistas tienen clic exactamente en los beats
  run(10 * BAR - g.currentFrame);
  const o0 = run(BAR, () => 0, 0);
  const o1 = run(0);
  void o1;
  for (const k of [0, 1280, 2560, 3840]) assert.ok(o0[k] > 0.3, `pista 0 en beat ${k}: ${o0[k]}`);
  assert.equal(p.tracks[1].len, 2 * BAR);
  const o1b = run(BAR, () => 0, 1);
  for (const k of [0, 1280, 2560, 3840]) assert.ok(o1b[k] > 0.3, `pista 1 en beat ${k}: ${o1b[k]}`);
});

test("overdub suma capas y undo/redo funcionan", async () => {
  const { p, send, run } = await make();
  send({ t: "rec", tr: 0, start: 0, end: BAR });
  run(BAR + 512, clicks(0));
  const before = p.tracks[0].L[600];
  send({ t: "dub", tr: 0, start: 2 * BAR });
  run(3 * BAR - g.currentFrame, (f) => ((f % BAR) === 600 ? 0.7 : 0));
  send({ t: "dubEnd", tr: 0, end: 3 * BAR });
  run(BAR);
  const t = p.tracks[0];
  assert.ok(Math.abs(t.L[600] - (before + 0.7)) < 1e-4, `overdub ${t.L[600]}`);
  send({ t: "undo", tr: 0 });
  assert.ok(Math.abs(t.L[600] - before) < 1e-6);
  send({ t: "redo", tr: 0 });
  assert.ok(Math.abs(t.L[600] - (before + 0.7)) < 1e-4);
});

test("grabación libre se cierra en el compás pedido y la costura no hace clic", async () => {
  const { p, send, run } = await make();
  const sine = (f: number) => Math.sin(f * 0.01);
  send({ t: "rec", tr: 2, start: 0, end: -1 });
  run(BAR + 1000, sine);
  send({ t: "recEnd", tr: 2, end: 2 * BAR });
  run(2 * BAR, sine);
  const t = p.tracks[2];
  assert.equal(t.len, 2 * BAR);
  const jump = Math.abs(t.L[0] - t.L[t.len - 1]);
  assert.ok(jump < 0.02, `salto en la costura ${jump}`);
});
