import { describe, expect, it } from 'vitest';
import { PLAY_EFFECTS, PLAY_PARTS, defaultPlayChannels, playPartMatches, validatePlayChannels } from '../play.ts';

describe('play channels', () => {
  it('ships five channels, one per installation trigger, each with a real movement', () => {
    const channels = defaultPlayChannels();
    expect(channels).toHaveLength(5);
    for (const channel of channels) {
      expect(PLAY_PARTS.some((p) => p.id === channel.part)).toBe(true);
      expect(PLAY_EFFECTS.some((e) => e.mode === channel.mode)).toBe(true);
      expect(channel.mode).toBeGreaterThan(0);
    }
  });

  it('coerces bad storage into valid channels and keeps the requested count', () => {
    const channels = validatePlayChannels([{ part: 'wing', mode: 4, strength: 9, speed: -1, attack: 'x', release: 0 }, null, 'nope'], 5);
    expect(channels).toHaveLength(5);
    expect(channels[0].part).toBe('barbs'); // fallback part
    expect(channels[0].mode).toBe(6); // 4 (orbit) is not a play movement → default
    expect(channels[0].strength).toBe(2);
    expect(channels[0].speed).toBe(0);
    expect(channels[0].attack).toBe(40);
    expect(channels[0].release).toBe(20);
    expect(validatePlayChannels(undefined)).toEqual(defaultPlayChannels());
  });

  it('addresses the same studio masks as the simple controls', () => {
    expect(playPartMatches('barbs', { kind: 'parts', index: 2 })).toBe(true);
    expect(playPartMatches('barbs', { kind: 'parts', index: 1 })).toBe(false);
    expect(playPartMatches('rachis', { kind: 'parts', index: 1 })).toBe(true);
    expect(playPartMatches('rachis', { kind: 'parts', index: 0 })).toBe(true);
    expect(playPartMatches('down', { kind: 'parts', index: 3 })).toBe(true);
    expect(playPartMatches('patterns', { kind: 'patterns', index: 7 })).toBe(true);
    expect(playPartMatches('colours', { kind: 'colors', index: 1 })).toBe(true);
    expect(playPartMatches('colours', { kind: 'colors', index: 2 })).toBe(false);
    expect(playPartMatches('extras', { kind: 'colors', index: 2 })).toBe(true);
    expect(playPartMatches('extras', { kind: 'parts', index: 4 })).toBe(true);
  });
});

describe('classic particles → living feather', () => {
  it('maps every classic motion shape to a real living movement', async () => {
    const { CLASSIC_TO_PLAY } = await import('../play.ts');
    const { MOTION_TYPES } = await import('../../sim/rig.ts');
    for (const type of MOTION_TYPES) {
      const match = CLASSIC_TO_PLAY[type];
      expect(match, type).toBeDefined();
      expect(PLAY_EFFECTS.some((e) => e.mode === match.mode && e.mode > 0), type).toBe(true);
    }
  });

  it('builds channels from the rig: shape → movement, reach → strength, holes → defaults', async () => {
    const { playChannelsFromClassic } = await import('../play.ts');
    const channels = playChannelsFromClassic([
      { motionType: 'wave', reach: 1 },
      { motionType: 'flutter', reach: 0 },
      undefined,
      { motionType: 'pulseZ', reach: 0.5 },
      { motionType: 'scatter', reach: 2 },
    ]);
    expect(channels).toHaveLength(5);
    expect(channels[0]).toMatchObject({ mode: 6, strength: 1.7 });
    expect(channels[1]).toMatchObject({ mode: 1, speed: 1.4, strength: 0.5 });
    expect(channels[2].mode).toBe(defaultPlayChannels()[2].mode);
    expect(channels[3]).toMatchObject({ mode: 5, strength: 1.1 });
    expect(channels[4]).toMatchObject({ mode: 2, strength: 1.7 }); // reach clamped to 1
    expect(channels.map((c) => c.part)).toEqual(defaultPlayChannels().map((c) => c.part));
  });
});
