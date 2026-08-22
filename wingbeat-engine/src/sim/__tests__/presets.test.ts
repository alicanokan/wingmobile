import { beforeEach, describe, expect, it } from 'vitest';
import { validatePreset, defaultPreset, loadIntoRig, rig, snapshotPreset, DEFAULT_GLOBAL } from '../rig.ts';
import { normalizePreset, savePreset, recallPreset, listPresets, presetExists, deletePreset, PRESET_VERSION } from '../presets.ts';
import { validateRouting } from '../inputs.ts';
import { validateMixerSnapshot } from '../../engine/mixerSnapshot.ts';

beforeEach(() => localStorage.clear());

describe('validatePreset', () => {
  it('clamps numbers and fills defaults', () => {
    const p = validatePreset({ feather: '03f', autoK: 99, global: { bpm: 9999, sway: 'x', pulseColor: [2, -1, 0.5] }, sensors: { sensor_01: { reach: -5, layers: [0, 99, 'a'] } } });
    expect(p.feather).toBe('03f');
    expect(p.autoK).toBe(8);
    expect(p.global.bpm).toBe(220);
    expect(p.global.sway).toBe(DEFAULT_GLOBAL.sway);
    expect(p.global.pulseColor).toEqual([1, 0, 0.5]);
    expect(p.sensors.sensor_01.reach).toBe(0);
    expect(p.sensors.sensor_01.layers).toEqual([0]);
    expect(p.sensors.sensor_05.modules.movement).toBe(true); // missing sensor → defaults
  });
  it('never throws on junk', () => {
    expect(() => validatePreset(null)).not.toThrow();
    expect(() => validatePreset('nope')).not.toThrow();
    expect(validatePreset(42, 'fb').feather).toBe('fb');
  });
  it('is idempotent: validate(validate(x)) === validate(x)', () => {
    const once = validatePreset(defaultPreset('01f'));
    expect(validatePreset(once)).toEqual(once);
  });
});

describe('preset store v2', () => {
  it('migrates a v1 entry on read', () => {
    localStorage.setItem('wb_presets', JSON.stringify({ old: { ...defaultPreset('02f'), name: 'old', updatedAt: 5 } }));
    expect(listPresets()).toEqual(['old']);
    const b = recallPreset('old')!;
    expect(b.v).toBe(PRESET_VERSION);
    expect(b.savedAt).toBe(5);
    expect(b.preset.feather).toBe('02f');
  });
  it('round-trips rig + context and keeps the current feather on recall', () => {
    loadIntoRig({ ...defaultPreset('07f'), global: { ...DEFAULT_GLOBAL, bpm: 133 } });
    const b = savePreset('show', { scene: 'tui_aotearoa', routing: validateRouting({ keyAmount: 0.5 }), mixer: validateMixerSnapshot({ reverbWet: 0.9 })! });
    expect(b.scene).toBe('tui_aotearoa');
    loadIntoRig(defaultPreset('01f'));
    const back = recallPreset('show')!;
    expect(rig.global.bpm).toBe(133);
    expect(rig.feather).toBe('01f'); // binding kept
    expect(back.routing!.keyAmount).toBe(0.5);
    expect(back.mixer!.reverbWet).toBe(0.9);
    expect(presetExists('show')).toBe(true);
    deletePreset('show');
    expect(presetExists('show')).toBe(false);
  });
  it('snapshot → load → snapshot is identity (minus timestamps)', () => {
    loadIntoRig(defaultPreset('04f'));
    const a = snapshotPreset('x');
    loadIntoRig(a);
    const b = snapshotPreset('x');
    expect({ ...b, updatedAt: 0 }).toEqual({ ...a, updatedAt: 0 });
  });
  it('normalizes junk into a usable bundle', () => {
    const b = normalizePreset({ v: 2, name: '', preset: { global: 'nope' }, routing: 'nope', mixer: 7 }, 'fallback');
    expect(b.name).toBe('fallback');
    expect(b.preset.sensors.sensor_01).toBeTruthy();
    expect(b.mixer).toBeUndefined();
    expect(b.routing!.keyAmount).toBe(1);
  });
});

describe('validateRouting', () => {
  it('allowlists sources and parts, clamps numbers', () => {
    const r = validateRouting({ sources: { slot_1: 'dev2', slot_2: 'hack' }, parts: { slot_1: ['sensor_05', 'bogus'] }, keyAmount: 7, deviceThresholds: [0.5, 'x', 2] });
    expect(r.sources.slot_1).toBe('dev2');
    expect(r.sources.slot_2).toBe('key');
    expect(r.parts.slot_1).toEqual(['sensor_05']);
    expect(r.keyAmount).toBe(1);
    expect(r.deviceThresholds.slice(0, 3)).toEqual([0.5, 0, 1]);
  });
});
