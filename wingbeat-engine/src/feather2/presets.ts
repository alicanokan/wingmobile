// ============================================================================
//  Feather presets — a named snapshot of everything the studio shapes about a
//  feather: which photograph, its masks and their resting life, interaction
//  zones, response, amplitudes, appearance, particle count, sensitivity, the
//  photo↔fibre blend, the flight field, and the camera (angle + zoom).
//
//  Saved on this device (localStorage). The studio writes them; /experience
//  lists them and hands one to the embedded renderer, so a look shaped in the
//  studio can be recalled on stage and played with the trigger channels.
// ============================================================================

export interface FeatherView {
  /** Camera position divided by the framing distance, so a saved zoom survives a different screen. */
  position: [number, number, number];
  target: [number, number, number];
}

export interface FeatherScene {
  layers: unknown;
  behaviours: unknown;
  response: unknown;
  amplitudes: unknown;
  appearance: unknown;
  particleCount: number;
  sensitivity: number;
  surfaceBlend: number;
  flight: { scatter: number; mode: number; anchor: number };
  view: FeatherView | null;
}

export interface FeatherPreset {
  id: string;
  name: string;
  /** FEATHERS id when the photograph is one of the library's; null for an imported file. */
  feather: string | null;
  /** Image URL the scene was shaped on (library path); null for a blob upload. */
  source: string | null;
  label: string;
  savedAt: number;
  scene: FeatherScene;
}

export const PRESETS_KEY = 'f2.presets.v1';

const num = (v: unknown, fallback: number, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
const triple = (v: unknown): [number, number, number] | null =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n)) ? [v[0], v[1], v[2]] : null;

export function validateFeatherPreset(raw: unknown): FeatherPreset | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const scene = p.scene && typeof p.scene === 'object' ? (p.scene as Record<string, unknown>) : null;
  if (typeof p.id !== 'string' || typeof p.name !== 'string' || !scene) return null;
  const flight = scene.flight && typeof scene.flight === 'object' ? (scene.flight as Record<string, unknown>) : {};
  const position = scene.view && typeof scene.view === 'object' ? triple((scene.view as Record<string, unknown>).position) : null;
  const target = scene.view && typeof scene.view === 'object' ? triple((scene.view as Record<string, unknown>).target) : null;
  return {
    id: p.id,
    name: p.name.slice(0, 60) || 'Untitled',
    feather: typeof p.feather === 'string' ? p.feather : null,
    source: typeof p.source === 'string' && !p.source.startsWith('blob:') ? p.source : null,
    label: typeof p.label === 'string' ? p.label : p.name,
    savedAt: num(p.savedAt, 0, 0, Number.MAX_SAFE_INTEGER),
    scene: {
      layers: scene.layers ?? null,
      behaviours: scene.behaviours ?? null,
      response: scene.response ?? null,
      amplitudes: scene.amplitudes ?? null,
      appearance: scene.appearance ?? null,
      particleCount: num(scene.particleCount, 140_000, 24_000, 500_000),
      sensitivity: num(scene.sensitivity, 0.5, 0, 1),
      surfaceBlend: num(scene.surfaceBlend, 0.32, 0, 1),
      flight: { scatter: num(flight.scatter, 0, 0, 2), mode: Math.round(num(flight.mode, 0, 0, 3)), anchor: num(flight.anchor, 0.9, 0, 1) },
      view: position && target ? { position, target } : null,
    },
  };
}

export function loadFeatherPresets(): FeatherPreset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.map(validateFeatherPreset).filter((p): p is FeatherPreset => !!p).sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

function persist(list: FeatherPreset[]): void {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable — the session keeps working, the preset just won't outlive it */
  }
}

/** Save or replace (same id, or same name on the same feather). Returns the new list. */
export function upsertFeatherPreset(preset: FeatherPreset): FeatherPreset[] {
  const list = loadFeatherPresets().filter((p) => p.id !== preset.id && !(p.name === preset.name && p.source === preset.source));
  list.unshift(preset);
  persist(list);
  return list;
}

export function deleteFeatherPreset(id: string): FeatherPreset[] {
  const list = loadFeatherPresets().filter((p) => p.id !== id);
  persist(list);
  return list;
}

export const newPresetId = () => `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** Fires when another tab (the studio, the experience) changes the list. */
export function onFeatherPresetsChange(cb: () => void): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key === null || e.key === PRESETS_KEY) cb();
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}
