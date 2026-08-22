// ============================================================================
//  Rig — the modular, per-sensor control model for the particle feather.
//
//  LAYERS are the analyzed pattern of a feather. Each layer is one of:
//    auto  — a k-means color cluster the engine found (count is adjustable, so
//            a plain feather can use 2 layers and a patterned one 6)
//    color — a user color + tolerance (a "color range")
//    area  — a user-marked vertical band of the feather
//  A particle can belong to MANY layers. Sensors route to any set of layers.
//
//  A FeatherPreset bundles layers + global motion + per-sensor RIGS (Movement /
//  Release / Color / Monitor modules). Presets save/recall/export/import as one
//  JSON per feather (presets.ts). The live `rig` is read by the shader each frame.
// ============================================================================

import { SENSOR_CHANNELS, sideCode } from './channels.ts';

export const MAX_LAYERS = 8;

export type ModuleType = 'movement' | 'release' | 'color' | 'monitor';
export const MODULE_TYPES: ModuleType[] = ['movement', 'release', 'color', 'monitor'];
export const MODULE_LABELS: Record<ModuleType, string> = {
  movement: 'Movement',
  release: 'Envelope',
  color: 'Color',
  monitor: 'Monitor',
};

// Movement shapes a layer's particles take when triggered (swirl is just one).
export type MotionType = 'swirl' | 'rise' | 'scatter' | 'wave' | 'flutter' | 'pulse' | 'fall' | 'pulseZ';
export const MOTION_TYPES: MotionType[] = ['swirl', 'rise', 'scatter', 'wave', 'flutter', 'pulse', 'fall', 'pulseZ'];
export const MOTION_LABELS: Record<MotionType, string> = {
  swirl: 'Swirl', rise: 'Rise', scatter: 'Scatter', wave: 'Wave', flutter: 'Flutter', pulse: 'Pulse', fall: 'Fall', pulseZ: 'Pulse front/back',
};
export const MOTION_CODE: Record<MotionType, number> = {
  swirl: 0, rise: 1, scatter: 2, wave: 3, flutter: 4, pulse: 5, fall: 6, pulseZ: 7,
};

// Which EQ band of a sensor's loop drives its layer's audio-reactivity.
// 'custom' uses audioBandRange (Hz) instead of a fixed third — set visually
// in the Conductor's EQ editor.
export type AudioBand = 'full' | 'low' | 'mid' | 'high' | 'custom';
export const AUDIO_BANDS: AudioBand[] = ['full', 'low', 'mid', 'high', 'custom'];
export const AUDIO_BAND_LABELS: Record<AudioBand, string> = {
  full: 'Full', low: 'Bass', mid: 'Mid', high: 'Treble', custom: 'Custom',
};

export type LayerKind = 'auto' | 'color' | 'area';
export interface LayerDef {
  kind: LayerKind;
  label: string;
  rgb?: [number, number, number]; // auto: cluster color · color: target color
  tol?: number; // color: match tolerance (0..1 in rgb distance)
  yMin?: number; // area: 0 tail … 1 tip
  yMax?: number;
}

// Each layer can sound: the built-in synth, a loaded sample, or a generated pattern.
export type LayerSoundMode = 'synth' | 'sample' | 'pattern';
export interface LayerSound {
  mode: LayerSoundMode;
  sampleName?: string;
  seed?: number; // pattern generator seed
}
export function defaultLayerSound(): LayerSound {
  return { mode: 'synth' };
}

export interface SensorRig {
  modules: Record<ModuleType, boolean>;
  motionType: MotionType; // movement shape (swirl / rise / scatter / wave / …)
  audioBand: AudioBand; // which EQ band of this sensor's loop drives its reactivity
  audioBandRange?: [number, number]; // Hz [min,max] — used when audioBand === 'custom'
  eqOn?: boolean; // false = bypass the EQ band; reactivity reads the full loop level (default true)
  reach: number;
  /** Let the routed AUDIO IN level drive Reach instead of the fixed slider:
   *  silence → reachMin, full → reachMax. The slider is ignored while on. */
  reachLink?: boolean;
  reachMin?: number; // floor of the audio→reach mapping (default 0)
  reachMax?: number; // ceiling of the audio→reach mapping (default 1)
  /** Smoothing on the audio→reach follow, in SECONDS (0 = instant). Attack is
   *  how long it takes to open toward a louder level, release how long it takes
   *  to fall back — so reach can snap out and ease home. */
  reachAttack?: number;
  reachRelease?: number;
  swirl: number;
  lift: number;
  maxDist: number;
  attack: number; // energy ramp-UP rate (envelope attack)
  release: number; // energy ramp-DOWN + pump deflate rate (envelope release)
  colorOverride: boolean;
  overrideRGB: [number, number, number];
  layers: number[]; // indices into the combined layer list
  loopSample?: string; // name of a loaded loop sample (synced, launched on activity)
  sensitivity?: number; // input gain 0.2..3 applied to this sensor's incoming level (1 = neutral)
}

export interface GlobalRig {
  sway: number;
  disperse: number;
  audioReact: number;
  size: number;
  stability: number;
  attack: number; // master envelope attack (default for sensors w/o Envelope module)
  release: number; // master envelope release
  amount: number; // particle density 0..1 (mapped to a capped sample resolution)
  bpm: number; // tempo for the shared loop transport
  gravity: number; // gravity-sand: triggered particles fall + dissolve
  hold: number; // layer-visibility hold: 0 fades back to contour … 1 latches layers on
  pulseColor: [number, number, number]; // color of the beat-pulse wave that sweeps each layer
  motion: number; // master motion scale: 0 freezes particles onto the perfect image
  ambient: number; // always-on per-particle drift (0 = frozen when idle, 1 = restless point cloud)
  floatTime: number; // seconds the "air" floats after a pump before it starts to sink
  relief: number; // 3D relief depth of the photo plane (brightness → toward viewer)
  wingBeat: number; // whole-feather swing anchored at the calamus; grows with activation
  audioColor: number; // how much a layer's audio level SHIFTS its colour (0 = none)
  autoAudio: boolean; // auto mode: loops play + drive their layers without triggering
  idleFall: number; // seconds of no interaction before the feather falls like sand
}

export interface FeatherPreset {
  name: string;
  feather: string;
  autoK: number; // number of auto (k-means) color layers to extract
  customLayers: LayerDef[]; // user color-range / area layers
  layerSounds: LayerSound[]; // sound per combined-layer index
  layerGen: number[]; // per-layer ATTACK: how fast the charge climbs (pixel generation)
  layerRel: number[]; // per-layer RELEASE: how fast the charge decays after
  autoColors: ([number, number, number] | null)[]; // per-auto-layer color-source override
  global: GlobalRig;
  sensors: Record<string, SensorRig>;
  /** AUDIO → VIDEO routing: audio channel sensorId → the feather-part sensorIds
   *  its EQ-filtered level drives. Absent/empty = identity (a channel drives its
   *  own part), which is how every pre-router preset behaved. */
  audioRoutes?: Record<string, string[]>;
  updatedAt?: number;
}

/** The feather parts an audio channel's filtered level drives (identity default). */
export function audioRouteTargets(preset: FeatherPreset, channelId: string): string[] {
  const r = preset.audioRoutes?.[channelId];
  return r ?? [channelId];
}

// Device capability detection for adaptive particle optimization.
// Detects device tier (low-end, mid-range, high-end) and applies appropriate limits.
// (Declared BEFORE getDefaultGlobal, which reads DEVICE_TIER at module init.)
function detectDeviceTier(): 'ultra-low' | 'low' | 'mid' | 'high' {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return 'high';

  const cores = navigator.hardwareConcurrency ?? 8;
  const isMobile = window.matchMedia('(max-width: 820px)').matches;
  const isTouchDevice = (navigator.maxTouchPoints ?? 0) > 1;
  const memoryGB = ((navigator as any).deviceMemory ?? 8);

  // Ultra-low-end: very old phones (2-core, <2GB RAM, or max-width < 600px)
  if ((cores <= 2 && memoryGB < 2) || window.matchMedia('(max-width: 600px)').matches) {
    return 'ultra-low';
  }

  // Low-end: older phones/tablets (<=4 cores, touch device)
  if ((cores <= 4 || memoryGB < 4) && isTouchDevice) {
    return 'low';
  }

  // Mid-range: modern phones/tablets
  if (isMobile && isTouchDevice) {
    return 'mid';
  }

  // High-end: desktop/laptop
  return 'high';
}

export const DEVICE_TIER = detectDeviceTier();
export const IS_LOW_POWER = DEVICE_TIER === 'low' || DEVICE_TIER === 'ultra-low';
export const IS_ULTRA_LOW = DEVICE_TIER === 'ultra-low';

function getDefaultGlobal(): GlobalRig {
  const baseDefaults: GlobalRig = { sway: 0.35, disperse: 0.4, audioReact: 0.8, size: 55, stability: 0.85, attack: 0.15, release: 0.08, amount: 1, bpm: 120, gravity: 0.45, hold: 0, pulseColor: [1, 0.85, 0.5], motion: 1, ambient: 0.18, floatTime: 1.4, relief: 0.7, wingBeat: 0.6, audioColor: 0.7, autoAudio: false, idleFall: 5 };

  // Reduce default particle density and size on old devices for better performance
  if (DEVICE_TIER === 'ultra-low') {
    return { ...baseDefaults, amount: 0.3, size: 35, motion: 0.8, audioReact: 0.6 };
  }
  if (DEVICE_TIER === 'low') {
    return { ...baseDefaults, amount: 0.5, size: 45, motion: 0.9 };
  }
  if (DEVICE_TIER === 'mid') {
    return { ...baseDefaults, amount: 0.8, size: 50 };
  }

  return baseDefaults;
}

export const DEFAULT_GLOBAL: GlobalRig = getDefaultGlobal();

// particle sampling width derived from the amount (capped to protect the GPU).
// Higher = the particles reconstruct the image at finer detail. The point size
// auto-scales down with width (see uDensityScale) so density adds detail, not mush.
export const PART_W_MIN = 150;
export const PART_W_MAX = 1400;
export const PART_W_REF = 205; // reference width at which point size == the slider value

/** Ceiling applied to `amount` on this device. */
export const DEVICE_AMOUNT_CAP =
  DEVICE_TIER === 'ultra-low' ? 0.3 :  // very old phones: max 30% particles
  DEVICE_TIER === 'low' ? 0.5 :         // old phones: max 50% particles
  DEVICE_TIER === 'mid' ? 0.8 :         // modern phones: max 80% particles
  1;                                     // desktop: full 100%

/** Multiplier applied to point size on this device. */
export const DEVICE_SIZE_SCALE =
  DEVICE_TIER === 'ultra-low' ? 0.55 :  // very old: 55% size
  DEVICE_TIER === 'low' ? 0.72 :         // old: 72% size
  DEVICE_TIER === 'mid' ? 0.85 :         // modern: 85% size
  1;                                      // desktop: 100%

export function particleSampleW(): number {
  const amount = Math.min(Math.max(0, Math.min(1, rig.global.amount)), DEVICE_AMOUNT_CAP);
  return Math.round(PART_W_MIN + amount * (PART_W_MAX - PART_W_MIN));
}

export function defaultSensorRig(sensorId: string): SensorRig {
  const idx = SENSOR_CHANNELS.findIndex((c) => c.sensor === sensorId);
  return {
    // Envelope ON by default: the Conductor always shows a per-part Attack /
    // Release, and with this false those values were silently ignored (the
    // global envelope was used instead), so setting them appeared to do nothing.
    modules: { movement: true, monitor: true, release: true, color: false },
    motionType: 'swirl',
    audioBand: 'full',
    eqOn: true,
    reach: 0.5,
    reachLink: false,
    reachMin: 0,
    reachMax: 1,
    reachAttack: 0.05,
    reachRelease: 0.25,
    swirl: 0.6,
    lift: 0.6,
    maxDist: 1.1,
    attack: 0.15,
    release: 0.08,
    colorOverride: false,
    overrideRGB: [1, 0.8, 0.3],
    // One layer per sensor. This used to be `idx % 4`, which wrapped the 5th
    // sensor (Tail) back onto layer 0 — the same layer as Tip — so pulsing Tail
    // visibly moved the Tip's particles. autoK now defaults to 5 so every
    // sensor has a layer of its own.
    layers: idx >= 0 ? [idx] : [],
    sensitivity: 1,
  };
}

export function defaultPreset(feather: string): FeatherPreset {
  const sensors: Record<string, SensorRig> = {};
  for (const c of SENSOR_CHANNELS) sensors[c.sensor] = defaultSensorRig(c.sensor);
  // autoK 5 = one colour layer per sensor, so no two sensors share a layer.
  return { name: 'default', feather, autoK: 5, customLayers: [], layerSounds: [], layerGen: [], layerRel: [], autoColors: [], global: { ...DEFAULT_GLOBAL }, sensors };
}

/** Sound config for a layer index (defaults to the built-in synth). */
export function layerSound(i: number): LayerSound {
  return rig.layerSounds[i] ?? (rig.layerSounds[i] = defaultLayerSound());
}

/** Per-layer ATTACK — how fast the charge climbs (0.03 slow … 0.6 instant). */
export function layerGen(i: number): number {
  return rig.layerGen[i] ?? 0.15;
}
export function setLayerGen(i: number, v: number) {
  rig.layerGen[i] = v;
}
/** Per-layer RELEASE — how fast the charge decays after (0.02 long … 0.4 short). */
export function layerRelease(i: number): number {
  return rig.layerRel[i] ?? 0.06;
}
export function setLayerRelease(i: number, v: number) {
  rig.layerRel[i] = v;
}

export const rig: FeatherPreset = defaultPreset('procedural');

export function loadIntoRig(raw: FeatherPreset) {
  // Validate on the way in, whatever the source: a preset from an older
  // version, a hand-edited JSON or a cloud push can't leave the rig malformed.
  const preset = validatePreset(raw, rig.feather);
  rig.name = preset.name;
  rig.feather = preset.feather;
  rig.autoK = preset.autoK;
  rig.customLayers = preset.customLayers;
  rig.layerSounds = preset.layerSounds;
  rig.layerGen = preset.layerGen;
  rig.layerRel = preset.layerRel;
  rig.autoColors = preset.autoColors;
  rig.global = preset.global;
  rig.sensors = preset.sensors;
  rig.audioRoutes = preset.audioRoutes;
  rig.updatedAt = preset.updatedAt;
  notifyRigChange();
}

export function snapshotPreset(name?: string): FeatherPreset {
  return JSON.parse(JSON.stringify({ ...rig, name: name ?? rig.name, updatedAt: Date.now() }));
}

// ---- Combined layer list (auto clusters + custom) --------------------------
// `palette` is the analyzed k-means colors for the current feather.
export function combinedLayers(palette: number[][]): LayerDef[] {
  const auto: LayerDef[] = palette.slice(0, rig.autoK).map((c, i) => {
    const o = rig.autoColors[i];
    return { kind: 'auto', label: `L${i}`, rgb: o ? [o[0], o[1], o[2]] : [c[0], c[1], c[2]] };
  });
  return [...auto, ...rig.customLayers].slice(0, MAX_LAYERS);
}

/** Membership of one particle (rgb 0..1, h 0..1 tail→tip) in each layer. */
export function layerMembership(layers: LayerDef[], r: number, g: number, b: number, h: number, autoNearest: number): number[] {
  return layers.map((L, i) => {
    if (L.kind === 'auto') return i === autoNearest ? 1 : 0;
    if (L.kind === 'color' && L.rgb) {
      const d = Math.hypot(r - L.rgb[0], g - L.rgb[1], b - L.rgb[2]);
      return d < (L.tol ?? 0.2) ? 1 : 0;
    }
    if (L.kind === 'area') return h >= (L.yMin ?? 0) && h <= (L.yMax ?? 1) ? 1 : 0;
    return 0;
  });
}

// ---- layer-change pubsub (so the particle cloud rebuilds when layers edit) --
const layerListeners = new Set<() => void>();
export function onLayersChange(cb: () => void): () => void {
  layerListeners.add(cb);
  return () => layerListeners.delete(cb);
}
export function notifyLayersChange() {
  layerListeners.forEach((cb) => cb());
  notifyRigChange(); // a layer edit is a rig edit too
}

// ---- rig-change pubsub (any value) -------------------------------------------
// `rig` is a mutable singleton by design (the shader reads it every frame with
// zero indirection). What it lacked was a way for the UI to learn that someone
// else changed it. Mutate, then notify; panels subscribe via useRigTick().
const rigListeners = new Set<() => void>();
export function onRigChange(cb: () => void): () => void {
  rigListeners.add(cb);
  return () => rigListeners.delete(cb);
}
export function notifyRigChange() {
  rigListeners.forEach((cb) => {
    try { cb(); } catch (err) { console.warn('[rig] listener failed', err); }
  });
}

// ---- validation --------------------------------------------------------------
// Presets arrive from localStorage, JSON files and the cloud — all of which
// can be stale, hand-edited or from a different version. Every number is
// clamped to its sane range and every missing field gets its default, so a
// blind load can't NaN the shader or leave a sensor with no modules object.
const fin = (v: unknown, fb: number, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fb;
const rgb3 = (v: unknown, fb: [number, number, number]): [number, number, number] =>
  Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x))
    ? [Math.min(1, Math.max(0, v[0])), Math.min(1, Math.max(0, v[1])), Math.min(1, Math.max(0, v[2]))]
    : fb;

export function validateGlobal(raw: unknown): GlobalRig {
  const g = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const D = DEFAULT_GLOBAL;
  return {
    sway: fin(g.sway, D.sway, 0, 1), disperse: fin(g.disperse, D.disperse, 0, 1), audioReact: fin(g.audioReact, D.audioReact, 0, 2),
    size: fin(g.size, D.size, 1, 200), stability: fin(g.stability, D.stability, 0, 1), attack: fin(g.attack, D.attack, 0.001, 1),
    release: fin(g.release, D.release, 0.001, 1), amount: fin(g.amount, D.amount, 0, 1), bpm: fin(g.bpm, D.bpm, 40, 220),
    gravity: fin(g.gravity, D.gravity, 0, 1), hold: fin(g.hold, D.hold, 0, 1), pulseColor: rgb3(g.pulseColor, D.pulseColor),
    motion: fin(g.motion, D.motion, 0, 2), ambient: fin(g.ambient, D.ambient, 0, 1), floatTime: fin(g.floatTime, D.floatTime, 0, 20),
    relief: fin(g.relief, D.relief, 0, 2), wingBeat: fin(g.wingBeat, D.wingBeat, 0, 2), audioColor: fin(g.audioColor, D.audioColor, 0, 2),
    autoAudio: typeof g.autoAudio === 'boolean' ? g.autoAudio : D.autoAudio, idleFall: fin(g.idleFall, D.idleFall, 0, 600),
  };
}

export function validateSensor(sensorId: string, raw: unknown): SensorRig {
  const d = defaultSensorRig(sensorId);
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const mods = (r.modules && typeof r.modules === 'object' ? r.modules : {}) as Record<string, unknown>;
  const modules = { ...d.modules };
  for (const m of MODULE_TYPES) if (typeof mods[m] === 'boolean') modules[m] = mods[m] as boolean;
  const layers = Array.isArray(r.layers) ? r.layers.filter((x): x is number => typeof x === 'number' && x >= 0 && x < MAX_LAYERS) : d.layers;
  const range = Array.isArray(r.audioBandRange) && r.audioBandRange.length === 2 && r.audioBandRange.every((x: unknown) => typeof x === 'number' && Number.isFinite(x))
    ? ([Math.max(0, r.audioBandRange[0]), Math.max(0, r.audioBandRange[1])] as [number, number]) : undefined;
  return {
    modules,
    motionType: MOTION_TYPES.includes(r.motionType as MotionType) ? (r.motionType as MotionType) : d.motionType,
    audioBand: AUDIO_BANDS.includes(r.audioBand as AudioBand) ? (r.audioBand as AudioBand) : d.audioBand,
    ...(range ? { audioBandRange: range } : {}),
    eqOn: typeof r.eqOn === 'boolean' ? r.eqOn : d.eqOn,
    reach: fin(r.reach, d.reach, 0, 2), reachLink: typeof r.reachLink === 'boolean' ? r.reachLink : d.reachLink,
    reachMin: fin(r.reachMin, d.reachMin ?? 0, 0, 2), reachMax: fin(r.reachMax, d.reachMax ?? 1, 0, 2),
    reachAttack: fin(r.reachAttack, d.reachAttack ?? 0.05, 0, 10), reachRelease: fin(r.reachRelease, d.reachRelease ?? 0.25, 0, 10),
    swirl: fin(r.swirl, d.swirl, 0, 2), lift: fin(r.lift, d.lift, 0, 2), maxDist: fin(r.maxDist, d.maxDist, 0, 5),
    attack: fin(r.attack, d.attack, 0.001, 1), release: fin(r.release, d.release, 0.001, 1),
    colorOverride: typeof r.colorOverride === 'boolean' ? r.colorOverride : d.colorOverride,
    overrideRGB: rgb3(r.overrideRGB, d.overrideRGB),
    layers,
    ...(typeof r.loopSample === 'string' ? { loopSample: r.loopSample } : {}),
    sensitivity: fin(r.sensitivity, d.sensitivity ?? 1, 0.2, 3),
  };
}

/** Coerce anything into a well-formed FeatherPreset (never throws). */
export function validatePreset(raw: unknown, fallbackFeather = 'procedural'): FeatherPreset {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const feather = typeof p.feather === 'string' && p.feather ? p.feather : fallbackFeather;
  const sensors: Record<string, SensorRig> = {};
  const ps = (p.sensors && typeof p.sensors === 'object' ? p.sensors : {}) as Record<string, unknown>;
  for (const c of SENSOR_CHANNELS) sensors[c.sensor] = validateSensor(c.sensor, ps[c.sensor]);
  const numArr = (v: unknown, lo: number, hi: number) => (Array.isArray(v) ? v.map((x) => fin(x, lo, lo, hi)) : []);
  const layerSounds: LayerSound[] = Array.isArray(p.layerSounds)
    ? p.layerSounds.map((ls) => {
        const o = (ls && typeof ls === 'object' ? ls : {}) as Record<string, unknown>;
        const mode: LayerSoundMode = o.mode === 'sample' || o.mode === 'pattern' ? o.mode : 'synth';
        return { mode, ...(typeof o.sampleName === 'string' ? { sampleName: o.sampleName } : {}), ...(typeof o.seed === 'number' ? { seed: o.seed } : {}) };
      })
    : [];
  const customLayers: LayerDef[] = Array.isArray(p.customLayers)
    ? p.customLayers.filter((L) => L && typeof L === 'object' && (L.kind === 'color' || L.kind === 'area' || L.kind === 'auto')).map((L) => ({
        kind: L.kind as LayerKind, label: typeof L.label === 'string' ? L.label : L.kind,
        ...(L.rgb ? { rgb: rgb3(L.rgb, [1, 1, 1]) } : {}), ...(typeof L.tol === 'number' ? { tol: fin(L.tol, 0.2, 0, 1) } : {}),
        ...(typeof L.yMin === 'number' ? { yMin: fin(L.yMin, 0, 0, 1) } : {}), ...(typeof L.yMax === 'number' ? { yMax: fin(L.yMax, 1, 0, 1) } : {}),
      }))
    : [];
  const autoColors = Array.isArray(p.autoColors) ? p.autoColors.map((c) => (c ? rgb3(c, [1, 1, 1]) : null)) : [];
  const routes: Record<string, string[]> | undefined = p.audioRoutes && typeof p.audioRoutes === 'object'
    ? Object.fromEntries(Object.entries(p.audioRoutes as Record<string, unknown>).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as unknown[]).filter((x): x is string => typeof x === 'string')]))
    : undefined;
  return {
    name: typeof p.name === 'string' ? p.name : 'preset',
    feather,
    autoK: Math.round(fin(p.autoK, 5, 1, MAX_LAYERS)),
    customLayers,
    layerSounds,
    layerGen: numArr(p.layerGen, 0.01, 1),
    layerRel: numArr(p.layerRel, 0.01, 1),
    autoColors,
    global: validateGlobal(p.global),
    sensors,
    ...(routes ? { audioRoutes: routes } : {}),
    ...(typeof p.updatedAt === 'number' ? { updatedAt: p.updatedAt } : {}),
  };
}

// ---- Shader uniform packing (per-sensor) -----------------------------------
export interface RigUniforms {
  uReach: number[];
  uSwirl: number[];
  uLift: number[];
  uMaxDist: number[];
  uMotionType: number[];
  uRouteA: Float32Array; // NCH*4  (layers 0..3 routing weight per sensor)
  uRouteB: Float32Array; // NCH*4  (layers 4..7)
  uColorOn: number[];
  uColorRGB: Float32Array; // NCH*3
  attack: number[]; // energy ramp-up rate per sensor
  release: number[]; // energy ramp-down / pump deflate rate per sensor
}

export function packRigUniforms(): RigUniforms {
  const n = SENSOR_CHANNELS.length;
  const u: RigUniforms = {
    uReach: new Array(n).fill(0),
    uSwirl: new Array(n).fill(0),
    uLift: new Array(n).fill(0),
    uMaxDist: new Array(n).fill(1),
    uMotionType: new Array(n).fill(0),
    uRouteA: new Float32Array(n * 4),
    uRouteB: new Float32Array(n * 4),
    uColorOn: new Array(n).fill(0),
    uColorRGB: new Float32Array(n * 3),
    attack: new Array(n).fill(0.15),
    release: new Array(n).fill(0.08),
  };
  SENSOR_CHANNELS.forEach((c, i) => {
    const s = rig.sensors[c.sensor] ?? defaultSensorRig(c.sensor);
    u.uReach[i] = s.modules.movement ? s.reach : 0;
    u.uSwirl[i] = s.swirl;
    u.uLift[i] = s.lift;
    u.uMaxDist[i] = s.maxDist;
    u.uMotionType[i] = MOTION_CODE[s.motionType ?? 'swirl'];
    for (const li of s.layers) {
      if (li >= 0 && li < 4) u.uRouteA[i * 4 + li] = 1;
      else if (li >= 4 && li < 8) u.uRouteB[i * 4 + (li - 4)] = 1;
    }
    // Color module ON = recolor this layer (the module IS the switch now)
    u.uColorOn[i] = s.modules.color ? 1 : 0;
    u.uColorRGB[i * 3] = s.overrideRGB[0];
    u.uColorRGB[i * 3 + 1] = s.overrideRGB[1];
    u.uColorRGB[i * 3 + 2] = s.overrideRGB[2];
    // envelope module gates custom attack/release; else the global default
    u.attack[i] = s.modules.release ? s.attack : rig.global.attack;
    u.release[i] = s.modules.release ? s.release : rig.global.release;
  });
  return u;
}

export const REGION_BAND = SENSOR_CHANNELS.map((c) => [c.bandY, c.bandHW] as [number, number]);
export const REGION_SIDE = SENSOR_CHANNELS.map((c) => sideCode(c.side));
