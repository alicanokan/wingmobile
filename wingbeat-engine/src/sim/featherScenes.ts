// ============================================================================
//  Feather → scene mapping.
//
//  Each feather has its own scene (culture pack: palette tint, scale, default
//  tempo). By default feathers are seeded round-robin across the 6 cultures
//  (01f→Phoenix, 02f→Crane, …); the operator can override per feather in the
//  Scene panel, and the choice persists. Selecting a feather loads its scene.
// ============================================================================

import { FEATHERS } from './feathers.ts';
import { SCENE_KEYS } from '../engine/scenes.ts';

const STORE_KEY = 'wb.featherScenes.v1';
const IMAGES = FEATHERS.filter((f) => !f.procedural);

let overrides: Record<string, string> = (() => {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
  } catch {
    return {};
  }
})();

/** Round-robin culture seed for a feather (before any override). */
export function defaultSceneFor(featherId: string): string {
  if (featherId === 'procedural') return SCENE_KEYS[0];
  const j = IMAGES.findIndex((f) => f.id === featherId);
  return SCENE_KEYS[(j < 0 ? 0 : j) % SCENE_KEYS.length];
}

/** The scene a feather currently uses (override if set, else the seed). */
export function sceneForFeather(featherId: string): string {
  return overrides[featherId] ?? defaultSceneFor(featherId);
}

export function setFeatherScene(featherId: string, sceneKey: string): void {
  overrides = { ...overrides, [featherId]: sceneKey };
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(overrides));
  } catch {
    /* storage may be unavailable */
  }
}
