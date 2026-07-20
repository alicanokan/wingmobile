// ============================================================================
//  Audio features for /feather2 — a small analyser, not a synth engine.
//
//  Input is a music file (played out loud) or the mic (analysed silently).
//  Each frame we reduce the spectrum to the handful of features the anatomy
//  responds to:
//
//    beat    — a 0..1 pulse fired on low-band onsets (kick), fast decay.
//              Drives the ocellus ring pulse.
//    melody  — smoothed mid-band activity 0..1, plus an accumulated hue angle
//              that only advances while melody is present. Drives recoloring.
//    wave    — smoothed bass energy 0..1. Drives the downy-base wave.
//    shimmer — high-band energy 0..1. Drives barb sparkle.
//
//  Beat detection is spectral flux with an adaptive threshold: an onset is a
//  low-band jump clearly above that band's own recent average + deviation, at
//  most one per 0.22 s. Simple, but solid on percussive material.
// ============================================================================

export interface AudioFeatures {
  beat: number;
  melody: number;
  hue: number; // radians, accumulates with melody
  wave: number;
  shimmer: number;
  level: number;
  playing: boolean;
  sourceLabel: string;
}

const FFT = 2048;
const HIST = 43; // ~0.7 s of flux history at 60 fps

export class AudioFeed {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private bins: Uint8Array = new Uint8Array(0);
  private el: HTMLAudioElement | null = null;
  private elSrc: MediaElementAudioSourceNode | null = null;
  private micStream: MediaStream | null = null;
  private micSrc: MediaStreamAudioSourceNode | null = null;

  private fluxHist: number[] = [];
  private lastBass = 0;
  private lastBeatAt = 0;
  private beatPulse = 0;
  private melodySm = 0;
  private waveSm = 0;
  private shimmerSm = 0;
  private hue = 0;
  private lastT = 0;

  sourceLabel = '';

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = FFT;
      this.analyser.smoothingTimeConstant = 0.55;
      this.bins = new Uint8Array(this.analyser.frequencyBinCount);
    }
    return this.ctx;
  }

  /** Play a music file out loud and analyse it. */
  async useFile(file: File): Promise<void> {
    const ctx = this.ensureCtx();
    await ctx.resume();
    this.stopMic();
    if (!this.el) {
      this.el = new Audio();
      this.el.loop = true;
      this.elSrc = ctx.createMediaElementSource(this.el);
      this.elSrc.connect(this.analyser!);
      this.elSrc.connect(ctx.destination); // music is meant to be heard
    }
    this.el.src = URL.createObjectURL(file);
    await this.el.play();
    this.sourceLabel = file.name;
  }

  /** Analyse the microphone (not routed to the speakers — no feedback). */
  async useMic(): Promise<void> {
    const ctx = this.ensureCtx();
    await ctx.resume();
    this.pauseFile();
    this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.micSrc = ctx.createMediaStreamSource(this.micStream);
    this.micSrc.connect(this.analyser!);
    this.sourceLabel = 'microphone';
  }

  stopMic(): void {
    this.micSrc?.disconnect();
    this.micSrc = null;
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    if (this.sourceLabel === 'microphone') this.sourceLabel = '';
  }

  pauseFile(): void {
    this.el?.pause();
  }
  async resumeFile(): Promise<void> {
    await this.ctx?.resume();
    await this.el?.play();
  }
  get filePlaying(): boolean {
    return !!this.el && !this.el.paused;
  }
  get micOn(): boolean {
    return !!this.micStream;
  }
  get active(): boolean {
    return this.filePlaying || this.micOn;
  }

  dispose(): void {
    this.stopMic();
    this.el?.pause();
    this.el = null;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }

  /** Average byte energy of a Hz range, 0..1. */
  private band(lo: number, hi: number): number {
    if (!this.ctx || !this.analyser) return 0;
    const nyq = this.ctx.sampleRate / 2;
    const n = this.bins.length;
    const a = Math.max(0, Math.floor((lo / nyq) * n));
    const b = Math.min(n - 1, Math.ceil((hi / nyq) * n));
    let s = 0;
    for (let i = a; i <= b; i++) s += this.bins[i];
    return s / ((b - a + 1) * 255);
  }

  /** Call once per animation frame. */
  read(now: number): AudioFeatures {
    const dt = this.lastT ? Math.min(0.1, (now - this.lastT) / 1000) : 1 / 60;
    this.lastT = now;

    if (this.analyser && this.active) this.analyser.getByteFrequencyData(this.bins);
    else this.bins.fill(0);

    const bass = this.band(35, 160);
    const mid = this.band(350, 2200);
    const high = this.band(3800, 12000);

    // --- beat: positive low-band flux vs its own recent statistics ---------
    const flux = Math.max(0, bass - this.lastBass);
    this.lastBass = bass;
    this.fluxHist.push(flux);
    if (this.fluxHist.length > HIST) this.fluxHist.shift();
    const mean = this.fluxHist.reduce((a, b) => a + b, 0) / (this.fluxHist.length || 1);
    const sd = Math.sqrt(
      this.fluxHist.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (this.fluxHist.length || 1),
    );
    if (flux > mean + 2 * sd && flux > 0.02 && now - this.lastBeatAt > 220) {
      this.beatPulse = 1;
      this.lastBeatAt = now;
    }
    this.beatPulse *= Math.exp(-dt / 0.16); // sharp attack, fast ring-down

    // --- smoothed levels ---------------------------------------------------
    this.melodySm += (mid - this.melodySm) * Math.min(1, dt * 6);
    this.waveSm += (bass - this.waveSm) * Math.min(1, dt * 4);
    this.shimmerSm += (high - this.shimmerSm) * Math.min(1, dt * 8);

    // hue only advances while melody is actually present, so colors settle
    // when the music goes quiet instead of cycling forever
    this.hue += this.melodySm * dt * 1.6;

    return {
      beat: this.beatPulse,
      melody: Math.min(1, this.melodySm * 1.8),
      hue: this.hue,
      wave: Math.min(1, this.waveSm * 1.6),
      shimmer: Math.min(1, this.shimmerSm * 2.2),
      level: Math.min(1, (bass + mid + high) / 1.5),
      playing: this.active,
      sourceLabel: this.sourceLabel,
    };
  }
}
