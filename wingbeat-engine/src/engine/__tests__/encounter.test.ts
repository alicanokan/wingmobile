import { describe, expect, it } from 'vitest';
import { EncounterModel } from '../encounter.ts';
import { GestureTraceRecorder, replayGestureTrace } from '../replay.ts';
import type { CalibratedInputSample } from '../types.ts';

const wind = (value: number, timestamp: number): CalibratedInputSample => ({
  version: 1,
  source: 'simulation',
  nodeId: 'sensor_01',
  kind: 'wind',
  value,
  timestamp,
  valid: true,
  unit: 'normalized',
});

describe('EncounterModel', () => {
  it('stores a bounded gesture envelope and enters remembered encounter', () => {
    const model = new EncounterModel();
    model.ingest(wind(0.2, 1000));
    model.ingest(wind(0.8, 1150));
    const gestures = model.ingest(wind(0.02, 1500));
    const state = model.advanceTo(1800).state;

    expect(gestures).toHaveLength(1);
    expect(gestures[0]).toMatchObject({ onset: 1000, duration: 500, rise: 150, fall: 350, strength: 0.8 });
    expect(model.getHistory()).toHaveLength(1);
    expect(state.residue).toBeGreaterThan(0);
    expect(['settling', 'rememberedEncounter']).toContain(state.phase);
    expect(state.rootLoad).toBeLessThanOrEqual(0.32);
  });

  it('only anticipates a stable repeated interval and keeps it subtle', () => {
    const model = new EncounterModel();
    for (const onset of [1000, 2000, 3000]) {
      model.ingest(wind(0.7, onset));
      model.ingest(wind(0, onset + 120));
      model.advanceTo(onset + 120);
    }
    let state = model.advanceTo(3200).state;
    for (let timestamp = 3300; timestamp <= 3920; timestamp += 100) {
      state = model.advanceTo(timestamp).state;
    }
    expect(state.anticipation).toBeGreaterThan(0);
    expect(state.anticipation).toBeLessThanOrEqual(0.18);
  });

  it('recalls the spacing of a completed three-gesture sequence', () => {
    const model = new EncounterModel();
    for (const onset of [1000, 1600, 2600]) {
      model.ingest(wind(0.7, onset));
      model.ingest(wind(0, onset + 100));
      model.advanceTo(onset + 100);
    }
    const peaks: number[] = [];
    for (let timestamp = 2800; timestamp <= 6200; timestamp += 50) {
      const state = model.advanceTo(timestamp).state;
      if (state.recall > 0.15) peaks.push(timestamp);
    }
    expect(peaks.some((time) => Math.abs(time - 4500) <= 50)).toBe(true);
    expect(peaks.some((time) => Math.abs(time - 5100) <= 50)).toBe(true);
    expect(peaks.some((time) => Math.abs(time - 6100) <= 50)).toBe(true);
  });
});

describe('gesture trace replay', () => {
  it('replays calibrated features without retaining raw visitor audio', () => {
    const recorder = new GestureTraceRecorder();
    recorder.start(5000);
    recorder.record(wind(0.7, 5100));
    recorder.record(wind(0, 5400));
    const trace = recorder.export();
    const replayed: CalibratedInputSample[] = [];
    replayGestureTrace(trace, (sample) => replayed.push(sample));

    expect(trace.samples.map((sample) => sample.timestamp)).toEqual([100, 400]);
    expect(replayed.every((sample) => sample.source === 'replay')).toBe(true);
    expect(JSON.stringify(trace)).not.toContain('audio');
  });
});
