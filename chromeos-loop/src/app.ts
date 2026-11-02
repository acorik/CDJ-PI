import { settings, setSetting, latencyHint } from "./settings";
import { Transport } from "./looper/transport";
import { Looper, NTRACKS } from "./looper/looper";
import { encodeWav, mixdown } from "./looper/wav";
import { Synth, type Preset } from "./synth/synth";
import { PRESETS } from "./synth/presets";
import { scaleNote, diatonicChord } from "./synth/theory";
import { DrumMachine } from "./drums/drums";
import { KITS } from "./drums/kits";
import { FxUnit } from "./audio/fx";
import { PerfBus } from "./audio/perf";
import { dbAll, dbDelete, dbPut } from "./db";

type Listener = () => void;

export interface Toast { text: string; kind: "info" | "error"; at: number }

export interface SavedSession {
  name: string;
  savedAt: number;
  bpm: number;
  preset: string;
  kit: number;
  root: number;
  scale: string;
  tracks: ({ L: Float32Array; R: Float32Array; offset: number; vol: number; rev: boolean; playing: boolean } | null)[];
}

export interface MidiHooks { requirePickup?(): void }

export class App {
  ctx!: AudioContext;
  transport!: Transport;
  looper!: Looper;
  synth!: Synth;
  drums!: DrumMachine;
  perf!: PerfBus;
  fx: FxUnit[] = [];
  /** bus de instrumentos en directo (lo que se graba) */
  instrIn!: GainNode;
  instrOut!: GainNode;
  loopBus!: GainNode;
  masterSum!: GainNode;
  masterGain!: GainNode;
  private limiter!: DynamicsCompressorNode;
  masterOut!: GainNode;
  private metro!: GainNode;
  private analyser!: AnalyserNode;
  private inAnalyser!: AnalyserNode;
  private micAnalyser!: AnalyserNode;
  private meterBuf = new Float32Array(512);
  micStream: MediaStream | null = null;
  private micSrc: MediaStreamAudioSourceNode | null = null;
  private micToLooper!: GainNode;
  private micMonitor!: GainNode;
  micInputLatency = 0.01;
  preset!: Preset;
  shift = false;
  toasts: Toast[] = [];
  midi: MidiHooks | null = null;
  ui: { browse?(d: number): void } | null = null;
  heldChords = new Map<number, number[]>();
  /** volúmenes (0..1; 0.75 = ganancia unidad) que la UI muestra y los controles físicos cambian */
  mix = { synth: 0.75, drums: 0.8, instr: 0.75, loops: 0.75, master: 0.75 };
  private mixWarned = new Set<string>();
  private listeners: Listener[] = [];
  private emitQueued = false;
  private recorder: MediaRecorder | null = null;
  private recChunks: Blob[] = [];
  recStart = 0;

  async init(): Promise<void> {
    const opts: any = { latencyHint: latencyHint() };
    if (settings.masterDevice) opts.sinkId = settings.masterDevice;
    let ctx: AudioContext;
    try { ctx = new AudioContext(opts); } catch { delete opts.sinkId; ctx = new AudioContext(opts); }
    this.ctx = ctx;
    // worklet: blob: (https) o data: (file://, donde blob: falla para worklets)
    try { await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([__WORKLET_SRC__], { type: "text/javascript" }))); }
    catch { await ctx.audioWorklet.addModule(`data:text/javascript;charset=utf-8,${encodeURIComponent(__WORKLET_SRC__)}`); }

    const g = (v = 1) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    this.transport = new Transport(ctx.sampleRate);
    this.transport.setBpm(settings.bpm);

    // ---- buses
    this.instrIn = g(); this.instrOut = g(); this.loopBus = g(); this.masterSum = g(); this.masterGain = g(); this.masterOut = g();
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1; this.limiter.knee.value = 0; this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002; this.limiter.release.value = 0.15;
    this.masterGain.connect(this.limiter); this.limiter.connect(this.masterOut);
    this.masterOut.connect(ctx.destination);
    this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 512; this.masterOut.connect(this.analyser);
    this.inAnalyser = ctx.createAnalyser(); this.inAnalyser.fftSize = 512; this.instrOut.connect(this.inAnalyser);
    this.metro = g(settings.metroVol); this.metro.connect(ctx.destination); // el clic NO se graba

    // ---- FX: unidad 1 en la entrada (se graba en el loop), unidad 2 en las pistas
    const beatSrc = () => ({ beatSec: this.transport.beatSec(), nextBeat: this.transport.running ? this.transport.timeOfBeat(Math.ceil(this.transport.beatAt(ctx.currentTime))) : ctx.currentTime });
    this.fx = [new FxUnit(ctx, beatSrc), new FxUnit(ctx, beatSrc)];
    this.fx[0].select(settings.fxSlots[0]);
    this.fx[1].select(settings.fxSlots[1]);
    this.instrIn.connect(this.fx[0].input); this.fx[0].output.connect(this.instrOut);
    this.instrOut.connect(this.masterSum); // monitor
    const loopIn = g();
    loopIn.connect(this.fx[1].input); this.fx[1].output.connect(this.loopBus);
    this.loopBus.connect(this.masterSum);

    // ---- FX de directo sobre el master
    this.perf = new PerfBus(ctx, this.transport, { tapeStop: (on) => this.looper.tapeStop(on) });
    this.masterSum.connect(this.perf.input); this.perf.output.connect(this.masterGain);

    // ---- looper
    const node = new AudioWorkletNode(ctx, "looper", { numberOfInputs: 2, numberOfOutputs: NTRACKS, outputChannelCount: new Array(NTRACKS).fill(2), channelCount: 2, channelCountMode: "explicit" });
    this.instrOut.connect(node, 0, 0);
    this.micToLooper = g(0); this.micMonitor = g(0);
    this.micToLooper.connect(node, 0, 1);
    this.micMonitor.connect(this.masterSum);
    this.micAnalyser = ctx.createAnalyser(); this.micAnalyser.fftSize = 512;
    for (let i = 0; i < NTRACKS; i++) node.connect(loopIn, i);
    this.looper = new Looper(node, this.transport, ctx, {
      loopBars: () => settings.loopBars,
      afterRec: () => settings.afterRec,
      countIn: () => settings.countIn,
      lateSec: 0.15,
    });
    this.looper.onStartTransport = (countIn) => this.startTransport(countIn);
    this.looper.onChange(() => this.emit());
    this.updateComp();

    // ---- instrumentos
    this.synth = new Synth(ctx, this.transport);
    this.synth.out.connect(this.instrIn); this.synth.fxOut.connect(this.instrIn);
    this.preset = PRESETS.find((p) => p.name === settings.presetName) ?? PRESETS[0];
    this.synth.setPreset(this.preset);
    this.drums = new DrumMachine(ctx);
    this.drums.bus.connect(this.instrIn);
    void this.drums.init().then(async () => { await this.drums.selectKit(Math.min(settings.kit, KITS.length - 1)); this.emit(); });

    this.transport.onChange(() => { this.synth.updateTempo(); this.emit(); });
    this.setLimiter(settings.limiter);
    setInterval(() => this.metroTick(), 25);
    (ctx as any).addEventListener?.("statechange", () => this.emit());
  }

  onChange(l: Listener): void { this.listeners.push(l); }
  emit(): void {
    if (this.emitQueued) return;
    this.emitQueued = true;
    requestAnimationFrame(() => { this.emitQueued = false; for (const l of this.listeners) l(); });
  }

  toast(text: string, kind: "info" | "error" = "info"): void {
    this.toasts.push({ text, kind, at: Date.now() });
    if (this.toasts.length > 4) this.toasts.shift();
    this.emit();
  }

  // ------------------------------------------------------------- transporte
  startTransport(countIn: boolean): void {
    if (this.transport.running) return;
    const now = this.ctx.currentTime;
    const lead = 0.08 + (countIn ? this.transport.barSec : 0);
    this.transport.start(now + lead);
    this.countInUntil = countIn ? this.transport.t0 : 0;
    this.metroNext = Math.floor(this.transport.beatAt(now)) ;
  }

  stopTransport(): void {
    this.transport.stop();
    this.synth.allOff();
  }

  togglePlay(): void {
    if (this.transport.running) this.stopTransport();
    else if (this.looper.hasContent) this.looper.playAll();
    else this.startTransport(false);
  }

  setBpm(bpm: number): void {
    if (this.looper.hasContent) { this.toast("El tempo queda fijo mientras haya loops grabados (CLEAR ALL para cambiarlo)", "error"); return; }
    this.transport.setBpm(Math.round(bpm * 10) / 10, this.ctx.currentTime);
    setSetting("bpm", this.transport.bpm);
  }

  private taps: number[] = [];
  tap(): void {
    const now = performance.now();
    if (this.taps.length && now - this.taps[this.taps.length - 1] > 2000) this.taps = [];
    this.taps.push(now);
    if (this.taps.length > 6) this.taps.shift();
    if (this.taps.length >= 3) {
      const avg = (this.taps[this.taps.length - 1] - this.taps[0]) / (this.taps.length - 1);
      this.setBpm(60000 / avg);
    }
  }

  // ------------------------------------------------------------- metrónomo / cuenta atrás
  private metroNext = 0;
  private countInUntil = 0;
  private metroTick(): void {
    const tr = this.transport;
    if (!tr.running) return;
    const now = this.ctx.currentTime;
    let b = Math.max(this.metroNext, Math.ceil(tr.beatAt(now) - 1e-6));
    for (; ; b++) {
      const t = tr.timeOfBeat(b);
      if (t > now + 0.12) break;
      this.metroNext = b + 1;
      const counting = t < this.countInUntil - 1e-4;
      if (!settings.metronome && !counting) continue;
      this.click(t, ((b % 4) + 4) % 4 === 0, counting);
    }
  }

  private click(t: number, accent: boolean, counting: boolean): void {
    const o = this.ctx.createOscillator();
    o.frequency.value = accent ? 1760 : 1100;
    const gg = this.ctx.createGain();
    const lv = counting ? 0.9 : 0.6;
    gg.gain.setValueAtTime(lv, t);
    gg.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    o.connect(gg); gg.connect(this.metro);
    o.start(t); o.stop(t + 0.06);
  }

  get countingIn(): boolean { return this.transport.running && this.ctx.currentTime < this.countInUntil; }

  setMetroVol(v: number): void { setSetting("metroVol", v); this.metro.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02); }

  // ------------------------------------------------------------- latencia
  updateComp(): void {
    const c = this.ctx as any;
    const out = (c.outputLatency ?? 0) + (c.baseLatency ?? 0) + settings.latencyAdjust / 1000;
    this.looper.setComp(Math.max(0, out), Math.max(0, out + this.micInputLatency));
  }

  latencyMs(): number {
    const c = this.ctx as any;
    return Math.round(((c.baseLatency ?? 0) + (c.outputLatency ?? 0)) * 1000);
  }

  // ------------------------------------------------------------- micro
  async enableMic(on: boolean): Promise<void> {
    if (!on) {
      this.micStream?.getTracks().forEach((t) => t.stop());
      this.micSrc?.disconnect();
      this.micStream = null; this.micSrc = null;
      this.emit();
      return;
    }
    const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    this.micStream = s;
    const lat = (s.getAudioTracks()[0]?.getSettings() as any)?.latency;
    this.micInputLatency = typeof lat === "number" && lat > 0 ? lat : 0.012;
    this.micSrc = this.ctx.createMediaStreamSource(s);
    this.micSrc.connect(this.micToLooper);
    this.micSrc.connect(this.micMonitor);
    this.micSrc.connect(this.micAnalyser);
    this.applyMic();
    this.updateComp();
    this.emit();
  }

  applyMic(): void {
    const t = this.ctx.currentTime;
    this.micToLooper.gain.setTargetAtTime(settings.micRec ? 1 : 0, t, 0.01);
    this.micMonitor.gain.setTargetAtTime(settings.micMonitor ? 1 : 0, t, 0.01);
  }

  // ------------------------------------------------------------- instrumentos
  setPreset(p: Preset): void {
    this.preset = p;
    this.synth.setPreset(p);
    setSetting("presetName", p.name);
    this.emit();
  }

  stepPreset(dir: number): void {
    const i = PRESETS.indexOf(this.preset);
    this.setPreset(PRESETS[(i + dir + PRESETS.length) % PRESETS.length]);
  }

  stepCategory(dir: number): void {
    const cats = [...new Set(PRESETS.map((p) => p.cat))];
    const ci = cats.indexOf(this.preset.cat);
    const next = cats[(ci + dir + cats.length) % cats.length];
    this.setPreset(PRESETS.find((p) => p.cat === next)!);
  }

  async setKit(k: number): Promise<void> {
    await this.drums.selectKit(k);
    setSetting("kit", k);
    this.emit();
  }

  /** Nota del pad `i` (0..15) en la escala actual. */
  padNote(i: number): number {
    return scaleNote(settings.root, settings.scale, i, 12 * (settings.octave + 1) - 12);
  }

  chordNotes(degree: number): number[] {
    return diatonicChord(settings.root, settings.scale, degree % 7, settings.chordSize, 12 * settings.octave + (degree >= 7 ? 12 : 0));
  }

  chordOn(id: number, degree: number, vel = 100): void {
    this.chordOff(id);
    const notes = this.chordNotes(degree);
    for (const n of notes) this.synth.noteOn(n, vel);
    this.heldChords.set(id, notes);
    this.emit();
  }

  chordOff(id: number): void {
    const n = this.heldChords.get(id);
    if (!n) return;
    for (const m of n) this.synth.noteOff(m);
    this.heldChords.delete(id);
    this.emit();
  }

  // ------------------------------------------------------------- volúmenes
  setMix(key: keyof App["mix"], v: number, source = ""): void {
    v = Math.max(0, Math.min(1, v));
    this.mix[key] = v;
    const t = this.ctx.currentTime;
    const gain = v / 0.75;
    switch (key) {
      case "synth": this.synth.out.gain.setTargetAtTime(gain, t, 0.02); this.synth.fxOut.gain.setTargetAtTime(gain, t, 0.02); break;
      case "drums": this.drums.setVolume(v); break;
      case "instr": this.instrOut.gain.setTargetAtTime(gain, t, 0.02); break;
      case "loops": this.loopBus.gain.setTargetAtTime(gain, t, 0.02); break;
      case "master": this.masterGain.gain.setTargetAtTime(gain, t, 0.02); break;
    }
    // aviso si un control físico deja algo en silencio
    const names = { synth: "Volumen del SINTE", drums: "Volumen de la BATERÍA", instr: "Volumen de INSTRUMENTOS", loops: "Volumen de los LOOPS", master: "Volumen MASTER" };
    if (v < 0.03 && source && !this.mixWarned.has(key)) { this.mixWarned.add(key); this.toast(`${names[key]} a cero (${source})`, "error"); }
    if (v > 0.1) this.mixWarned.delete(key);
    this.emit();
  }

  toggleMpdMode(): void {
    setSetting("mpdMode", settings.mpdMode === "drums" ? "piano" : "drums");
    this.toast(settings.mpdMode === "piano" ? "MPD218 en modo PIANO: los 16 pads tocan el sinte (banco A medio, B agudo, C grave)" : "MPD218 en modo BATERÍA: A batería · B notas · C pistas y acordes");
    this.emit();
  }

  // ------------------------------------------------------------- master
  setLimiter(on: boolean): void {
    try { this.masterGain.disconnect(); } catch { /* */ }
    try { this.limiter.disconnect(); } catch { /* */ }
    if (on) { this.masterGain.connect(this.limiter); this.limiter.connect(this.masterOut); }
    else this.masterGain.connect(this.masterOut);
  }

  async setMasterDevice(id: string): Promise<void> {
    const c = this.ctx as any;
    if (c.setSinkId) await c.setSinkId(id || "");
    this.updateComp();
  }

  level(which: "master" | "input" | "mic"): number {
    const an = which === "master" ? this.analyser : which === "input" ? this.inAnalyser : this.micAnalyser;
    an.getFloatTimeDomainData(this.meterBuf as Float32Array<ArrayBuffer>);
    let p = 0;
    for (let i = 0; i < this.meterBuf.length; i++) { const a = Math.abs(this.meterBuf[i]); if (a > p) p = a; }
    return p;
  }

  // ------------------------------------------------------------- grabación de la sesión (lo que suena)
  get recording(): boolean { return !!this.recorder && this.recorder.state === "recording"; }

  toggleSessionRecording(): void {
    if (this.recording) {
      const rec = this.recorder!;
      rec.onstop = () => {
        const blob = new Blob(this.recChunks, { type: rec.mimeType || "audio/webm" });
        this.download(blob, `directo-${stamp()}.webm`);
        this.recorder = null; this.recChunks = [];
        this.toast("Grabación del directo guardada en Descargas");
        this.emit();
      };
      rec.stop();
      return;
    }
    const dest = this.ctx.createMediaStreamDestination();
    this.masterOut.connect(dest);
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
    const rec = new MediaRecorder(dest.stream, mime ? { mimeType: mime, audioBitsPerSecond: 256000 } : undefined);
    this.recChunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) this.recChunks.push(e.data); };
    rec.start(1000);
    this.recorder = rec;
    this.recStart = Date.now();
    this.toast("Grabando el directo…");
    this.emit();
  }

  download(blob: Blob, name: string): void {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }

  async exportLoops(): Promise<void> {
    const tracks = await this.looper.dump();
    const sr = this.ctx.sampleRate;
    let n = 0;
    tracks.forEach((t, i) => { if (t) { this.download(encodeWav(t.L, t.R, sr), `loop-${i + 1}-${Math.round(this.transport.bpm)}bpm-${stamp()}.wav`); n++; } });
    const mix = mixdown(tracks);
    if (mix) this.download(encodeWav(mix.L, mix.R, sr), `mezcla-loop-${Math.round(this.transport.bpm)}bpm-${stamp()}.wav`);
    this.toast(n ? `${n} loops + mezcla exportados (WAV)` : "No hay loops que exportar");
  }

  // ------------------------------------------------------------- sesiones
  async saveSession(name: string): Promise<void> {
    const tracks = await this.looper.dump();
    const s: SavedSession = { name, savedAt: Date.now(), bpm: this.transport.bpm, preset: this.preset.name, kit: this.drums.kitIdx, root: settings.root, scale: settings.scale, tracks };
    await dbPut("sessions", name, s);
    this.toast(`Sesión "${name}" guardada`);
  }

  async listSessions(): Promise<SavedSession[]> {
    return (await dbAll<SavedSession>("sessions")).sort((a, b) => b.savedAt - a.savedAt);
  }

  async deleteSession(name: string): Promise<void> { await dbDelete("sessions", name); }

  async loadSession(s: SavedSession): Promise<void> {
    this.stopTransport();
    this.looper.clearAll();
    this.transport.setBpm(s.bpm);
    setSetting("bpm", this.transport.bpm);
    setSetting("root", s.root);
    setSetting("scale", s.scale);
    const p = PRESETS.find((x) => x.name === s.preset);
    if (p) this.setPreset(p);
    await this.setKit(s.kit);
    s.tracks.forEach((t, i) => {
      if (!t) return;
      this.looper.load(i, t.L.slice(), t.R.slice(), t.offset, t.playing);
      this.looper.setVol(i, t.vol);
      if (t.rev) this.looper.toggleRev(i);
    });
    this.toast(`Sesión "${s.name}" cargada: dale a PLAY`);
    this.emit();
  }
}

function stamp(): string {
  return new Date().toISOString().slice(0, 16).replace(/[:T]/g, "").replace(/-/g, "");
}
