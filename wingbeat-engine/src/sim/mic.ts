// ============================================================================
//  Mic level source for the simulation.
//
//  Reads the laptop microphone and exposes a smoothed 0..1 level, so a
//  participant can literally breathe at the screen and drive a sensor's wind
//  value through SimTransport.holdWind(). This is the sim stand-in for the
//  ESP8266's electret-mic breath sensing.
// ============================================================================

export class MicSource {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private data: Uint8Array | null = null;
  private stream: MediaStream | null = null;
  private ema = 0;

  /** Input gain — scales the raw level into a useful 0..1 range. */
  gain = 1;
  /** Chosen input device (empty = system default). */
  deviceId = '';
  /** Envelope release in seconds — level rises instantly, falls over this time. */
  releaseTime = 0.4;
  private rel = 0; // post-release (enveloped) level
  private lastT = 0;

  async start(): Promise<void> {
    if (this.ctx) return;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: this.deviceId ? { deviceId: { exact: this.deviceId } } : true,
    });
    this.ctx.createMediaStreamSource(this.stream).connect(this.analyser);
    this.data = new Uint8Array(this.analyser.frequencyBinCount);
  }

  /** Switch the input device, restarting the stream if it's already running. */
  async setDevice(deviceId: string): Promise<void> {
    this.deviceId = deviceId;
    if (this.ctx) {
      this.stop();
      await this.start();
    }
  }

  /** Smoothed, enveloped level 0..1. Call once per animation frame. */
  level(): number {
    if (!this.analyser || !this.data) return 0;
    this.analyser.getByteFrequencyData(this.data);
    let sum = 0;
    for (let i = 0; i < this.data.length; i++) sum += this.data[i];
    const avg = (sum / this.data.length / 128) * this.gain; // ~0..1
    this.ema = 0.4 * avg + 0.6 * this.ema;
    const m = Math.min(1, this.ema);

    // Envelope: instant attack, exponential release over releaseTime seconds.
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    const dt = this.lastT ? Math.min(0.1, (now - this.lastT) / 1000) : 1 / 60;
    this.lastT = now;
    if (m >= this.rel) this.rel = m;
    else {
      const tau = Math.max(0.02, this.releaseTime);
      this.rel = m + (this.rel - m) * Math.exp(-dt / tau);
    }
    return this.rel;
  }

  /** Last enveloped level, for cheap display without re-sampling. */
  get lastLevel(): number {
    return this.rel;
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
    this.ctx = null;
    this.analyser = null;
    this.data = null;
    this.stream = null;
    this.ema = 0;
    this.rel = 0;
    this.lastT = 0;
  }

  get active(): boolean {
    return this.ctx !== null;
  }
}
