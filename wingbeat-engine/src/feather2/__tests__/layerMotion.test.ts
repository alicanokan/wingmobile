import { expect, it } from 'vitest';
import { layerMotion } from '../layerMotion';
const neutral = { movement: 1, depth: 1, layerDepth: 0 };
it('preserves independent mask and master separation with a neutral route', () => {
  expect(layerMotion({ movement: 2, depth: 3 }, { movement: 1.5, depth: 2 }, neutral, 0, 0)).toEqual({ movement: 3, depth: 6 });
});
it('allows movement audio routing and a triggered depth floor for every mask kind', () => {
  expect(layerMotion(neutral, neutral, { ...neutral, layerDepth: 4 }, 2, 1)).toEqual({ movement: 3, depth: 4 });
});
it('keeps zero movement a bypass and bounds invalid saved values', () => {
  expect(layerMotion({ movement: 0, depth: 1 }, neutral, neutral, 3, 0).movement).toBe(0);
  expect(layerMotion({ movement: NaN, depth: Infinity }, neutral, neutral, 0, 0)).toEqual({ movement: 1, depth: 1 });
});
