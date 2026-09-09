import { beforeEach, describe, expect, it } from 'vitest';
import { deleteFeatherPreset, loadFeatherPresets, upsertFeatherPreset, validateFeatherPreset, type FeatherPreset } from '../presets.ts';

const sample = (over: Partial<FeatherPreset> = {}): FeatherPreset => ({
  id: 'preset-a', name: 'Evening', feather: '01f', source: '/feathers/01f.png', label: 'Feather 01', savedAt: 10,
  scene: { layers: { layers: [] }, behaviours: null, response: null, amplitudes: null, appearance: { size: 1 }, particleCount: 140000, sensitivity: 0.5, surfaceBlend: 0.3, flight: { scatter: 0, mode: 0, anchor: 0.9 }, view: { position: [0, 0, 1], target: [0, 0, 0] } },
  ...over,
});

describe('feather presets', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips through storage, newest first', () => {
    upsertFeatherPreset(sample());
    upsertFeatherPreset(sample({ id: 'preset-b', name: 'Morning', savedAt: 20 }));
    expect(loadFeatherPresets().map((p) => p.name)).toEqual(['Morning', 'Evening']);
    deleteFeatherPreset('preset-b');
    expect(loadFeatherPresets().map((p) => p.id)).toEqual(['preset-a']);
  });

  it('replaces a preset saved again under the same name for the same feather', () => {
    upsertFeatherPreset(sample());
    upsertFeatherPreset(sample({ id: 'preset-c', savedAt: 30, scene: { ...sample().scene, surfaceBlend: 0.9 } }));
    const list = loadFeatherPresets();
    expect(list).toHaveLength(1);
    expect(list[0].scene.surfaceBlend).toBe(0.9);
  });

  it('rejects junk and clamps numbers, dropping a broken camera', () => {
    expect(validateFeatherPreset(null)).toBeNull();
    expect(validateFeatherPreset({ id: 'x' })).toBeNull();
    const p = validateFeatherPreset({ id: 'x', name: 'n', scene: { particleCount: 9e9, sensitivity: -1, surfaceBlend: 2, flight: { mode: 7 }, view: { position: [1, 2], target: [0, 0, 0] } } });
    expect(p?.scene.particleCount).toBe(500000);
    expect(p?.scene.sensitivity).toBe(0);
    expect(p?.scene.surfaceBlend).toBe(1);
    expect(p?.scene.flight.mode).toBe(3);
    expect(p?.scene.view).toBeNull();
    expect(validateFeatherPreset(sample({ source: 'blob:abc' }))?.source).toBeNull();
  });
});
