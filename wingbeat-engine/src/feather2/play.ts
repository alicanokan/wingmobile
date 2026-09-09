// ============================================================================
//  Play contract — how a live trigger (a phone gesture, a key, a sensor) drives
//  one part of the feather with one chosen movement.
//
//  The studio (/feather2) shapes a feather and saves per-mask "life" (Still,
//  Breathe, Wave, Fly, Swirl, Pulse) as a resting state. A PlayChannel is the
//  performed counterpart: the host feeds a 0..1 level, the renderer smooths it
//  with attack/release and uses it as the movement AMOUNT for every mask that
//  belongs to the chosen part. Strength is the ceiling, Speed the tempo of the
//  movement. A channel set to Still leaves its part to the studio's own life.
// ============================================================================

import type { LayerKind } from './LabPanels.tsx';
import type { MotionType } from '../sim/rig.ts';

export type PlayPart = 'barbs' | 'rachis' | 'down' | 'patterns' | 'colours' | 'extras';

export const PLAY_PARTS: ReadonlyArray<{ id: PlayPart; label: string; hint: string }> = [
  { id: 'barbs', label: 'Barbs', hint: 'The feather’s main surface' },
  { id: 'rachis', label: 'Rachis', hint: 'One continuous, bending shaft' },
  { id: 'down', label: 'Little feathers', hint: 'Soft fibres around the base' },
  { id: 'patterns', label: 'Patterns', hint: 'Markings across the barbs' },
  { id: 'colours', label: 'Colours', hint: 'The main feather palette' },
  { id: 'extras', label: 'Extras', hint: 'Accent colours and marking anatomy' },
];

/** Same vocabulary and life modes as the studio's simple controls. */
export const PLAY_EFFECTS: ReadonlyArray<{ name: string; mode: number; speed: number }> = [
  { name: 'Still', mode: 0, speed: 0.45 },
  { name: 'Breathe', mode: 1, speed: 0.4 },
  { name: 'Wave', mode: 6, speed: 0.5 },
  { name: 'Fly', mode: 2, speed: 0.45 },
  { name: 'Swirl', mode: 3, speed: 0.5 },
  { name: 'Pulse', mode: 5, speed: 0.6 },
];

export interface PlayChannel {
  part: PlayPart;
  /** Life mode (see PLAY_EFFECTS). 0 = Still: the channel does not touch its part. */
  mode: number;
  /** Movement amount at full trigger, 0..2. */
  strength: number;
  /** Movement tempo, 0..3. */
  speed: number;
  /** Envelope, milliseconds. */
  attack: number;
  release: number;
}

export interface FeatherPlay {
  /** Live trigger level per channel, 0..1 — the host writes, the renderer reads every frame. */
  levels: number[];
  channels: PlayChannel[];
  /** True when the host already shaped `levels` with its own attack/release
   *  (e.g. the rig envelope the classic particles use); the renderer then
   *  takes them as-is instead of applying each channel's attack/release. */
  enveloped?: boolean;
}

/** Which studio masks a play part addresses (mirrors SimpleControls). */
export function playPartMatches(part: PlayPart, layer: { kind: LayerKind; index: number }): boolean {
  switch (part) {
    case 'barbs': return layer.kind === 'parts' && layer.index === 2;
    case 'rachis': return layer.kind === 'parts' && (layer.index === 1 || layer.index === 0);
    case 'down': return layer.kind === 'parts' && layer.index === 3;
    case 'patterns': return layer.kind === 'patterns';
    case 'colours': return layer.kind === 'colors' && layer.index < 2;
    case 'extras': return (layer.kind === 'parts' && layer.index === 4) || (layer.kind === 'colors' && layer.index >= 2);
  }
}

/** The five installation channels (Tip, Rachis, Colour A, Colour B, Tail), each given a sensible movement. */
export function defaultPlayChannels(): PlayChannel[] {
  return [
    { part: 'barbs', mode: 6, strength: 0.9, speed: 0.5, attack: 40, release: 650 },
    { part: 'rachis', mode: 6, strength: 0.8, speed: 0.5, attack: 60, release: 900 },
    { part: 'colours', mode: 1, strength: 0.8, speed: 0.4, attack: 40, release: 700 },
    { part: 'extras', mode: 5, strength: 0.9, speed: 0.6, attack: 30, release: 500 },
    { part: 'down', mode: 2, strength: 1, speed: 0.45, attack: 40, release: 800 },
  ];
}

const PARTS = new Set<string>(PLAY_PARTS.map((p) => p.id));
const MODES = new Set<number>(PLAY_EFFECTS.map((e) => e.mode));
const num = (v: unknown, fallback: number, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

/** Coerce stored or remote data into valid channels; never throws, always `count` long. */
export function validatePlayChannels(raw: unknown, count = 5): PlayChannel[] {
  const base = defaultPlayChannels();
  while (base.length < count) base.push({ part: 'barbs', mode: 0, strength: 0.8, speed: 0.5, attack: 40, release: 650 });
  const list = Array.isArray(raw) ? raw : [];
  return base.slice(0, count).map((fallback, i) => {
    const item = (list[i] && typeof list[i] === 'object' ? list[i] : {}) as Partial<Record<keyof PlayChannel, unknown>>;
    const mode = Math.round(num(item.mode, fallback.mode, 0, 6));
    return {
      part: typeof item.part === 'string' && PARTS.has(item.part) ? (item.part as PlayPart) : fallback.part,
      mode: MODES.has(mode) ? mode : fallback.mode,
      strength: num(item.strength, fallback.strength, 0, 2),
      speed: num(item.speed, fallback.speed, 0, 3),
      attack: num(item.attack, fallback.attack, 1, 2000),
      release: num(item.release, fallback.release, 20, 5000),
    };
  });
}

// ---- classic particles → living feather -----------------------------------
// The classic projection gives every sensor one of eight motion shapes. These
// are the closest living movements, so a rig built for the classic renderer
// (or a conductor preset) plays the same way on the living feather.
export const CLASSIC_TO_PLAY: Record<MotionType, { mode: number; speed: number }> = {
  swirl: { mode: 3, speed: 0.5 },    // circular orbit → Swirl
  rise: { mode: 2, speed: 0.4 },     // drift up + bloom outward → Fly
  scatter: { mode: 2, speed: 0.8 },  // radial burst → Fly, faster
  wave: { mode: 6, speed: 0.5 },     // travelling wave up the shaft → Wave
  flutter: { mode: 1, speed: 1.4 },  // fast fine jitter → Breathe, fast
  pulse: { mode: 5, speed: 0.6 },    // breathe out/in from the rachis → Pulse
  fall: { mode: 1, speed: 0.3 },     // sink + sideways drift → Breathe, slow
  pulseZ: { mode: 5, speed: 0.7 },   // push toward/away from the screen → Pulse
};

/** Build channels from the classic rig: motion shape → movement, reach → strength. */
export function playChannelsFromClassic(sensors: Array<{ motionType?: MotionType; reach?: number } | undefined>, count = 5): PlayChannel[] {
  const base = defaultPlayChannels();
  return validatePlayChannels(
    Array.from({ length: count }, (_, i) => {
      const sensor = sensors[i];
      const fallback = base[i] ?? base[0];
      const match = sensor?.motionType ? CLASSIC_TO_PLAY[sensor.motionType] : undefined;
      const reach = typeof sensor?.reach === 'number' && Number.isFinite(sensor.reach) ? Math.max(0, Math.min(1, sensor.reach)) : 0.5;
      return {
        ...fallback,
        mode: match?.mode ?? fallback.mode,
        speed: match?.speed ?? fallback.speed,
        strength: 0.5 + reach * 1.2,
      };
    }),
    count,
  );
}
