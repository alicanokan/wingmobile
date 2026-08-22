// ============================================================================
//  Mic level source for the simulation.
//
//  Reads the laptop microphone and exposes a smoothed 0..1 level, so a
//  participant can literally breathe at the screen and drive a sensor's wind
//  value through SimTransport.holdWind(). This is the sim stand-in for the
//  ESP8266's electret-mic breath sensing.
// ============================================================================

import { finite, loadJson, saveJson, str } from './persisted.ts';

const CAL_KEY = 'wb.mic.v1';
interface MicCal { gain: number; deviceId: string; releaseTime: number }
const loadCal = (): MicCal =>
  loadJson(CAL_KEY, (raw) => {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return { gain: finite(r.gain, 1, 0.05, 20), deviceId: str(r.deviceId), releaseTime: finite(r.releaseTime, 0.4, 0.02, 5) };
  });

export class MicSource {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private data: Uint8Array | null = null;
  private stream: MediaStream | null = null;
  private ema = 0;

  // Calibration persists (wb.mic.v1): a venue's gain + device choice survives
  // a reload, which is the one moment nobody has time to redo it.
  private cal: MicCal = loadCal();
  /** Input gain — scales the raw level into a useful 0..1 range. */
  get gain(): number { return this.cal.gain; }
  set gain(v: number) { this.cal.gain = finite(v, 1, 0.05, 20); saveJson(CAL_KEY, this.cal); }
  /** Chosen input device (empty = system default). */
  get deviceId(): string { return this.cal.deviceId; }
  set deviceId(v: string) { this.cal.deviceId = str(v); saveJson(CAL_KEY, this.cal); }
  /** Envelope release in seconds — level rises instantly, falls over this time. */
  get releaseTime(): number { return this.cal.releaseTime; }
  set releaseTime(v: number) { this.cal.releaseTime = finite(v, 0.4, 0.02, 5); saveJson(CAL_KEY, this.cal); }

  private rel = 0; // post-release (enveloped) level
  private lastT = 0;

  async start(): Promise<void> {
    if (this.ctx) return;
    // Ask for the device FIRST. If permission is denied the throw happens
    // before any state is set, so `active` can't claim a mic we never got.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: this.deviceId ? { deviceId: { exact: this.deviceId } } : true,
    });
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    ctx.createMediaStreamSource(stream).connect(analyser);
    this.stream = stream;
    this.ctx = ctx;
    this.analyser = analyser;
    this.data = new Uint8Array(analyser.frequencyBinCount);
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
