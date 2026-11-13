// ============================================================================
//  Presets — v2.
//
//  A preset is everything the operator would have to redo by hand at a new
//  venue: the rig (layers, motion, per-sensor modules), the scene, the input
//  routing, the mixer, and WHICH cloud sample loops on which sensor. v1
//  presets were the rig alone — an exported v1 loaded elsewhere looked
//  complete and played silence. v2 bundles the rest; v1 files and stored
//  entries are migrated on read, so nothing old is lost.
//
//  Every load goes through validation (rig.ts validatePreset, inputs.ts
//  validateRouting, mixerSnapshot.ts validateMixerSnapshot): a preset from an
//  older version, a hand-edited JSON or a malicious file can't leave the rig
//  with a NaN in it.
//
//  PORTABLE named presets live in ONE global store, so a preset saved on one
//  feather can be recalled on ANY other (the image doesn't change). Each
//  feather also auto-remembers its own last settings (saveLast / recallLast).
// ============================================================================

import { type FeatherPreset, snapshotPreset, loadIntoRig, rig, validatePreset } from './rig.ts';
import { validateRouting, type RoutingState } from './inputs.ts';
import { validateMixerSnapshot, type MixerSnapshot } from '../engine/mixerSnapshot.ts';
import type { SampleRef } from '../net/cloud.ts';

export const PRESET_VERSION = 2 as const;

export interface PresetBundle {
  v: typeof PRESET_VERSION;
  name: string;
  savedAt: number;
  preset: FeatherPreset;
  scene?: string;
  routing?: RoutingState;
  mixer?: MixerSnapshot;
  /** sensor id → library sample (null = no loop). Audio travels with the preset. */
  sensorSamples?: Record<string, SampleRef | null>;
  /** Tempo the bundled stems were authored at — loops play at rate 1 when the
   *  rig bpm equals this. Absent = the engine default (LOOP_NATIVE_BPM). */
  loopBpm?: number;
  /** false = switch the Drone layer (a held sine pad) off — for presets whose
   *  sound is entirely their stems. Absent = leave the drone as it is. */
  drone?: boolean;
}

/** What the caller knows and the rig doesn't — supplied on save. */
export type PresetContext = Pick<PresetBundle, 'scene' | 'routing' | 'mixer' | 'sensorSamples'>;

const GLOBAL_KEY = 'wb_presets'; // portable named presets (any feather)
const lastKey = (feather: string) => `wb_last_${feather}`;

type Store = Record<string, PresetBundle>;

// ---- built-in presets (ship with the site, read-only) ----------------------
//
// "Yawa": three stems of one song — drums/bass, guitar, vocal — on sensors
// 1–3, all three fed by the camera with the frame split into three strips.
// Move a feather on the left and the drums come in, in the middle the guitar,
// on the right the voice; sweep across and the whole song plays. The stems
// run continuously in sync and each sensor only opens its own fader, so the
// layers always land on the same beat however they are triggered.
// Samples live in /public/presets/yawa (sampleUrl serves '/…' paths locally).
const YAWA_BPM = 96;
const yawaStem = (id: string, label: string, size: number): SampleRef => ({
  id: `builtin:yawa-${id}`,
  name: `Yawa · ${label}`,
  path: `/presets/yawa/yawa-${id}.m4a`,
  size,
});
const BUILTIN: Record<string, () => Omit<PresetBundle, 'preset'>> = {
  'Yawa · 3 stems (camera)': () => ({
    v: PRESET_VERSION,
    name: 'Yawa · 3 stems (camera)',
    savedAt: 0,
    loopBpm: YAWA_BPM,
    drone: false, // only the song — no sine pad underneath it
    routing: validateRouting({
      sources: { slot_1: 'camera', slot_2: 'camera', slot_3: 'camera', slot_4: 'off', slot_5: 'off' },
      parts: { slot_1: ['sensor_01'], slot_2: ['sensor_02'], slot_3: ['sensor_03'], slot_4: [], slot_5: [] },
      camZones: true,
    }),
    sensorSamples: {
      sensor_01: yawaStem('bd', 'drums & bass', 2416117),
      sensor_02: yawaStem('gtr', 'guitar', 2413953),
      sensor_03: yawaStem('vox', 'vocal', 2401475),
      sensor_04: null,
      sensor_05: null,
    },
  }),
};
/** Names of the presets that ship with the site. */
export const BUILTIN_PRESETS = Object.keys(BUILTIN);
export function isBuiltinPreset(name: string): boolean {
  return name in BUILTIN;
}
/** A built-in adopts the CURRENT look (rig) and only sets its tempo — it is
 *  about sound + routing, not about how the feather is drawn. */
function builtinBundle(name: string): PresetBundle | null {
  const make = BUILTIN[name];
  if (!make) return null;
  const b = make();
  const preset = snapshotPreset(name);
  if (b.loopBpm) preset.global.bpm = b.loopBpm;
  return { ...b, preset: validatePreset(preset) };
}

function validateSamples(raw: unknown): Record<string, SampleRef | null> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, SampleRef | null> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === null) { out[k] = null; continue; }
    if (!v || typeof v !== 'object') continue;
    const r = v as Record<string, unknown>;
    if (typeof r.id === 'string' && typeof r.name === 'string' && typeof r.path === 'string') {
      out[k] = { id: r.id, name: r.name, path: r.path, ...(typeof r.size === 'number' ? { size: r.size } : {}) };
    }
  }
  return out;
}

/** Accept a v1 FeatherPreset or a v2 bundle (or junk) and return a v2 bundle. */
export function normalizePreset(raw: unknown, fallbackName = 'preset'): PresetBundle {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (r.v === PRESET_VERSION && r.preset && typeof r.preset === 'object') {
    const name = typeof r.name === 'string' && r.name ? r.name : fallbackName;
    const mixer = r.mixer ? validateMixerSnapshot(r.mixer) : null;
    return {
      v: PRESET_VERSION,
      name,
      savedAt: typeof r.savedAt === 'number' ? r.savedAt : 0,
      preset: validatePreset({ ...(r.preset as object), name }),
      ...(typeof r.scene === 'string' ? { scene: r.scene } : {}),
      ...(r.routing ? { routing: validateRouting(r.routing) } : {}),
      ...(mixer ? { mixer } : {}),
      ...(r.sensorSamples ? { sensorSamples: validateSamples(r.sensorSamples) } : {}),
      ...(typeof r.drone === 'boolean' ? { drone: r.drone } : {}),
      ...(typeof r.loopBpm === 'number' && Number.isFinite(r.loopBpm) && r.loopBpm >= 20 && r.loopBpm <= 400 ? { loopBpm: r.loopBpm } : {}),
    };
  }
  // v1: the bare rig
  const preset = validatePreset(r);
  const name = preset.name && preset.name !== 'preset' ? preset.name : fallbackName;
  return { v: PRESET_VERSION, name, savedAt: preset.updatedAt ?? 0, preset: { ...preset, name } };
}

function readGlobal(): Store {
  try {
    const raw = JSON.parse(localStorage.getItem(GLOBAL_KEY) || '{}') as Record<string, unknown>;
    const store: Store = {};
    for (const [name, v] of Object.entries(raw)) store[name] = normalizePreset(v, name);
    return store;
  } catch {
    return {};
  }
}
function writeGlobal(store: Store) {
  try {
    localStorage.setItem(GLOBAL_KEY, JSON.stringify(store));
  } catch {
    /* storage full / unavailable */
  }
}

export function listPresets(): string[] {
  const saved = Object.keys(readGlobal()).filter((n) => !isBuiltinPreset(n)).sort();
  return [...BUILTIN_PRESETS, ...saved];
}

export function presetExists(name: string): boolean {
  return isBuiltinPreset(name) || name in readGlobal();
}

export function getPreset(name: string): PresetBundle | null {
  return builtinBundle(name) ?? readGlobal()[name] ?? null;
}

/** Bundle the current rig + whatever context the caller supplies. */
export function bundleCurrent(name: string, ctx: PresetContext = {}): PresetBundle {
  return {
    v: PRESET_VERSION,
    name,
    savedAt: Date.now(),
    preset: snapshotPreset(name),
    ...(ctx.scene ? { scene: ctx.scene } : {}),
    ...(ctx.routing ? { routing: ctx.routing } : {}),
    ...(ctx.mixer ? { mixer: ctx.mixer } : {}),
    ...(ctx.sensorSamples && Object.keys(ctx.sensorSamples).length ? { sensorSamples: ctx.sensorSamples } : {}),
  };
}

/** Save the current rig (+ context) as a portable named preset. Overwrites —
 *  callers confirm first (presetExists). */
export function savePreset(name: string, ctx: PresetContext = {}): PresetBundle {
  if (isBuiltinPreset(name)) throw new Error(`"${name}" is a built-in preset — save under another name.`);
  const store = readGlobal();
  const b = bundleCurrent(name, ctx);
  store[name] = b;
  writeGlobal(store);
  return b;
}

/** Recall a portable preset onto the CURRENT feather (keeps the current
 *  image). Returns the bundle so the caller can apply scene / routing / mixer
 *  / samples — the rig part is applied here. */
export function recallPreset(name: string): PresetBundle | null {
  const b = getPreset(name);
  if (!b) return null;
  const cur = rig.feather;
  loadIntoRig(b.preset);
  rig.feather = cur; // keep the current feather binding, just adopt its settings
  return b;
}

export function deletePreset(name: string): void {
  if (isBuiltinPreset(name)) return;
  const store = readGlobal();
  delete store[name];
  writeGlobal(store);
}

// ---- per-feather 'last' (settings follow each feather automatically) --------
export function saveLast(feather: string): void {
  try {
    localStorage.setItem(lastKey(feather), JSON.stringify(snapshotPreset('last')));
  } catch {
    /* storage full / unavailable — fine, just don't persist */
  }
}
export function recallLast(feather: string): boolean {
  try {
    const raw = localStorage.getItem(lastKey(feather));
    if (!raw) return false;
    loadIntoRig(validatePreset(JSON.parse(raw), feather));
    rig.feather = feather;
    return true;
  } catch {
    return false;
  }
}

/** Download the current rig (+ context) as a .json file. */
export function exportPreset(name: string, ctx: PresetContext = {}): void {
  const bundle = bundleCurrent(name, ctx);
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `wingbeat-${(name || 'preset').replace(/\s+/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Read a .json preset (v1 or v2), apply its rig to the CURRENT feather, and
 *  store it by name. Returns the bundle so the caller can apply the rest. */
export async function importPreset(file: File): Promise<PresetBundle> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`"${file.name}" isn't valid JSON.`);
  }
  const fallback = file.name.replace(/\.json$/i, '') || 'imported';
  const b = normalizePreset(parsed, fallback);
  if (b.name === 'last') b.name = fallback;
  const cur = rig.feather;
  loadIntoRig(b.preset);
  rig.feather = cur; // apply to whatever feather is on screen now
  const store = readGlobal();
  store[b.name] = b;
  writeGlobal(store);
  return b;
}
