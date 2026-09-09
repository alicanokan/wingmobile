import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { LOOP_STYLES, LOOP_SECONDS, renderMusicLoop, channelGain } from '../musicLoops';

describe('five-channel loop library', () => {
  it('mutes and solos the same channel gain that the analyser receives', () => {
    expect(channelGain(.8, false, -1, 0)).toBe(.8);
    expect(channelGain(.8, true, -1, 0)).toBe(0);
    expect(channelGain(.8, false, 2, 0)).toBe(0);
    expect(channelGain(.8, false, 2, 2)).toBe(.8);
    expect(channelGain(.8, true, 2, 2)).toBe(0);
  });
  it('links all ten styles to distinct feathers', () => {
    expect(LOOP_STYLES).toHaveLength(10);
    expect(new Set(LOOP_STYLES.map(s => s.feather)).size).toBe(10);
  });
  it.each(LOOP_STYLES.map((style, i) => [style.name, i] as const))('%s has five finite, non-silent stems on a 16-second clock', (_, index) => {
    const stems = renderMusicLoop(index, 2000);
    expect(stems).toHaveLength(5);
    for (const stem of stems) {
      expect(stem.length).toBe(LOOP_SECONDS * 2000);
      let peak = 0, power = 0;
      for (const v of stem) { expect(Number.isFinite(v)).toBe(true); peak = Math.max(peak, Math.abs(v)); power += v * v; }
      expect(peak).toBeLessThanOrEqual(.651);
      expect(power / stem.length).toBeGreaterThan(.000001);
    }
  });
  it('ships fifty WAVs with matching frame counts and sample rates', () => {
    for (let style = 0; style < 10; style++) for (let stem = 0; stem < 5; stem++) {
      const wav = readFileSync(new URL(`../../../public/music-tests/${style}-${stem}.wav`, import.meta.url));
      expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
      expect(wav.readUInt32LE(24)).toBe(22050);
      expect(wav.readUInt32LE(40)).toBe(16 * 22050 * 2);
      expect(wav.length).toBe(44 + 16 * 22050 * 2);
    }
  });
});
