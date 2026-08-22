import { describe, expect, it } from 'vitest';
import { LedRouter, hsv, HEARTBEAT_MS } from '../LedRouter.ts';
import { DEFAULT_FIXTURE } from '../types.ts';

const fixtures = () => [
  { id: 'feather_01', ...DEFAULT_FIXTURE, source: 'sensor' as const },
  { id: 'feather_02', ...DEFAULT_FIXTURE, source: 'elements' as const },
  { id: 'feather_03', ...DEFAULT_FIXTURE, source: 'engine' as const },
  { id: 'feather_04', ...DEFAULT_FIXTURE, source: 'off' as const },
  { id: 'feather_05', ...DEFAULT_FIXTURE, source: 'mirror' as const, part: 'vane' as const },
];
const ids = (o: { id: string }[]) => o.map((e) => e.id).sort();

describe('hsv', () => {
  it('returns 8-bit channels', () => {
    expect(hsv(0, 1, 1)).toEqual({ r: 255, g: 0, b: 0 });
    expect(hsv(1 / 3, 1, 1)).toEqual({ r: 0, g: 255, b: 0 });
    expect(hsv(0.5, 0, 0.5).r).toBe(128);
  });
});

describe('LedRouter ownership', () => {
  it('a console tick (sensors) only speaks for sensor + off fixtures', () => {
    const r = new LedRouter(15);
    r.setFixtures(fixtures());
    const out = r.tick(1000, { sensors: { feather_01: { wind: 0.9, motion: 0, present: true, hue: 0.3 } }, master: 1 });
    expect(ids(out)).toEqual(['feather_01', 'feather_04']);
    const lit = out.find((e) => e.id === 'feather_01')!.cmd;
    expect(lit.mode).toBe('solid');
    expect(lit.intensity).toBeGreaterThan(0.7);
    expect(out.find((e) => e.id === 'feather_04')!.cmd.mode).toBe('off');
  });

  it('a /feather2 tick (elements + parts) only speaks for elements + mirror fixtures', () => {
    const r = new LedRouter(15);
    r.setFixtures(fixtures());
    const out = r.tick(1000, { elements: { kick: 1 }, leadNote: 0.5, parts: { vane: { r: 1, g: 0.5, b: 0, level: 1 } }, master: 1 });
    // ('off' fixtures are heartbeated by whichever page ticks — both may)
    expect(ids(out)).toEqual(['feather_02', 'feather_04', 'feather_05']);
    expect(out.find((e) => e.id === 'feather_05')!.cmd).toMatchObject({ mode: 'solid', r: 255, g: 128, b: 0 });
  });

  it('never emits an engine-owned fixture, except under blackout', () => {
    const r = new LedRouter(15);
    r.setFixtures(fixtures());
    expect(r.tick(1000, { elements: {}, sensors: {}, parts: {} }).some((e) => e.id === 'feather_03')).toBe(false);
    // (past the heartbeat, so fixtures already sitting at `off` re-send too)
    const dark = r.tick(1000 + HEARTBEAT_MS + 1, { blackout: true });
    expect(ids(dark)).toEqual(['feather_01', 'feather_02', 'feather_03', 'feather_04', 'feather_05']);
    expect(dark.every((e) => e.cmd.mode === 'off')).toBe(true);
    // and after blackout the engine fixture is released again
    expect(r.tick(3000, { sensors: {} }).some((e) => e.id === 'feather_03')).toBe(false);
  });
});

describe('LedRouter gates', () => {
  it('rate-limits per fixture and re-sends on heartbeat', () => {
    const r = new LedRouter(10); // 100 ms
    r.setFixtures([{ id: 'a', ...DEFAULT_FIXTURE, source: 'off' }]);
    expect(r.tick(0, {}).length).toBe(1);
    expect(r.tick(50, {}).length).toBe(0); // inside the rate window
    expect(r.tick(150, {}).length).toBe(0); // unchanged, no heartbeat yet
    expect(r.tick(HEARTBEAT_MS + 1, {}).map((e) => e.reason)).toEqual(['heartbeat']);
  });

  it('only publishes a meaningful colour change', () => {
    const r = new LedRouter(60);
    r.setFixtures([{ id: 'a', ...DEFAULT_FIXTURE, source: 'sensor' }]);
    const s = (wind: number) => ({ sensors: { a: { wind, motion: 0, present: false, hue: 0.1 } } });
    expect(r.tick(0, s(0.5)).length).toBe(1);
    expect(r.tick(100, s(0.505)).length).toBe(0); // < 2% intensity step
    expect(r.tick(200, s(0.8)).length).toBe(1);
  });
});
