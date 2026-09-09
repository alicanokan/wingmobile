import { describe, it, expect } from 'vitest';
import { temporalWeight } from '../MotionBlurPass';

describe('temporal exposure', () => {
  it('starts clean and bypasses history when disabled', () => {
    expect(temporalWeight(.8, 1 / 60, true)).toBe(0);
    expect(temporalWeight(0, 1 / 60)).toBe(0);
  });
  it('decays equally over the same elapsed time at 30 and 60 fps', () => {
    expect(temporalWeight(.25, 1 / 60) ** 2).toBeCloseTo(temporalWeight(.25, 1 / 30), 8);
  });
  it('bounds history and tolerates invalid input', () => {
    expect(temporalWeight(1, 0)).toBeLessThanOrEqual(.9);
    expect(temporalWeight(NaN, 0)).toBe(0);
    expect(Number.isFinite(temporalWeight(1, NaN))).toBe(true);
  });
});
