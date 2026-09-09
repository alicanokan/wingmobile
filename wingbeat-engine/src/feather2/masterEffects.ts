export type MasterEffectPreset = 'none' | 'pulse' | 'flutter' | 'shimmer' | 'lift' | 'blackout';
export type MasterEffectMode = 'toggle' | 'gate' | 'oneshot';

export interface MasterEffectConfig {
  preset: MasterEffectPreset;
  trigger: string;
  mode: MasterEffectMode;
  amount: number;
}

export interface MasterEffectState {
  key: string;
  previous: number;
  toggled: boolean;
  envelope: number;
}

export interface MasterEffectModifiers {
  brightness: number;
  size: number;
  movement: number;
  depth: number;
}

export const MASTER_EFFECT_PRESETS: Array<{ id: MasterEffectPreset; label: string; hint: string }> = [
  { id: 'none', label: 'None', hint: 'No effect' },
  { id: 'pulse', label: 'Pulse', hint: 'Breathing light and particle expansion' },
  { id: 'flutter', label: 'Flutter', hint: 'Fast fibre movement with a small depth ripple' },
  { id: 'shimmer', label: 'Shimmer', hint: 'Rapid highlights across the selected master' },
  { id: 'lift', label: 'Lift', hint: 'Moves the master forward in depth' },
  { id: 'blackout', label: 'Blackout', hint: 'Cuts the master brightness' },
];

export function initialMasterEffectState(): MasterEffectState {
  return { key: '', previous: 0, toggled: false, envelope: 0 };
}

/** Frame-rate-independent trigger state and preset modulation. */
export function stepMasterEffect(
  config: MasterEffectConfig,
  state: MasterEffectState,
  input: number,
  time: number,
  dt: number,
): MasterEffectModifiers {
  const key = `${config.preset}:${config.trigger}:${config.mode}`;
  if (state.key !== key) {
    state.key = key;
    state.previous = 0;
    state.toggled = false;
    state.envelope = 0;
  }
  const signal = Number.isFinite(input) ? Math.max(0, Math.min(1, input)) : 0;
  const rising = signal >= 0.42 && state.previous < 0.42;
  state.previous = signal;

  let active = 0;
  if (config.mode === 'toggle') {
    if (rising) state.toggled = !state.toggled;
    active = state.toggled ? 1 : 0;
  } else if (config.mode === 'gate') {
    active = signal;
  } else {
    if (rising) state.envelope = 1;
    else state.envelope *= Math.exp(-Math.max(0, dt) / 0.72);
    active = state.envelope;
  }

  const amount = Math.max(0, Math.min(2, config.amount)) * active;
  const slow = 0.5 + 0.5 * Math.sin(time * 2.6);
  const fast = 0.5 + 0.5 * Math.sin(time * 13.0);
  const sparkle = Math.pow(0.5 + 0.5 * Math.sin(time * 21.0), 5);
  const out: MasterEffectModifiers = { brightness: 1, size: 1, movement: 1, depth: 1 };
  if (config.preset === 'pulse') {
    out.brightness += amount * (0.35 + slow * 0.85);
    out.size += amount * slow * 0.42;
  } else if (config.preset === 'flutter') {
    out.movement += amount * (0.8 + fast * 1.8);
    out.depth += amount * fast * 0.16;
  } else if (config.preset === 'shimmer') {
    out.brightness += amount * sparkle * 1.25;
    out.size += amount * sparkle * 0.18;
  } else if (config.preset === 'lift') {
    out.depth += amount;
    out.size += amount * 0.12;
  } else if (config.preset === 'blackout') {
    out.brightness = Math.max(0, 1 - amount);
  }
  return out;
}
