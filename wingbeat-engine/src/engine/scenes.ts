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

export const SCENES: Record<string, Scene> = {
  phoenix_anatolia: {
    key: 'phoenix_anatolia',
    label: 'Phoenix · Anatolia',
    origin: 'Anatolia / resurrection',
    led: { r: 200, g: 120, b: 60 },
    bedNotes: ['A2', 'E3', 'C4', 'G3'],
    melodyScale: ['A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G4', 'A4'], // A natural minor
    melodyTempo: '6n',
    percRate: '4n',
    bpm: 92,
  },
  crane_ghana: {
    key: 'crane_ghana',
    label: 'Crowned Crane · Ghana',
    origin: 'West Africa / longevity',
    led: { r: 60, g: 200, b: 130 },
    bedNotes: ['D2', 'A2', 'D3', 'F3'],
    melodyScale: ['D3', 'F3', 'G3', 'A3', 'C4', 'D4', 'F4', 'G4'], // D minor pentatonic-ish
    melodyTempo: '8n',
    percRate: '8n',
    bpm: 104,
  },
  peacock_india: {
    key: 'peacock_india',
    label: 'Peacock · India',
    origin: 'South Asia / Garuda, grace',
    led: { r: 80, g: 180, b: 240 },
    bedNotes: ['D2', 'D3', 'F3', 'A3'],
    melodyScale: ['D3', 'Eb3', 'F3', 'G3', 'A3', 'Bb3', 'C4', 'D4'], // raga-ish
    melodyTempo: '6n',
    percRate: '4n',
    bpm: 84,
  },
  condor_andes: {
    key: 'condor_andes',
    label: 'Condor · Andes',
    origin: 'South America / Quetzal, freedom',
    led: { r: 240, g: 200, b: 120 },
    bedNotes: ['G2', 'D3', 'G3', 'B3'],
    melodyScale: ['G3', 'A3', 'B3', 'D4', 'E4', 'G4', 'A4', 'B4'], // G major pentatonic
    melodyTempo: '4n',
    percRate: '4n',
    bpm: 76,
  },
  eagle_plains: {
    key: 'eagle_plains',
    label: 'Eagle · Plains',
    origin: 'North America / strength, vision',
    led: { r: 220, g: 80, b: 80 },
    bedNotes: ['E2', 'B2', 'E3', 'G3'],
    melodyScale: ['E3', 'G3', 'A3', 'B3', 'D4', 'E4', 'G4', 'A4'], // E minor pentatonic
    melodyTempo: '4n',
    percRate: '2n',
    bpm: 120,
  },
  tui_aotearoa: {
    key: 'tui_aotearoa',
    label: 'Tui · Aotearoa',
    origin: 'Oceania / messenger of the gods',
    led: { r: 120, g: 100, b: 220 },
    bedNotes: ['C3', 'G3', 'C4', 'E4'],
    melodyScale: ['C4', 'D4', 'E4', 'G4', 'A4', 'C5', 'D5', 'E5'], // C major pentatonic, bright
    melodyTempo: '8n',
    percRate: '8n',
    bpm: 100,
  },
};

export const DEFAULT_SCENE = 'phoenix_anatolia';

export function getScene(key: string): Scene {
  return SCENES[key] ?? SCENES[DEFAULT_SCENE];
}

export const SCENE_KEYS = Object.keys(SCENES);
