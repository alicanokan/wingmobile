import { describe, expect, it } from 'vitest';
import { EncounterModel } from '../../engine/encounter.ts';
import { encounterResponse } from '../encounterResponse.ts';

describe('living feather encounter response', () => {
  it('moves after input has ended, then returns to rest', () => {
    const model = new EncounterModel();
    model.ingest({ version: 1, nodeId: 's', source: 'touch', kind: 'wind', value: 0.9, timestamp: 0, valid: true, unit: 'normalized' });
    model.advanceTo(0);
    for (let t = 50; t <= 1000; t += 50) model.advanceTo(t);
    model.ingest({ version: 1, nodeId: 's', source: 'touch', kind: 'wind', value: 0, timestamp: 1000, valid: true, unit: 'normalized' });
    for (let t = 1050; t <= 4000; t += 50) model.advanceTo(t);
    const remembered = encounterResponse(model.snapshot(4000));
    expect(remembered.vane).toBeGreaterThan(0.01);
    expect(remembered.fringe).toBeGreaterThan(0.01);
    for (let t = 4050; t <= 180000; t += 50) model.advanceTo(t);
    expect(encounterResponse(model.snapshot(180000)).vane).toBeLessThan(0.001);
  });

  it('bounds combined loads and makes emergency rest still', () => {
    const model = new EncounterModel();
    const loud = encounterResponse({ ...model.snapshot(0), rootLoad: 99, vaneLoad: 99, fringeLoad: 99, residue: 99, recall: 99, anticipation: 99 });
    expect(loud.shaft).toBeLessThanOrEqual(0.32);
    expect(loud.vane).toBeLessThanOrEqual(1);
    expect(loud.fringe).toBeLessThanOrEqual(1);
    expect(encounterResponse(model.snapshot(0))).toEqual({ shaft: 0, vane: 0, fringe: 0, shimmer: 0, anticipation: 0 });
  });
});
