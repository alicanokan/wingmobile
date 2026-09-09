import { describe, it, expect } from 'vitest';
import { followEnvelope, demoSignal, RESPONSE_PRESETS } from '../response.ts';

describe('musical response envelopes', () => {
  it('responds equally after a second at 30, 60 and 120 fps', () => {
    const step = (fps: number, start: number, target: number) => {
      let level = start;
      for (let frame = 0; frame < fps; frame++) level = followEnvelope(level, target, 1 / fps, 180, 900);
      return level;
    };
    for (const fps of [30, 120]) {
      expect(step(fps, 0, 1)).toBeCloseTo(step(60, 0, 1), 10);
      expect(step(fps, 1, 0)).toBeCloseTo(step(60, 1, 0), 10);
    }
  });
  it('gives a percussive hit a sharper attack and shorter tail', () => {
    const sharp = RESPONSE_PRESETS.percussive, soft = RESPONSE_PRESETS.weightless;
    expect(followEnvelope(0, 1, .05, sharp.attack, sharp.release)).toBeGreaterThan(.99);
    expect(followEnvelope(0, 1, .05, soft.attack, soft.release)).toBeLessThan(.3);
    expect(followEnvelope(1, 0, .3, sharp.attack, sharp.release)).toBeLessThan(.11);
    expect(followEnvelope(1, 0, .3, soft.attack, soft.release)).toBeGreaterThan(.7);
  });
  it('does not overshoot and recovers from invalid input', () => {
    expect(followEnvelope(.5, 1, 100, 5, 50)).toBe(1);
    expect(followEnvelope(NaN, Infinity, .1, 20, 100)).toBe(0);
    expect(followEnvelope(.5, 1, -1, 20, 100)).toBe(.5);
  });
  it('settles back to rest after a transient', () => {
    let value = 1;
    for (let i = 0; i < 180; i++) value = followEnvelope(value, 0, 1 / 60, 35, 320);
    expect(value).toBeLessThan(.0001);
  });
});

describe('silent demo signal', () => {
  it('delivers distinct beats on a 108 bpm clock', () => {
    const beat = 60000 / 108;
    expect(demoSignal(0).kick).toBe(1);
    expect(demoSignal(beat * .5).kick).toBeLessThan(.01);
    expect(demoSignal(beat).snare).toBe(1);
    expect(demoSignal(beat * 2).snare).toBe(0);
    expect(demoSignal(0).sourceLabel).toBe('Demo signal');
  });
  it('keeps every generated level finite and bounded across long sessions', () => {
    for (let time = 0; time < 3_600_000; time += 1371) {
      for (const [key, value] of Object.entries(demoSignal(time))) {
        if (typeof value !== 'number' || key === 'bpm') continue;
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(key === 'hue' ? Math.PI * 2 : 1);
      }
    }
  });
});
