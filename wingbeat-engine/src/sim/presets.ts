// ============================================================================
//  Presets.
//
//  PORTABLE named presets ("color profiles") — saved in ONE global store, so a
//  preset saved on one feather can be recalled on ANY other feather. Recalling
//  applies the settings to the CURRENT feather (the image doesn't change).
//
//  Per-feather 'last' — each feather also auto-remembers its own last settings
//  (saveLast / recallLast), so switching feathers keeps each one's look.
//
//  Plus JSON export / import for sharing presets between machines.
// ============================================================================

import { type FeatherPreset, snapshotPreset, loadIntoRig, rig } from './rig.ts';

const GLOBAL_KEY = 'wb_presets'; // portable named presets (any feather)
const lastKey = (feather: string) => `wb_last_${feather}`;

type Store = Record<string, FeatherPreset>;

function readGlobal(): Store {
  try {
    return JSON.parse(localStorage.getItem(GLOBAL_KEY) || '{}');
  } catch {
    return {};
  }
}
function writeGlobal(store: Store) {
  localStorage.setItem(GLOBAL_KEY, JSON.stringify(store));
}

export function listPresets(): string[] {
  return Object.keys(readGlobal()).sort();
}

/** Save the current rig as a portable named preset (recall on ANY feather). */
export function savePreset(name: string): void {
  const store = readGlobal();
  store[name] = snapshotPreset(name);
  writeGlobal(store);
}

/** Recall a portable preset onto the CURRENT feather (keeps the current image). */
export function recallPreset(name: string): boolean {
  const p = readGlobal()[name];
  if (!p) return false;
  const cur = rig.feather;
  loadIntoRig(p);
  rig.feather = cur; // keep the current feather binding, just adopt its settings
  return true;
}

export function deletePreset(name: string): void {
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
    loadIntoRig(JSON.parse(raw) as FeatherPreset);
    rig.feather = feather;
    return true;
  } catch {
    return false;
  }
}

/** Download the current rig as a .json file. */
export function exportPreset(name: string): void {
  const preset = snapshotPreset(name);
  const blob = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `wingbeat-${(name || 'preset').replace(/\s+/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Read a .json preset, apply it to the CURRENT feather, and store it by name. */
export async function importPreset(file: File): Promise<FeatherPreset> {
  const text = await file.text();
  const preset = JSON.parse(text) as FeatherPreset;
  const cur = rig.feather;
  loadIntoRig(preset);
  rig.feather = cur; // apply to whatever feather is on screen now
  const name = preset.name && preset.name !== 'last' ? preset.name : file.name.replace(/\.json$/i, '') || 'imported';
  savePreset(name);
  return preset;
}
