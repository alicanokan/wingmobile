import { expect, it } from 'vitest';
import { resolveLife } from '../layerLife';
it('gives older scenes gentle continuous motion without requiring audio', () => {
  const value = resolveLife({}, {}, 'barbs');
  expect(value.mode).toBe(1);
  expect(value.amount).toBeGreaterThan(0);
  expect(value.speed).toBeGreaterThan(0);
});
it('inherits the master but allows an explicit Still mask', () => {
  const master = { lifeMode: 3, lifeSpeed: 1.2, lifeGlow: 0.5 };
  expect(resolveLife({ lifeMode: -1 }, master, 'mask').mode).toBe(3);
  expect(resolveLife({ lifeMode: 0, lifeGlow: 1 }, master, 'mask')).toMatchObject({ mode: 0, glow: 1 });
});
it('keeps independent settings and repeatable, different phases', () => {
  const a = resolveLife({ lifeMode: 4, lifeSpeed: 2 }, {}, 'mask-a');
  const b = resolveLife({ lifeMode: 5, lifeSpeed: 0.2 }, {}, 'mask-b');
  expect(a.speed).toBe(2); expect(b.speed).toBe(0.2);
  expect(a.phase).not.toBe(b.phase);
  expect(resolveLife({ lifeMode: 4, lifeSpeed: 2 }, {}, 'mask-a')).toEqual(a);
});
it('bounds malformed saved settings before sending them to the GPU', () => {
  const value = resolveLife({ lifeMode: 99, lifeAmount: Infinity, lifeSpeed: -10, lifeHue: 8 }, {}, 'mask');
  expect(value).toMatchObject({ mode: 6, amount: 0.12, speed: 0, hue: 1 });
});
