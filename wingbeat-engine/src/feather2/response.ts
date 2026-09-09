export interface ResponseSettings { gain: number; attack: number; release: number; wind: number }
export type ResponsePreset = 'organic' | 'percussive' | 'weightless';
export const RESPONSE_PRESETS: Record<ResponsePreset, ResponseSettings> = {
  organic: { gain: 1, attack: 35, release: 320, wind: 1 },
  percussive: { gain: 1.35, attack: 8, release: 130, wind: 1.3 },
  weightless: { gain: 0.8, attack: 180, release: 900, wind: 0.7 },
};

/** Exponential attack/release gives the same feel at 30, 60 and 120 fps. */
export function followEnvelope(current: number, target: number, dt: number, attack: number, release: number): number {
  const safeTarget = Number.isFinite(target) ? Math.max(0, target) : 0;
  const safeCurrent = Number.isFinite(current) ? Math.max(0, current) : 0;
  const ms = safeTarget > safeCurrent ? attack : release;
  const seconds = Number.isFinite(dt) ? Math.max(0, dt) : 0;
  return safeCurrent + (safeTarget - safeCurrent) * (1 - Math.exp(-seconds / Math.max(0.001, ms / 1000)));
}

/** A silent, explicitly simulated signal. It never drives the installation. */
export function demoSignal(time: number) {
  const beat = time / 1000 * 108 / 60;
  const phase = beat % 1;
  const kick = Math.exp(-phase * 15);
  const snare = Math.floor(beat) % 2 ? Math.exp(-phase * 20) : 0;
  const hat = Math.exp(-(beat * 2 % 1) * 22) * 0.65;
  const swell = 0.35 + 0.2 * Math.sin(time / 1600);
  const leadNote = [0, 4 / 12, 7 / 12, 9 / 12][Math.floor(beat / 4) % 4];
  return {
    playing: true, sourceLabel: 'Demo signal', level: 0.25 + kick * 0.4,
    bpm: 108, phase, bar: beat % 4 / 4, lock: 1, idle: 0,
    kick, snare, hat, sub: kick * 0.7, bass: swell, body: swell * 0.8,
    mid: swell, high: hat, air: hat * 0.7, bassline: swell,
    lead: swell * 0.7, vocal: 0, pad: swell, perc: Math.max(kick, snare),
    space: 0.2, noteOn: kick * 0.6, vibrato: 0.1, bright: 0.4,
    leadNote, hue: leadNote * Math.PI * 2,
  };
}
