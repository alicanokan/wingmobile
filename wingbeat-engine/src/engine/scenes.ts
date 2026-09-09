// ============================================================================
//  Wing Beat — Cultural feather packs ("scenes")
//
//  Each scene is a named cultural sound + visual palette, drawn from the
//  feather/bird symbolism in the project brief. A scene defines:
//    • an LED tint (the feather's physical glow + the on-screen line tint)
//    • a held drone chord (the "bed")
//    • a scale the wind-crest melody draws from
//
//  Adding a culture = adding ~12 lines here. Nothing else in the engine,
//  the simulation, or the firmware needs to change.
// ============================================================================

import type { Scene } from './types.ts';

const studyAuthorship = (): Scene['authorship'] => ({
  status: 'study',
  contributors: [],
  provenance: 'Unattributed internal sound study',
  consentReference: '',
  permittedTransforms: ['gain', 'spatial', 'timing'],
});

export const SCENES: Record<string, Scene> = {
  phoenix_anatolia: {
    key: 'phoenix_anatolia',
    label: 'Remembered encounter · Ember',
    origin: 'Study — not culturally attributed',
    led: { r: 200, g: 120, b: 60 },
    bedNotes: ['A2', 'E3', 'C4', 'G3'],
    melodyScale: ['A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G4', 'A4'], // A natural minor
    melodyTempo: '6n',
    percRate: '4n',
    bpm: 92,
    authorship: studyAuthorship(),
  },
  crane_ghana: {
    key: 'crane_ghana',
    label: 'Remembered encounter · Reed',
    origin: 'Study — not culturally attributed',
    led: { r: 60, g: 200, b: 130 },
    bedNotes: ['D2', 'A2', 'D3', 'F3'],
    melodyScale: ['D3', 'F3', 'G3', 'A3', 'C4', 'D4', 'F4', 'G4'], // D minor pentatonic-ish
    melodyTempo: '8n',
    percRate: '8n',
    bpm: 104,
    authorship: studyAuthorship(),
  },
  peacock_india: {
    key: 'peacock_india',
    label: 'Remembered encounter · Blue',
    origin: 'Study — not culturally attributed',
    led: { r: 80, g: 180, b: 240 },
    bedNotes: ['D2', 'D3', 'F3', 'A3'],
    melodyScale: ['D3', 'Eb3', 'F3', 'G3', 'A3', 'Bb3', 'C4', 'D4'], // raga-ish
    melodyTempo: '6n',
    percRate: '4n',
    bpm: 84,
    authorship: studyAuthorship(),
  },
  condor_andes: {
    key: 'condor_andes',
    label: 'Remembered encounter · Air',
    origin: 'Study — not culturally attributed',
    led: { r: 240, g: 200, b: 120 },
    bedNotes: ['G2', 'D3', 'G3', 'B3'],
    melodyScale: ['G3', 'A3', 'B3', 'D4', 'E4', 'G4', 'A4', 'B4'], // G major pentatonic
    melodyTempo: '4n',
    percRate: '4n',
    bpm: 76,
    authorship: studyAuthorship(),
  },
  eagle_plains: {
    key: 'eagle_plains',
    label: 'Remembered encounter · Red',
    origin: 'Study — not culturally attributed',
    led: { r: 220, g: 80, b: 80 },
    bedNotes: ['E2', 'B2', 'E3', 'G3'],
    melodyScale: ['E3', 'G3', 'A3', 'B3', 'D4', 'E4', 'G4', 'A4'], // E minor pentatonic
    melodyTempo: '4n',
    percRate: '2n',
    bpm: 120,
    authorship: studyAuthorship(),
  },
  tui_aotearoa: {
    key: 'tui_aotearoa',
    label: 'Remembered encounter · Violet',
    origin: 'Study — not culturally attributed',
    led: { r: 120, g: 100, b: 220 },
    bedNotes: ['C3', 'G3', 'C4', 'E4'],
    melodyScale: ['C4', 'D4', 'E4', 'G4', 'A4', 'C5', 'D5', 'E5'], // C major pentatonic, bright
    melodyTempo: '8n',
    percRate: '8n',
    bpm: 100,
    authorship: studyAuthorship(),
  },
};

export const DEFAULT_SCENE = 'phoenix_anatolia';

export function getScene(key: string): Scene {
  return SCENES[key] ?? SCENES[DEFAULT_SCENE];
}

export function validateSceneAuthorship(scene: Scene): string[] {
  if (scene.authorship.status === 'study') return [];
  const errors: string[] = [];
  if (!scene.authorship.contributors.length) errors.push('Contributor-authored encounters require at least one named contributor.');
  if (!scene.authorship.provenance.trim()) errors.push('Provenance is required.');
  if (!scene.authorship.consentReference.trim()) errors.push('A consent reference is required.');
  if (!scene.authorship.permittedTransforms.length) errors.push('At least one permitted transformation must be explicit.');
  return errors;
}

export const SCENE_KEYS = Object.keys(SCENES);
