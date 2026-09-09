export type InteractionMode = 'toggle' | 'gate' | 'oneshot';
export type AnatomicalBehaviour = 'pulse' | 'flutter' | 'shimmer' | 'lift' | 'blackout';
export type InteractionAxis = 'z' | 'x' | 'xy';

export interface InteractionZone {
  id: string;
  name: string;
  enabled: boolean;
  trigger: string;
  mode: InteractionMode;
  behaviour: AnatomicalBehaviour;
  /** Z moves a routed mask in/out; XY keeps vertical motion coupled as a wave. */
  axis: InteractionAxis;
  amount: number;
  speed: number;
  attack: number;
  release: number;
  /** Minimum layer depth applied to routed masks while this zone is triggered. */
  layerDepth: number;
}

export interface InteractionZoneDocument {
  selectedId: string;
  zones: InteractionZone[];
  /** master id → zone id → gain */
  routes: Record<string, Record<string, number>>;
}

export interface InteractionZoneState {
  key: string;
  previous: number;
  toggled: boolean;
  impulse: number;
  envelope: number;
  progress: number;
}

export interface InteractionModifiers {
  brightness: number;
  size: number;
  movement: number;
  depth: number;
  shaft: number;
  vane: number;
  fringe: number;
  travel: number;
  travelPosition: number;
  axisX: number;
  axisY: number;
  axisZ: number;
  layerDepth: number;
}

const neutral = (): InteractionModifiers => ({ brightness: 1, size: 1, movement: 1, depth: 1, shaft: 0, vane: 0, fringe: 0, travel: 0, travelPosition: 0, axisX: 0, axisY: 0, axisZ: 0, layerDepth: 0 });

export function initialInteractionZoneState(): InteractionZoneState {
  return { key: '', previous: 0, toggled: false, impulse: 0, envelope: 0, progress: 0 };
}

export function defaultInteractionZones(): InteractionZone[] {
  return [
    { id: 'zone-pulse', name: 'Depth pulse', enabled: true, trigger: 'kick', mode: 'oneshot', behaviour: 'pulse', axis: 'z', amount: 0.7, speed: 2.4, attack: 12, release: 520, layerDepth: 0 },
    { id: 'zone-flutter', name: 'Fringe depth', enabled: true, trigger: 'hat', mode: 'gate', behaviour: 'flutter', axis: 'z', amount: 0.8, speed: 7, attack: 20, release: 420, layerDepth: 0 },
    { id: 'zone-lift', name: 'Vane wave', enabled: true, trigger: 'bass', mode: 'gate', behaviour: 'lift', axis: 'xy', amount: 0.65, speed: 1, attack: 160, release: 1100, layerDepth: 0 },
    { id: 'zone-shimmer', name: 'Surface shimmer', enabled: true, trigger: 'vocal', mode: 'gate', behaviour: 'shimmer', axis: 'z', amount: 0.45, speed: 2, attack: 90, release: 700, layerDepth: 0 },
  ];
}

/** Updates one zone and returns neutral-relative capability multipliers. */
export function stepInteractionZone(zone: InteractionZone, state: InteractionZoneState, input: number, time: number, dt: number): InteractionModifiers {
  const key = `${zone.trigger}:${zone.mode}`;
  if (state.key !== key) {
    state.key = key;
    state.previous = 0;
    state.toggled = false;
    state.impulse = 0;
    state.envelope = 0;
    state.progress = 0;
  }
  if (!zone.enabled) {
    state.envelope = 0;
    return neutral();
  }

  const signal = Number.isFinite(input) ? Math.max(0, Math.min(1, input)) : 0;
  const rising = signal >= 0.42 && state.previous < 0.42;
  state.previous = signal;
  let target = 0;
  if (zone.mode === 'toggle') {
    if (rising) state.toggled = !state.toggled;
    target = state.toggled ? 1 : 0;
  } else if (zone.mode === 'gate') {
    target = signal;
  } else {
    if (rising) {
      state.impulse = 1;
      state.progress = 0;
    }
    else state.impulse *= Math.exp(-Math.max(0, dt) / Math.max(0.05, zone.release / 1000));
    target = state.impulse;
  }
  if (state.envelope > 0.001 || target > 0.001) state.progress = Math.min(1, state.progress + Math.max(0, dt) * Math.max(0.05, zone.speed) * 0.32);

  const ms = target > state.envelope ? zone.attack : zone.release;
  const alpha = 1 - Math.exp(-Math.max(0, dt) / Math.max(0.001, ms / 1000));
  state.envelope += (target - state.envelope) * alpha;
  const phase = time * Math.max(0.05, zone.speed) * Math.PI * 2;
  const oscillation = 0.72 + 0.28 * Math.sin(phase);
  const amount = Math.max(0, Math.min(1.5, zone.amount)) * state.envelope;
  const out = neutral();
  out.layerDepth = Math.max(0, Math.min(2.5, zone.layerDepth ?? 0)) * state.envelope;
  if (zone.behaviour === 'flutter') {
    out.movement += amount * (0.65 + oscillation * 0.55);
    out.depth += amount * oscillation * 0.08;
    out.fringe = amount;
  } else if (zone.behaviour === 'lift') {
    out.movement += amount * 0.18;
    out.depth += amount * 0.35;
    out.vane = amount;
    out.shaft = amount * 0.28;
  } else if (zone.behaviour === 'shimmer') {
    out.brightness += amount * oscillation * 0.5;
  } else if (zone.behaviour === 'pulse') {
    out.brightness += amount * 0.14;
    out.movement += amount * 0.22;
    out.travel = amount;
    out.travelPosition = state.progress;
    out.vane = amount * 0.3;
  } else if (zone.behaviour === 'blackout') {
    out.brightness = Math.max(0, 1 - amount);
  }
  // Spatial output is signed, so depth visibly travels both in front of and
  // behind the rest plane. Y exists only as an X-coupled wave amplitude.
  if (zone.behaviour !== 'blackout' && zone.behaviour !== 'shimmer') {
    const signed = amount * Math.sin(phase);
    if (zone.axis === 'x') out.axisX = signed;
    else if (zone.axis === 'xy') {
      out.axisX = signed;
      out.axisY = amount;
    } else out.axisZ = signed;
  }
  return out;
}

export function mixRoutedInteractionZones(
  zones: InteractionZone[],
  modifiers: Map<string, InteractionModifiers>,
  routes: Record<string, number>,
): InteractionModifiers {
  const mixed = neutral();
  let travelWeight = 0;
  for (const zone of zones) {
    const gain = Math.max(0, Math.min(1, routes[zone.id] ?? 0));
    const value = modifiers.get(zone.id);
    if (!gain || !value) continue;
    mixed.brightness += (value.brightness - 1) * gain;
    mixed.size += (value.size - 1) * gain;
    mixed.movement += (value.movement - 1) * gain;
    mixed.depth += (value.depth - 1) * gain;
    mixed.shaft += value.shaft * gain;
    mixed.vane += value.vane * gain;
    mixed.fringe += value.fringe * gain;
    mixed.travel += value.travel * gain;
    mixed.travelPosition += value.travelPosition * value.travel * gain;
    mixed.axisX += value.axisX * gain;
    mixed.axisY += value.axisY * gain;
    mixed.axisZ += value.axisZ * gain;
    mixed.layerDepth = Math.max(mixed.layerDepth, (value.layerDepth ?? 0) * gain);
    travelWeight += value.travel * gain;
  }
  mixed.brightness = Math.max(0, Math.min(1.8, mixed.brightness));
  mixed.size = Math.max(0.85, Math.min(1.15, mixed.size));
  mixed.movement = Math.max(0, Math.min(2.25, mixed.movement));
  mixed.depth = Math.max(0.75, Math.min(1.5, mixed.depth));
  mixed.shaft = Math.min(0.32, mixed.shaft);
  mixed.vane = Math.min(1, mixed.vane);
  mixed.fringe = Math.min(1, mixed.fringe);
  mixed.travel = Math.min(1, mixed.travel);
  mixed.travelPosition = travelWeight > 0 ? mixed.travelPosition / travelWeight : 0;
  mixed.axisX = Math.max(-1.25, Math.min(1.25, mixed.axisX));
  mixed.axisY = Math.max(0, Math.min(1.25, mixed.axisY));
  mixed.axisZ = Math.max(-1.25, Math.min(1.25, mixed.axisZ));
  mixed.layerDepth = Math.max(0, Math.min(2.5, mixed.layerDepth));
  return mixed;
}
