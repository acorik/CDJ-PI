import { FxUnit, type BeatSource } from "./fx";
import { Sampler } from "./sampler";
import { settings, latencyHint, type OutputMode } from "../settings";

export const NDECK = 4;

/** Curvas de knob: 0..1, 0.5 = neutro. */
export function eqGain(v: number): number {
  if (v >= 0.5) return Math.pow(10, ((v - 0.5) / 0.5) * 6 / 20); // hasta +6 dB
  return Math.pow(v / 0.5, 2.2); // hasta kill total (isolator)
}

export function trimGain(v: number): number {
  // -∞..+12 dB, centro 0 dB
  if (v >= 0.5) return Math.pow(10, ((v - 0.5) / 0.5) * 12 / 20);
  return Math.pow(v / 0.5, 2);
}

export class Channel {
  readonly input: GainNode;
  readonly trim: GainNode;
  readonly autoGain: GainNode;
  private low: GainNode;
  private mid: GainNode;
  private high: GainNode;
  private lp: BiquadFilterNode;
  private hp: BiquadFilterNode;
  readonly fxSend: GainNode;
  readonly fxReturn: GainNode;
  readonly fader: GainNode;
  /** puerta para los "fader cuts" de los pads */
  readonly cut: GainNode;
  readonly xf: GainNode;
  readonly pfl: GainNode;
  readonly analyser: AnalyserNode;
  private meterBuf: Float32Array;
  state = { trim: 0.5, low: 0.5, mid: 0.5, high: 0.5, filter: 0.5, fader: 0, pfl: false };

  constructor(private ctx: AudioContext) {
    const g = () => ctx.createGain();
    const bq = (type: BiquadFilterType, f: number, q = Math.SQRT1_2) => {
      const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b;
    };
    this.input = g(); this.trim = g(); this.autoGain = g();
    this.input.connect(this.autoGain); this.autoGain.connect(this.trim);
    // Isolator de 3 bandas (Linkwitz-Riley 24 dB/oct): 200 Hz / 2.5 kHz, kill real.
    const F1 = 200, F2 = 2500;
    const lp1a = bq("lowpass", F1), lp1b = bq("lowpass", F1);
    const hp1a = bq("highpass", F1), hp1b = bq("highpass", F1);
    const lp2a = bq("lowpass", F2), lp2b = bq("lowpass", F2);
    const hp2a = bq("highpass", F2), hp2b = bq("highpass", F2);
    this.low = g(); this.mid = g(); this.high = g();
    const sum = g();
    this.trim.connect(lp1a); lp1a.connect(lp1b); lp1b.connect(this.low); this.low.connect(sum);
    this.trim.connect(hp1a); hp1a.connect(hp1b); hp1b.connect(lp2a); lp2a.connect(lp2b); lp2b.connect(this.mid); this.mid.connect(sum);
    this.trim.connect(hp2a); hp2a.connect(hp2b); hp2b.connect(this.high); this.high.connect(sum);
    // Filtro (knob FILTER): LPF a la izquierda, HPF a la derecha.
    this.lp = bq("lowpass", 22000, 1.2);
    this.hp = bq("highpass", 10, 1.2);
    sum.connect(this.lp); this.lp.connect(this.hp);
    this.fxSend = g(); this.fxReturn = g();
    this.hp.connect(this.fxSend);
    this.fxSend.connect(this.fxReturn);
    this.fader = g(); this.cut = g(); this.xf = g(); this.pfl = g();
    this.fxReturn.connect(this.fader); this.fader.connect(this.cut); this.cut.connect(this.xf);
    this.fxReturn.connect(this.pfl);
    this.pfl.gain.value = 0;
    this.fader.gain.value = 0;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.fxReturn.connect(this.analyser);
    this.meterBuf = new Float32Array(this.analyser.fftSize);
  }

  private set(p: AudioParam, v: number, tc = 0.01) {
    p.setTargetAtTime(v, this.ctx.currentTime, tc);
  }

  setTrim(v: number) { this.state.trim = v; this.set(this.trim.gain, trimGain(v)); }
  setAutoGainDb(db: number) { this.set(this.autoGain.gain, Math.pow(10, db / 20), 0.05); }
  setEq(band: "low" | "mid" | "high", v: number) {
    this.state[band] = v;
    this.set(this[band].gain, eqGain(v));
  }
  setFilter(v: number) {
    this.state.filter = v;
    const dz = 0.03;
    if (v < 0.5 - dz) {
      const x = (0.5 - dz - v) / (0.5 - dz); // 0..1
      this.set(this.lp.frequency, 20000 * Math.pow(70 / 20000, x), 0.02);
      this.set(this.hp.frequency, 10, 0.02);
    } else if (v > 0.5 + dz) {
      const x = (v - 0.5 - dz) / (0.5 - dz);
      this.set(this.hp.frequency, 20 * Math.pow(9000 / 20, x), 0.02);
      this.set(this.lp.frequency, 22000, 0.02);
    } else {
      this.set(this.lp.frequency, 22000, 0.02);
      this.set(this.hp.frequency, 10, 0.02);
    }
  }
  setFader(v: number) {
    this.state.fader = v;
    // curva tipo DJM: casi lineal en dB en la parte alta
    this.set(this.fader.gain, v <= 0 ? 0 : Math.pow(v, 1.6), 0.008);
  }
  setPfl(on: boolean) { this.state.pfl = on; this.set(this.pfl.gain, on ? 1 : 0, 0.01); }
  setXf(g: number) { this.set(this.xf.gain, g, 0.005); }

  /** Nivel pico (0..1) pre-fader para el VU. */
  level(): number {
    this.analyser.getFloatTimeDomainData(this.meterBuf as Float32Array<ArrayBuffer>);
    let p = 0;
    for (let i = 0; i < this.meterBuf.length; i++) { const a = Math.abs(this.meterBuf[i]); if (a > p) p = a; }
    return p;
  }
}

export class AudioEngine {
  readonly ctx: AudioContext;
  node!: AudioWorkletNode;
  readonly channels: Channel[] = [];
  readonly masterSum: GainNode;
  readonly masterGain: GainNode;
  readonly limiter: DynamicsCompressorNode;
  readonly masterOut: GainNode;
  readonly cueBus: GainNode;
  private cueSide: GainNode;
  private mstSide: GainNode;
  readonly cueOut: GainNode;
  private masterAnalyserL: AnalyserNode;
  private masterAnalyserR: AnalyserNode;
  private mBuf: Float32Array;
  readonly fx: FxUnit[] = [];
  readonly sampler: Sampler;
  private routing: AudioNode[] = [];
  private cueAudio: HTMLAudioElement | null = null;
  private recorder: MediaRecorder | null = null;
  private recChunks: Blob[] = [];
  recStart = 0;
  xfader = 0.5;
  /** canal asignado a cada lado del crossfader: 0 = A, 1 = B, 2 = thru */
  xfAssign = [0, 1, 0, 1];
  maxChannels = 2;
  onState: ((m: any) => void) | null = null;

  private constructor(ctx: AudioContext) {
    this.ctx = ctx;
    const g = () => ctx.createGain();
    this.masterSum = g(); this.masterGain = g(); this.masterOut = g();
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1; this.limiter.knee.value = 0; this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002; this.limiter.release.value = 0.12;
    this.masterSum.connect(this.masterGain);
    this.setLimiter(settings.limiter);
    this.cueBus = g(); this.cueSide = g(); this.mstSide = g(); this.cueOut = g();
    this.cueBus.connect(this.cueSide); this.cueSide.connect(this.cueOut);
    this.masterOut.connect(this.mstSide); this.mstSide.connect(this.cueOut);
    this.setCueMix(0);
    const split = ctx.createChannelSplitter(2);
    this.masterOut.connect(split);
    this.masterAnalyserL = ctx.createAnalyser(); this.masterAnalyserR = ctx.createAnalyser();
    this.masterAnalyserL.fftSize = this.masterAnalyserR.fftSize = 512;
    split.connect(this.masterAnalyserL, 0); split.connect(this.masterAnalyserR, 1);
    this.mBuf = new Float32Array(512);
    for (let i = 0; i < NDECK; i++) {
      const ch = new Channel(ctx);
      ch.xf.connect(this.masterSum);
      ch.pfl.connect(this.cueBus);
      this.channels.push(ch);
    }
    this.sampler = new Sampler(ctx);
    this.sampler.output.connect(this.masterSum);
    this.applyXfader();
  }

  static async create(beatSources: BeatSource[]): Promise<AudioEngine> {
    const opts: any = { latencyHint: latencyHint() };
    if (settings.masterDevice) opts.sinkId = settings.masterDevice;
    let ctx: AudioContext;
    try { ctx = new AudioContext(opts); }
    catch { delete opts.sinkId; ctx = new AudioContext(opts); }
    // Blob URL (HTTPS) y, si falla, data: URL — con file:// el origen es "null"
    // y Chrome rechaza el worklet desde blob:, pero acepta data:.
    try {
      await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([__WORKLET_SRC__], { type: "text/javascript" })));
    } catch {
      await ctx.audioWorklet.addModule(`data:text/javascript;charset=utf-8,${encodeURIComponent(__WORKLET_SRC__)}`);
    }
    const e = new AudioEngine(ctx);
    e.node = new AudioWorkletNode(ctx, "dj-engine", {
      numberOfInputs: 0, numberOfOutputs: NDECK, outputChannelCount: new Array(NDECK).fill(2),
    });
    for (let i = 0; i < NDECK; i++) e.node.connect(e.channels[i].input, i);
    e.node.port.onmessage = (m) => e.onState?.(m.data);
    for (let u = 0; u < 2; u++) e.fx.push(new FxUnit(ctx, beatSources[u]));
    e.maxChannels = ctx.destination.maxChannelCount;
    e.applyOutput();
    return e;
  }

  post(m: any, transfer?: Transferable[]): void {
    this.node.port.postMessage(m, transfer ?? []);
  }

  // ------------------------------------------------------------- master/cue
  setMasterGain(v: number) { this.masterGain.gain.setTargetAtTime(trimGain(v), this.ctx.currentTime, 0.02); }
  setCueGain(v: number) { this.cueOut.gain.setTargetAtTime(v * 1.4, this.ctx.currentTime, 0.02); }
  /** 0 = solo cue, 1 = solo master */
  setCueMix(v: number) {
    const t = this.ctx.currentTime;
    this.cueSide.gain.setTargetAtTime(Math.cos(v * Math.PI / 2), t, 0.02);
    this.mstSide.gain.setTargetAtTime(Math.sin(v * Math.PI / 2), t, 0.02);
  }
  setLimiter(on: boolean) {
    try { this.masterGain.disconnect(); } catch { /* */ }
    try { this.limiter.disconnect(); } catch { /* */ }
    if (on) { this.masterGain.connect(this.limiter); this.limiter.connect(this.masterOut); }
    else this.masterGain.connect(this.masterOut);
  }

  setCrossfader(v: number) { this.xfader = v; this.applyXfader(); }

  applyXfader(): void {
    const v = this.xfader;
    let a: number, b: number;
    if (settings.xfaderCurve === "sharp") {
      a = v > 0.97 ? 0 : 1; b = v < 0.03 ? 0 : 1;
    } else if (settings.xfaderCurve === "thru") {
      a = b = 1;
    } else {
      a = Math.cos(v * Math.PI / 2); b = Math.sin(v * Math.PI / 2);
      a = Math.min(1, a * Math.SQRT2); b = Math.min(1, b * Math.SQRT2); // potencia constante con meseta central
    }
    this.channels.forEach((ch, i) => ch.setXf(this.xfAssign[i] === 0 ? a : this.xfAssign[i] === 1 ? b : 1));
  }

  masterLevel(): [number, number] {
    const pk = (an: AnalyserNode) => {
      an.getFloatTimeDomainData(this.mBuf as Float32Array<ArrayBuffer>);
      let p = 0;
      for (let i = 0; i < this.mBuf.length; i++) { const a = Math.abs(this.mBuf[i]); if (a > p) p = a; }
      return p;
    };
    return [pk(this.masterAnalyserL), pk(this.masterAnalyserR)];
  }

  // ------------------------------------------------------------- salidas
  applyOutput(): void {
    for (const n of this.routing) { try { n.disconnect(); } catch { /* */ } }
    try { this.masterOut.disconnect(this.ctx.destination); } catch { /* */ }
    try { this.cueOut.disconnect(); } catch { /* */ }
    this.routing = [];
    if (this.cueAudio) { this.cueAudio.pause(); this.cueAudio.srcObject = null; this.cueAudio = null; }
    const dest = this.ctx.destination;
    // Si el dispositivo no expone 4 canales, master estéreo (no split: por los
    // altavoces del portátil sonaría mono por un solo lado). El usuario puede
    // elegir split o dos dispositivos en Ajustes para tener pre-escucha.
    const mode: OutputMode = settings.outputMode === "multi" && this.maxChannels < 4 ? "master" : settings.outputMode;
    this.outputFallback = mode !== settings.outputMode;
    if (mode === "multi") {
      dest.channelCount = 4;
      dest.channelCountMode = "explicit";
      dest.channelInterpretation = "discrete";
      const merger = this.ctx.createChannelMerger(4);
      const ms = this.ctx.createChannelSplitter(2), cs = this.ctx.createChannelSplitter(2);
      this.masterOut.connect(ms); this.cueOut.connect(cs);
      ms.connect(merger, 0, 0); ms.connect(merger, 1, 1);
      cs.connect(merger, 0, 2); cs.connect(merger, 1, 3);
      merger.connect(dest);
      this.routing.push(ms, cs, merger);
    } else if (mode === "split") {
      dest.channelCount = 2;
      dest.channelCountMode = "explicit";
      dest.channelInterpretation = "discrete";
      const toMono = (src: AudioNode) => {
        const m = this.ctx.createGain();
        m.channelCount = 1; m.channelCountMode = "explicit"; m.channelInterpretation = "speakers";
        src.connect(m);
        return m;
      };
      const merger = this.ctx.createChannelMerger(2);
      const mm = toMono(this.masterOut), cm = toMono(this.cueOut);
      mm.connect(merger, 0, 0); cm.connect(merger, 0, 1);
      merger.connect(dest);
      this.routing.push(mm, cm, merger);
    } else {
      dest.channelCount = 2;
      dest.channelCountMode = "explicit";
      dest.channelInterpretation = "speakers";
      this.masterOut.connect(dest);
      if (mode === "dual") {
        const msd = this.ctx.createMediaStreamDestination();
        this.cueOut.connect(msd);
        const a = new Audio();
        a.srcObject = msd.stream;
        const sink = settings.cueDevice;
        const anyA = a as any;
        if (sink && anyA.setSinkId) anyA.setSinkId(sink).catch(() => {});
        a.play().catch(() => {});
        this.cueAudio = a;
        this.routing.push(msd);
      }
    }
    this.effectiveMode = mode;
  }
  effectiveMode: OutputMode = "master";
  outputFallback = false;

  async setMasterDevice(id: string): Promise<void> {
    const c = this.ctx as any;
    if (c.setSinkId) await c.setSinkId(id || "");
    this.maxChannels = this.ctx.destination.maxChannelCount;
    this.applyOutput();
  }

  // ------------------------------------------------------------- FX routing
  /** Inserta la unidad FX u en el canal `ch` (o la quita con ch = -1). */
  private fxAttached = [-1, -1];
  attachFx(u: number, ch: number): void {
    if (this.fxAttached[u] === ch) return;
    const unit = this.fx[u];
    const prev = this.fxAttached[u];
    if (prev >= 0) {
      const pc = this.channels[prev];
      try { pc.fxSend.disconnect(unit.input); } catch { /* */ }
      try { unit.output.disconnect(pc.fxReturn); } catch { /* */ }
      pc.fxSend.connect(pc.fxReturn);
    }
    this.fxAttached[u] = ch;
    if (ch >= 0) {
      const c = this.channels[ch];
      try { c.fxSend.disconnect(c.fxReturn); } catch { /* */ }
      c.fxSend.connect(unit.input);
      unit.output.connect(c.fxReturn);
    }
  }

  // ------------------------------------------------------------- grabación
  get recording(): boolean { return !!this.recorder && this.recorder.state === "recording"; }

  startRecording(): void {
    if (this.recording) return;
    const dest = this.ctx.createMediaStreamDestination();
    this.masterOut.connect(dest);
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
    const rec = new MediaRecorder(dest.stream, mime ? { mimeType: mime, audioBitsPerSecond: 256000 } : undefined);
    this.recChunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) this.recChunks.push(e.data); };
    rec.start(1000);
    this.recorder = rec;
    this.recStart = Date.now();
    (rec as any)._dest = dest;
  }

  stopRecording(): Promise<Blob | null> {
    const rec = this.recorder;
    if (!rec) return Promise.resolve(null);
    return new Promise((res) => {
      rec.onstop = () => {
        try { this.masterOut.disconnect((rec as any)._dest); } catch { /* */ }
        this.recorder = null;
        res(new Blob(this.recChunks, { type: rec.mimeType || "audio/webm" }));
        this.recChunks = [];
      };
      rec.stop();
    });
  }

  latencyMs(): number {
    const c = this.ctx as any;
    return Math.round(((c.baseLatency ?? 0) + (c.outputLatency ?? 0)) * 1000);
  }
}
