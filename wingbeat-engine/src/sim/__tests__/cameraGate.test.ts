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
