import { describe, expect, it } from 'vitest';
import { gateLevel } from '../camera.ts';

describe('gateLevel (camera noise gate)', () => {
  it('reads noise at or under the threshold as silence', () => {
    expect(gateLevel(0.05, 0.3)).toBe(0);
    expect(gateLevel(0.3, 0.3)).toBe(0);
  });
  it('rescales motion above the threshold to 0..1', () => {
    expect(gateLevel(0.65, 0.3)).toBeCloseTo(0.5);
    expect(gateLevel(1, 0.3)).toBe(1);
  });
  it('never returns junk', () => {
    expect(gateLevel(NaN, 0.3)).toBe(0);
    expect(gateLevel(0.5, NaN)).toBe(0.5);
    expect(gateLevel(1, 5)).toBe(1); // gate clamped below 1
  });
});

describe('CameraSource per-strip thresholds', () => {
  it('default to 30%, clamp, and survive a reload', async () => {
    localStorage.clear();
    const { CameraSource, ZONE_GATE_DEFAULT } = await import('../camera.ts');
    const a = new CameraSource();
    expect(a.zoneGate(1)).toBe(ZONE_GATE_DEFAULT);
    a.setZoneGate(1, 0.55);
    a.setZoneGate(2, 7); // clamped
    a.setZoneGate(99, 0.1); // ignored
    const b = new CameraSource();
    expect(b.zoneGate(1)).toBe(0.55);
    expect(b.zoneGate(2)).toBe(0.9);
    expect(b.zoneGate(0)).toBe(ZONE_GATE_DEFAULT);
  });
});
