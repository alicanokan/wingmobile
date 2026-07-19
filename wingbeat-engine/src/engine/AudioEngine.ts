// ============================================================================
//  Wing Beat — Audio engine (Tone.js)
//
//  A CONSUMER of the WingbeatEngine event bus. It turns engine events into a
//  layered soundscape:
//
//    'scene'  → swap the held drone chord
//    'wind'   → swell filtered noise (the wind itself)
//    'melody' → pluck a note, panned to where the participant acted
//    'perc'   → low membrane hit
//    'accent' → bell on presence onset
//
//  Every layer runs through its own MIXER BUS (gain + mute), and the "voice" of
//  each layer is swappable — the drone's oscillator, the wind's noise colour,
//  and a user-loaded SAMPLE for the melody/perc/accent triggers. So the constant
//  drone after "Start audio" can be muted, re-voiced, or replaced entirely.
// ============================================================================

import * as Tone from 'tone';
import type { WingbeatEngine } from './WingbeatEngine.ts';
import { getScene } from './scenes.ts';

export type LayerName = 'bed' | 'wind' | 'melody' | 'perc' | 'accent';
export type SampleLayer = 'melody' | 'perc' | 'accent';
export type BedOsc = 'sine' | 'triangle' | 'sawtooth' | 'square' | 'fatsawtooth' | 'amsine';
export type NoiseColor = 'white' | 'pink' | 'brown';

export interface LayerState {
  gain: number; // 0..1
  mute: boolean;
  sample?: string | null; // file name of a loaded sample (trigger layers only)
}

export const LAYER_LABELS: Record<LayerName, string> = {
  bed: 'Drone',
  wind: 'Wind',
  melody: 'Melody',
  perc: 'Percussion',
  accent: 'Accent',
};

const DEFAULT_GAINS: Record<LayerName, number> = {
  bed: 0.6,
  wind: 0.85,
  melody: 0.95,
  perc: 0.95,
  accent: 0.8,
};

const C4 = 261.63;

export class AudioEngine {
  ready = false;

  private master!: Tone.Gain;
  private reverb!: Tone.Reverb;
  private meter?: Tone.Meter;
  private buses!: Record<LayerName, Tone.Gain>;

  private bed!: Tone.PolySynth;
  private bedLfo!: Tone.LFO;
  private noise!: Tone.Noise;
  private noiseFilter!: Tone.Filter;
  private noiseGain!: Tone.Gain;
  private pluck!: Tone.PluckSynth;
  private pluckPan!: Tone.Panner;
  private perc!: Tone.MembraneSynth;
  private percPan!: Tone.Panner;
  private bell!: Tone.MetalSynth;
  private bellPan!: Tone.Panner;

  private players: Record<SampleLayer, Tone.Player | null> = { melody: null, perc: null, accent: null };

  // per-feather-layer sounds (samples / generated patterns), keyed by layer index
  private layerSynth?: Tone.PolySynth;
  private layerPan?: Tone.Panner;
  private layerPlayers = new Map<number, Tone.Player>();

  // per-sensor LOOP samples — a multichannel sample player. Each sensor's loop
  // runs continuously (phase-aligned to a shared transport so they stay in sync);
  // its GAIN rises when the sensor is triggered, and its METER feeds that layer's
  // audio-reactivity, so each visual layer moves to its own loop's sound.
  private loops = new Map<string, { player: Tone.Player; gain: Tone.Gain; fader: Tone.Gain; meter: Tone.Meter; fft: Tone.FFT; target: number; name: string }>();
  // Per-sensor CHANNEL STRIP for the loop players: the operator's fader + mute,
  // multiplying the trigger gain. Kept outside `loops` so a conductor push that
  // reloads a sample doesn't reset the level someone just set on the desk.
  private loopMix = new Map<string, { gain: number; mute: boolean }>();
  private transportOn = false;
  bpm = 120;

  private engine: WingbeatEngine | null = null;
  private detachers: Array<() => void> = [];

  // mixer + voice state (readable before init so the UI can render)
  mixer: Record<LayerName, LayerState> = {
    bed: { gain: DEFAULT_GAINS.bed, mute: false },
    wind: { gain: DEFAULT_GAINS.wind, mute: false },
    melody: { gain: DEFAULT_GAINS.melody, mute: false, sample: null },
    perc: { gain: DEFAULT_GAINS.perc, mute: false, sample: null },
    accent: { gain: DEFAULT_GAINS.accent, mute: false, sample: null },
  };
  bedOsc: BedOsc = 'sine';
  noiseColor: NoiseColor = 'pink';
  reverbWet = 0.35;
  private masterGainValue = 0.7;

  /** Must be called from a user gesture (browser autoplay policy). */
  async init(masterGain = 0.7): Promise<void> {
    if (this.ready) return;
    this.masterGainValue = masterGain;
    await Tone.start();

    this.reverb = new Tone.Reverb({ decay: 6, wet: this.reverbWet }).toDestination();
    await this.reverb.generate();
    this.master = new Tone.Gain(masterGain).connect(this.reverb);
    // tap the master for a live level (drives the projection's audio-reactivity)
    this.meter = new Tone.Meter({ normalRange: true, smoothing: 0.8 });
    this.master.connect(this.meter);

    // one mixer bus per layer
    this.buses = {
      bed: new Tone.Gain(this.busLevel('bed')).connect(this.master),
      wind: new Tone.Gain(this.busLevel('wind')).connect(this.master),
      melody: new Tone.Gain(this.busLevel('melody')).connect(this.master),
      perc: new Tone.Gain(this.busLevel('perc')).connect(this.master),
      accent: new Tone.Gain(this.busLevel('accent')).connect(this.master),
    };

    // Bed: slow pad drone
    this.bed = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: this.bedOsc },
      envelope: { attack: 4, decay: 1, sustain: 0.9, release: 6 },
      volume: -14,
    }).connect(this.buses.bed);
    this.bedLfo = new Tone.LFO('0.05hz', -18, -10).connect(this.bed.volume as unknown as Tone.InputNode);
    this.bedLfo.start();

    // Wind: filtered noise
    this.noise = new Tone.Noise(this.noiseColor).start();
    this.noiseFilter = new Tone.Filter(400, 'bandpass', -24);
    this.noiseGain = new Tone.Gain(0).connect(this.buses.wind);
    this.noise.chain(this.noiseFilter, this.noiseGain);

    // Melody
    this.pluckPan = new Tone.Panner(0).connect(this.buses.melody);
    this.pluck = new Tone.PluckSynth({ attackNoise: 0.7, dampening: 3500, resonance: 0.85, volume: -8 }).connect(this.pluckPan);

    // Perc
    this.percPan = new Tone.Panner(0).connect(this.buses.perc);
    this.perc = new Tone.MembraneSynth({ pitchDecay: 0.06, octaves: 6, envelope: { attack: 0.001, decay: 0.5, sustain: 0 }, volume: -10 }).connect(this.percPan);

    // Accent
    this.bellPan = new Tone.Panner(0).connect(this.buses.accent);
    this.bell = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 1.4, release: 0.6 }, harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5, volume: -22 }).connect(this.bellPan);

    // per-feather-layer voice: a synth for generated patterns + a pan for samples
    this.layerPan = new Tone.Panner(0).connect(this.master);
    this.layerSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.005, decay: 0.18, sustain: 0.05, release: 0.4 },
      volume: -10,
    }).connect(this.layerPan);

    // route any samples loaded BEFORE start onto their proper bus/pan
    (['melody', 'perc', 'accent'] as SampleLayer[]).forEach((l) => {
      const p = this.players[l];
      if (p) {
        p.disconnect();
        p.connect(l === 'melody' ? this.pluckPan : l === 'perc' ? this.percPan : this.bellPan);
      }
    });
    this.layerPlayers.forEach((p) => {
      p.disconnect();
      if (this.layerPan) p.connect(this.layerPan);
    });

    this.ready = true;
    if (this.engine) {
      this.startBed(this.engine.scene);
      this.engine.emitAudioReady();
    }
  }

  private busLevel(name: LayerName): number {
    const s = this.mixer[name];
    return s.mute ? 0 : s.gain;
  }

  setMasterGain(g: number) {
    this.masterGainValue = g;
    if (this.master) this.master.gain.rampTo(g, 0.3);
  }

  /** Resume the audio context (call from a user gesture if sound stopped). */
  async resume(): Promise<void> {
    await Tone.start();
    const ctx = Tone.getContext().rawContext as AudioContext;
    if (ctx.state === 'suspended') await ctx.resume();
  }

  /** Play a loaded sample once, now — used by the mixer's preview button. */
  async previewSample(layer: SampleLayer): Promise<void> {
    if (!this.ready) await this.init(this.masterGainValue);
    await this.resume();
    const p = this.players[layer];
    if (p && p.loaded) {
      p.playbackRate = 1;
      try {
        p.start();
      } catch {
        /* retrigger overlap */
      }
    }
  }

  /** Live master level 0..1 — the projection reads this for audio-reactive motion. */
  getLevel(): number {
    if (!this.meter) return 0;
    const v = this.meter.getValue();
    return typeof v === 'number' ? Math.min(1, Math.max(0, v)) : 0;
  }

  // ---- Mixer -------------------------------------------------------------
  setLayerGain(name: LayerName, g: number) {
    this.mixer[name].gain = g;
    if (this.ready) this.buses[name].gain.rampTo(this.busLevel(name), 0.1);
  }
  setLayerMute(name: LayerName, mute: boolean) {
    this.mixer[name].mute = mute;
    if (this.ready) this.buses[name].gain.rampTo(this.busLevel(name), 0.1);
  }

  // ---- Voices ------------------------------------------------------------
  setBedOsc(type: BedOsc) {
    this.bedOsc = type;
    if (this.ready) this.bed.set({ oscillator: { type } as never });
  }
  setNoiseColor(type: NoiseColor) {
    this.noiseColor = type;
    if (this.ready) this.noise.type = type;
  }
  setReverbWet(w: number) {
    this.reverbWet = w;
    if (this.ready) this.reverb.wet.rampTo(w, 0.2);
  }

  // ---- Samples (replace a trigger layer's sound) -------------------------
  // Works whether or not "Start audio" has run: decoding + node creation don't
  // need a running context. If the engine isn't initialized yet we connect to
  // the master destination; once started, the sample plays on triggers.
  async loadSample(layer: SampleLayer, file: File): Promise<void> {
    const buf = await file.arrayBuffer();
    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await Tone.getContext().rawContext.decodeAudioData(buf.slice(0));
    } catch {
      throw new Error(`Couldn't decode "${file.name}". Try a .wav / .mp3 / .ogg file.`);
    }
    this.players[layer]?.dispose();
    const pan = layer === 'melody' ? this.pluckPan : layer === 'perc' ? this.percPan : this.bellPan;
    const dest = (pan ?? this.master ?? Tone.getDestination()) as Tone.ToneAudioNode;
    const player = new Tone.Player(audioBuffer).connect(dest);
    this.players[layer] = player;
    this.mixer[layer].sample = file.name;
  }
  clearSample(layer: SampleLayer) {
    this.players[layer]?.dispose();
    this.players[layer] = null;
    this.mixer[layer].sample = null;
  }

  // ---- Per-feather-layer sounds (sample or generated pattern) -------------
  async loadLayerSample(idx: number, file: File): Promise<void> {
    const buf = await file.arrayBuffer();
    let ab: AudioBuffer;
    try {
      ab = await Tone.getContext().rawContext.decodeAudioData(buf.slice(0));
    } catch {
      throw new Error(`Couldn't decode "${file.name}". Try a .wav / .mp3 / .ogg file.`);
    }
    this.layerPlayers.get(idx)?.dispose();
    const dest = (this.layerPan ?? this.master ?? Tone.getDestination()) as Tone.ToneAudioNode;
    this.layerPlayers.set(idx, new Tone.Player(ab).connect(dest));
  }
  clearLayerSample(idx: number) {
    this.layerPlayers.get(idx)?.dispose();
    this.layerPlayers.delete(idx);
  }

  /** Play a layer's sound (sample or generated pattern) — called on each trigger. */
  playLayer(idx: number, mode: 'synth' | 'sample' | 'pattern', seed: number, note: string, vel: number, pan: number) {
    if (!this.ready) return;
    if (mode === 'sample') {
      const p = this.layerPlayers.get(idx);
      if (p && p.loaded) {
        if (this.layerPan) this.layerPan.pan.rampTo(pan, 0.05);
        p.playbackRate = Tone.Frequency(note).toFrequency() / C4;
        try {
          p.start();
        } catch {
          /* retrigger */
        }
      }
    } else if (mode === 'pattern') {
      this.playPattern(seed, vel, pan);
    }
  }

  private playPattern(seed: number, vel: number, pan: number) {
    if (!this.layerSynth) return;
    if (this.layerPan) this.layerPan.pan.rampTo(pan, 0.05);
    const scale = getScene(this.engine?.scene ?? '').melodyScale;
    const n = 3 + (Math.floor(seed * 997) % 3); // 3..5 notes
    const now = Tone.now();
    for (let k = 0; k < n; k++) {
      const si = (Math.floor(seed * 71 + k * 13) % scale.length + scale.length) % scale.length;
      const t = now + k * (0.07 + (Math.floor(seed * 100) % 5) * 0.02);
      this.layerSynth.triggerAttackRelease(scale[si], '16n', t, 0.3 + vel * 0.3);
    }
  }

  async previewLayer(idx: number, mode: 'synth' | 'sample' | 'pattern', seed: number): Promise<void> {
    if (!this.ready) await this.init(this.masterGainValue);
    await this.resume();
    this.playLayer(idx, mode, seed, 'C4', 0.85, 0);
  }

  // ---- Per-sensor LOOPS (synced to a shared transport) --------------------
  private ensureTransport() {
    if (this.transportOn) return;
    const t = Tone.getTransport();
    t.bpm.value = this.bpm;
    t.start();
    this.transportOn = true;
  }
  setBpm(bpm: number) {
    this.bpm = bpm;
    if (this.transportOn) Tone.getTransport().bpm.rampTo(bpm, 0.1);
  }

  async loadLoopSample(sensorId: string, file: File): Promise<void> {
    return this.loadLoopBuffer(sensorId, await file.arrayBuffer(), file.name);
  }

  /** Same as loadLoopSample but from raw bytes — used by the conductor cloud
   *  sync, which downloads samples from the shared library. */
  async loadLoopBuffer(sensorId: string, buf: ArrayBuffer, label = 'sample'): Promise<void> {
    if (!this.ready) await this.init(this.masterGainValue);
    await this.resume();
    this.ensureTransport();
    let ab: AudioBuffer;
    try {
      ab = await Tone.getContext().rawContext.decodeAudioData(buf.slice(0));
    } catch {
      throw new Error(`Couldn't decode "${label}". Try a .wav / .mp3 / .ogg file.`);
    }
    this.clearLoop(sensorId);
    const master = (this.master ?? Tone.getDestination()) as Tone.ToneAudioNode;
    const strip = this.loopMix.get(sensorId) ?? { gain: 0.8, mute: false };
    this.loopMix.set(sensorId, strip);
    const fader = new Tone.Gain(strip.mute ? 0 : strip.gain).connect(master); // operator fader
    const gain = new Tone.Gain(0).connect(fader);     // trigger gate, silent until triggered
    const meter = new Tone.Meter({ normalRange: true, smoothing: 0.8 });
    const fft = new Tone.FFT({ size: 256, smoothing: 0.8 }); // EQ bands for routing + the visual EQ editor
    const player = new Tone.Player(ab);
    player.loop = true;
    player.connect(gain);                             // → fader → master
    player.connect(meter);                            // RAW loop level → always analysed,
    player.connect(fft);                              // RAW spectrum → low/mid/high bands,
    //   so the layer reacts to the loop's sound even before its volume is up.
    this.loops.set(sensorId, { player, gain, fader, meter, fft, target: 0, name: label });
    // SYNC — every loop plays as if it had been running since transport time 0.
    //
    // Files finish decoding at different moments, and a conductor push reloads
    // one channel mid-performance, so a bare start() left each loop at whatever
    // phase it happened to begin: same-length stems layered out of alignment.
    // Instead, enter the buffer at the offset a loop started at transport 0
    // would be at right now. Same-length loops therefore always share a
    // downbeat, and loops of different lengths still meet at 0 (a 2-bar and a
    // 4-bar stem line up every 4 bars) rather than at an arbitrary phase.
    //
    // Alignment holds after that: looping buffer sources all run off the one
    // audio hardware clock, so they don't drift relative to each other.
    const period = ab.duration;
    const offset = period > 0 ? Tone.getTransport().seconds % period : 0;
    try {
      player.start(undefined, offset);
    } catch {
      /* race */
    }
  }
  clearLoop(sensorId: string) {
    const l = this.loops.get(sensorId);
    if (l) {
      try { l.player.stop(); } catch { /* not started */ }
      l.player.dispose();
      l.gain.dispose();
      l.fader.dispose();
      l.meter.dispose();
      l.fft.dispose();
    }
    this.loops.delete(sensorId);
  }
  hasLoop(sensorId: string): boolean {
    return this.loops.has(sensorId);
  }

  /** Raise/lower a sensor's loop volume (0..1.4). Driven by sensor activation. */
  setLoopGain(sensorId: string, v: number) {
    const l = this.loops.get(sensorId);
    if (!l) return;
    const g = Math.max(0, Math.min(1.4, v));
    l.target = g;
    l.gain.gain.rampTo(g, 0.12);
  }
  // ---- loop channel strip (the operator's mixer, independent of triggering) --
  //
  // setLoopGain above is the TRIGGER gate — the engine drives it from the
  // sensor's air. These set the fader that gate feeds, so pulling a channel
  // down keeps it down no matter how hard its sensor is played.

  /** Which sensors currently have a loop file loaded, in channel order. */
  loopChannels(): Array<{ sensorId: string; name: string }> {
    return [...this.loops.entries()].map(([sensorId, l]) => ({ sensorId, name: l.name }));
  }
  /** File name of a sensor's loop ('' when none is loaded). */
  loopName(sensorId: string): string {
    return this.loops.get(sensorId)?.name ?? '';
  }
  /** Operator fader 0..1 for a sensor's loop (default 0.8). Survives a reload
   *  of the sample, so a conductor push doesn't undo a level change. */
  loopFader(sensorId: string): number {
    return this.loopMix.get(sensorId)?.gain ?? 0.8;
  }
  loopMuted(sensorId: string): boolean {
    return this.loopMix.get(sensorId)?.mute ?? false;
  }
  setLoopFader(sensorId: string, v: number) {
    const g = Math.max(0, Math.min(1, v));
    const strip = this.loopMix.get(sensorId) ?? { gain: 0.8, mute: false };
    strip.gain = g;
    this.loopMix.set(sensorId, strip);
    const l = this.loops.get(sensorId);
    if (l) l.fader.gain.rampTo(strip.mute ? 0 : g, 0.06);
  }
  setLoopMute(sensorId: string, mute: boolean) {
    const strip = this.loopMix.get(sensorId) ?? { gain: 0.8, mute: false };
    strip.mute = mute;
    this.loopMix.set(sensorId, strip);
    const l = this.loops.get(sensorId);
    if (l) l.fader.gain.rampTo(mute ? 0 : strip.gain, 0.06);
  }

  /** Live level of a sensor's loop 0..1 — drives that layer's audio-reactivity. */
  getLoopLevel(sensorId: string): number {
    const l = this.loops.get(sensorId);
    if (!l) return 0;
    const raw = l.meter.getValue();
    const v = typeof raw === 'number' ? raw : Array.isArray(raw) ? Math.max(...raw) : 0;
    if (!Number.isFinite(v) || v <= 0) return 0;
    return Math.min(1, v * 2.4); // amplify the RMS so the reactivity is clearly visible
  }
  /** Is a sensor's loop currently audible/playing? */
  loopActive(sensorId: string): boolean {
    const l = this.loops.get(sensorId);
    return !!l && l.player.state === 'started';
  }
  /** Nyquist of the audio context — the top of the frequency axis for any EQ UI. */
  get nyquist(): number {
    return Tone.getContext().sampleRate / 2;
  }
  /** Raw magnitude spectrum (dB, ~ -100 quiet … 0 loud) of a sensor's loop —
   *  for drawing a live EQ / spectrum view. Bin `k` is centred at
   *  `(k / arr.length) * nyquist` Hz. Null while no loop is loaded. */
  getLoopSpectrum(sensorId: string): Float32Array | null {
    const l = this.loops.get(sensorId);
    if (!l) return null;
    return l.fft.getValue() as Float32Array;
  }
  /** Level 0..1 of an arbitrary Hz range of a sensor's loop — the same math
   *  that drives the low/mid/high presets, generalized so a hand-picked EQ
   *  range drives its layer exactly like the visual editor previews it. */
  getLoopBandRange(sensorId: string, minHz: number, maxHz: number): number {
    const l = this.loops.get(sensorId);
    if (!l) return 0;
    const arr = l.fft.getValue() as Float32Array;
    const n = arr.length;
    if (!n) return 0;
    const nyq = this.nyquist;
    const lo = Math.max(0, Math.min(n - 1, Math.floor((minHz / nyq) * n)));
    const hi = Math.max(lo + 1, Math.min(n, Math.ceil((maxHz / nyq) * n)));
    let sum = 0;
    let c = 0;
    for (let k = lo; k < hi; k++) {
      const v = arr[k];
      if (Number.isFinite(v)) { sum += v; c++; }
    }
    if (!c) return 0;
    const db = sum / c; // average magnitude in dB (~ -100 quiet … 0 loud)
    return Math.min(1, Math.max(0, (db + 70) / 55)); // map dB → 0..1 (loud-ish = 1)
  }
  /** Level 0..1 of one preset EQ band of a sensor's loop — route this to its layer. */
  getLoopBand(sensorId: string, band: 'full' | 'low' | 'mid' | 'high'): number {
    if (band === 'full') return this.getLoopLevel(sensorId);
    const nyq = this.nyquist;
    const lo = band === 'low' ? 0 : band === 'mid' ? nyq / 3 : (2 * nyq) / 3;
    const hi = band === 'low' ? nyq / 3 : band === 'mid' ? (2 * nyq) / 3 : nyq;
    return this.getLoopBandRange(sensorId, lo, hi);
  }

  private playSample(layer: SampleLayer, rate: number, pan: number): boolean {
    const p = this.players[layer];
    if (!p || !p.loaded) return false;
    const panner = layer === 'melody' ? this.pluckPan : layer === 'perc' ? this.percPan : this.bellPan;
    panner.pan.rampTo(pan, 0.05);
    p.playbackRate = rate;
    try {
      p.start();
    } catch {
      /* retrigger overlap — fine */
    }
    return true;
  }

  // ---- Bus wiring to the engine -----------------------------------------
  attach(engine: WingbeatEngine): () => void {
    this.engine = engine;

    this.detachers.push(
      engine.on('scene', ({ key }) => {
        if (this.ready) this.startBed(key);
      }),
    );
    this.detachers.push(
      engine.on('wind', ({ maxWind }) => {
        if (!this.ready) return;
        this.noiseGain.gain.rampTo(maxWind * 0.18, 0.1);
        this.noiseFilter.frequency.rampTo(300 + maxWind * 1800, 0.2);
      }),
    );
    this.detachers.push(
      engine.on('melody', ({ note, velocity, pan }) => {
        if (!this.ready) return;
        const rate = Tone.Frequency(note).toFrequency() / C4;
        if (this.playSample('melody', rate, pan)) return;
        this.pluckPan.pan.rampTo(pan, 0.05);
        this.pluck.triggerAttackRelease(note, '2n', undefined, velocity);
      }),
    );
    this.detachers.push(
      engine.on('perc', ({ note, velocity, pan }) => {
        if (!this.ready) return;
        if (this.playSample('perc', 1, pan)) return;
        this.percPan.pan.rampTo(pan, 0.05);
        this.perc.triggerAttackRelease(note, '8n', undefined, velocity);
      }),
    );
    this.detachers.push(
      engine.on('accent', ({ note, velocity, pan }) => {
        if (!this.ready) return;
        if (this.playSample('accent', 1, pan)) return;
        this.bellPan.pan.rampTo(pan, 0.05);
        this.bell.triggerAttackRelease(note, '2n', undefined, velocity);
      }),
    );
    return () => this.detach();
  }

  detach() {
    this.detachers.forEach((d) => d());
    this.detachers = [];
    this.engine = null;
  }

  private startBed(sceneKey: string) {
    const scene = getScene(sceneKey);
    this.bed.releaseAll();
    this.bed.triggerAttack(scene.bedNotes);
  }
}
