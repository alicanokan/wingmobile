import { afterEach, describe, expect, it, vi } from 'vitest';
import { WingbeatEngine } from '../WingbeatEngine.ts';
import type { EngineEvent } from '../types.ts';

function collect(engine: WingbeatEngine, type: EngineEvent['type']): EngineEvent[] {
  const got: EngineEvent[] = [];
  engine.on(type, (e) => got.push(e));
  return got;
}

afterEach(() => vi.restoreAllMocks());

describe('WingbeatEngine triggers', () => {
  it('fires one melody per wind crest, honouring the cooldown', () => {
    let t = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => t);
    const e = new WingbeatEngine();
    const melodies = collect(e, 'melody');
    e.ingestWind('sensor_01', 0.9);
    e.ingestWind('sensor_01', 0.95); // same crest, inside cooldown
    expect(melodies.length).toBe(1);
    t += 900;
    e.ingestWind('sensor_01', 0.9);
    expect(melodies.length).toBe(2);
  });

  it('stays quiet below the threshold and when patterns are off', () => {
    const e = new WingbeatEngine();
    const melodies = collect(e, 'melody');
    e.ingestWind('sensor_01', 0.3);
    expect(melodies.length).toBe(0);
    e.setPatterns(false);
    e.ingestWind('sensor_01', 0.99);
    expect(melodies.length).toBe(0);
  });

  it('clamps wind through the sensitivity multiplier', () => {
    const e = new WingbeatEngine({ windSensitivity: 3 });
    e.ingestWind('sensor_02', 0.9);
    expect(e.getNode('sensor_02')!.wind).toBe(1);
  });

  it('broadcasts the loudest breath as the wind layer', () => {
    const e = new WingbeatEngine();
    const winds = collect(e, 'wind') as Extract<EngineEvent, { type: 'wind' }>[];
    e.ingestWind('sensor_01', 0.2);
    e.ingestWind('sensor_03', 0.7);
    e.ingestWind('sensor_01', 0.1);
    expect(winds.at(-1)!.maxWind).toBeCloseTo(0.7);
  });
});

describe('WingbeatEngine scene + staleness', () => {
  it('rejects unknown scene keys instead of storing them', () => {
    const e = new WingbeatEngine();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scenes = collect(e, 'scene');
    e.setScene('not_a_scene');
    expect(e.scene).toBe('phoenix_anatolia');
    expect(scenes.length).toBe(0);
    e.setScene('crane_ghana', 0);
    expect(e.scene).toBe('crane_ghana');
    expect((scenes[0] as Extract<EngineEvent, { type: 'scene' }>).fadeMs).toBe(0);
  });

  it('marks a silent node offline after 8 s', () => {
    let t = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => t);
    const e = new WingbeatEngine();
    e.ingestStatus('feather_01', { online: true, role: 'feather' });
    t = 7000;
    e.tickStaleness();
    expect(e.getNode('feather_01')!.online).toBe(true);
    t = 9000;
    e.tickStaleness();
    expect(e.getNode('feather_01')!.online).toBe(false);
  });

  it('isolates a failing listener from the others', () => {
    const e = new WingbeatEngine();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    e.on('node', () => { throw new Error('boom'); });
    const seen = collect(e, 'node');
    e.ingestPresence('sensor_01', true);
    expect(seen.length).toBe(1);
  });
});
