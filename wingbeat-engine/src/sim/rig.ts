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
export type AudioBand = 'full' | 'low' | 'mid' | 'high';
export const AUDIO_BANDS: AudioBand[] = ['full', 'low', 'mid', 'high'];
export const AUDIO_BAND_LABELS: Record<AudioBand, string> = {
  full: 'Full', low: 'Bass', mid: 'Mid', high: 'Treble',
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
  reach: number;
  swirl: number;
  lift: number;
  maxDist: number;
  attack: number; // energy ramp-UP rate (envelope attack)
  release: number; // energy ramp-DOWN + pump deflate rate (envelope release)
  colorOverride: boolean;
  overrideRGB: [number, number, number];
  layers: number[]; // indices into the combined layer list
  loopSample?: string; // name of a loaded loop sample (synced, launched on activity)
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
  updatedAt?: number;
}

export const DEFAULT_GLOBAL: GlobalRig = { sway: 0.35, disperse: 0.4, audioReact: 0.8, size: 55, stability: 0.85, attack: 0.15, release: 0.08, amount: 1, bpm: 120, gravity: 0.45, hold: 0, pulseColor: [1, 0.85, 0.5], motion: 1, floatTime: 1.4, relief: 0.7, wingBeat: 0.6, audioColor: 0.7, autoAudio: false, idleFall: 5 };

// particle sampling width derived from the amount (capped to protect the GPU).
// Higher = the particles reconstruct the image at finer detail. The point size
// auto-scales down with width (see uDensityScale) so density adds detail, not mush.
export const PART_W_MIN = 150;
export const PART_W_MAX = 1400;
export const PART_W_REF = 205; // reference width at which point size == the slider value

// Device-based particle budget. Phones / touch / low-core machines get FEWER
// and SMALLER particles so the cloud stays smooth. This is a RENDER cap only —
// it never rewrites the saved `amount`/`size` parameters, so switching to a
// stronger device (or saving/recalling a preset) shows the full-quality values.
export const IS_LOW_POWER =
  typeof navigator !== 'undefined' &&
  ((typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(max-width: 820px)').matches) ||
    (navigator.maxTouchPoints ?? 0) > 1 ||
    (navigator.hardwareConcurrency ?? 8) <= 4);
/** Ceiling applied to `amount` on this device (0.5 on phones/low-power, 1 otherwise). */
export const DEVICE_AMOUNT_CAP = IS_LOW_POWER ? 0.5 : 1;
/** Multiplier applied to point size on this device. */
export const DEVICE_SIZE_SCALE = IS_LOW_POWER ? 0.72 : 1;

export function particleSampleW(): number {
  const amount = Math.min(Math.max(0, Math.min(1, rig.global.amount)), DEVICE_AMOUNT_CAP);
  return Math.round(PART_W_MIN + amount * (PART_W_MAX - PART_W_MIN));
}

export function defaultSensorRig(sensorId: string): SensorRig {
  const idx = SENSOR_CHANNELS.findIndex((c) => c.sensor === sensorId);
  return {
    modules: { movement: true, monitor: true, release: false, color: false },
    motionType: 'swirl',
    audioBand: 'full',
    reach: 0.5,
    swirl: 0.6,
    lift: 0.6,
    maxDist: 1.1,
    attack: 0.15,
    release: 0.08,
    colorOverride: false,
    overrideRGB: [1, 0.8, 0.3],
    layers: idx >= 0 ? [idx % 4] : [], // a sensible unique-ish default routing
  };
}

export function defaultPreset(feather: string): FeatherPreset {
  const sensors: Record<string, SensorRig> = {};
  for (const c of SENSOR_CHANNELS) sensors[c.sensor] = defaultSensorRig(c.sensor);
  return { name: 'default', feather, autoK: 4, customLayers: [], layerSounds: [], layerGen: [], layerRel: [], autoColors: [], global: { ...DEFAULT_GLOBAL }, sensors };
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

export function loadIntoRig(preset: FeatherPreset) {
  rig.name = preset.name;
  rig.feather = preset.feather;
  rig.autoK = preset.autoK ?? 4;
  rig.customLayers = preset.customLayers ? JSON.parse(JSON.stringify(preset.customLayers)) : [];
  rig.layerSounds = preset.layerSounds ? JSON.parse(JSON.stringify(preset.layerSounds)) : [];
  rig.layerGen = preset.layerGen ? [...preset.layerGen] : [];
  rig.layerRel = preset.layerRel ? [...preset.layerRel] : [];
  rig.autoColors = preset.autoColors ? preset.autoColors.map((c) => (c ? [c[0], c[1], c[2]] : null)) : [];
  rig.global = { ...DEFAULT_GLOBAL, ...preset.global };
  rig.sensors = {};
  for (const c of SENSOR_CHANNELS) rig.sensors[c.sensor] = { ...defaultSensorRig(c.sensor), ...preset.sensors?.[c.sensor] };
  rig.updatedAt = preset.updatedAt;
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
