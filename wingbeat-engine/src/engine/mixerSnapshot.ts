// ============================================================================
//  Mixer snapshot — the mixer/voices/loop-fader state as plain data, with a
//  validator. Kept free of Tone.js so presets.ts and the tests can import it
//  without an audio context.
// ============================================================================

import type { BedOsc, LayerName, LayerState, NoiseColor } from './AudioEngine.ts';
import { bool, finite, oneOf } from '../sim/persisted.ts';

export const DEFAULT_GAINS: Record<LayerName, number> = {
  bed: 0.6,
  wind: 0.85,
  melody: 0.95,
  perc: 0.95,
  accent: 0.8,
};

export const LAYER_NAMES: readonly LayerName[] = ['bed', 'wind', 'melody', 'perc', 'accent'];
const BED_OSCS: readonly BedOsc[] = ['sine', 'triangle', 'sawtooth', 'square', 'fatsawtooth', 'amsine'];
const NOISE_COLORS: readonly NoiseColor[] = ['white', 'pink', 'brown'];

/** Everything on the mixer + voices, as one recallable unit: persisted per
 *  console (wb.mixer.v1) and bundled into v2 presets. Loop faders ride along
 *  keyed by sensor id. */
export interface MixerSnapshot {
  v: 1;
  mixer: Record<LayerName, LayerState>;
  bedOsc: BedOsc;
  noiseColor: NoiseColor;
  reverbWet: number;
  loopMix: Record<string, { gain: number; mute: boolean }>;
}

export function validateMixerSnapshot(raw: unknown): MixerSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const mix = (r.mixer && typeof r.mixer === 'object' ? r.mixer : {}) as Record<string, Record<string, unknown>>;
  const mixer = {} as Record<LayerName, LayerState>;
  for (const l of LAYER_NAMES) {
    const m = mix[l] ?? {};
    mixer[l] = {
      gain: finite(m.gain, DEFAULT_GAINS[l], 0, 1),
      mute: bool(m.mute, false),
      ...(l === 'bed' || l === 'wind' ? {} : { sample: typeof m.sample === 'string' ? m.sample : null }),
    };
  }
  const loopMix: MixerSnapshot['loopMix'] = {};
  if (r.loopMix && typeof r.loopMix === 'object') {
    for (const [id, v] of Object.entries(r.loopMix as Record<string, Record<string, unknown>>)) {
      if (v && typeof v === 'object') loopMix[id] = { gain: finite(v.gain, 0.8, 0, 1), mute: bool(v.mute, false) };
    }
  }
  return {
    v: 1,
    mixer,
    bedOsc: oneOf(r.bedOsc, BED_OSCS, 'sine'),
    noiseColor: oneOf(r.noiseColor, NOISE_COLORS, 'pink'),
    reverbWet: finite(r.reverbWet, 0.35, 0, 1),
    loopMix,
  };
}

