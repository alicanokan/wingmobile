import { describe, expect, it } from 'vitest';
import { defaultInteractionZones, initialInteractionZoneState, mixRoutedInteractionZones, stepInteractionZone } from '../interactionZones.ts';

describe('interaction zones', () => {
  it('uses attack and release envelopes for gated zones', () => {
    const zone = { ...defaultInteractionZones()[2], attack: 200, release: 400 };
    const state = initialInteractionZoneState();
    const first = stepInteractionZone(zone, state, 1, 0, 0.02);
    const later = stepInteractionZone(zone, state, 1, 0.2, 0.18);
    const released = stepInteractionZone(zone, state, 0, 0.4, 0.2);
    expect(first.vane).toBeGreaterThan(0);
    expect(later.vane).toBeGreaterThan(first.vane);
    expect(released.vane).toBeLessThan(later.vane);
    expect(released.vane).toBeGreaterThan(0);
  });

  it('fires one-shot zones once per rising edge', () => {
    const zone = defaultInteractionZones()[0];
    const state = initialInteractionZoneState();
    stepInteractionZone(zone, state, 1, 0, 0.016);
    const firstEnvelope = state.impulse;
    stepInteractionZone(zone, state, 1, 0.1, 0.1);
    expect(state.impulse).toBeLessThan(firstEnvelope);
    stepInteractionZone(zone, state, 0, 0.2, 0.1);
    stepInteractionZone(zone, state, 1, 0.3, 0.1);
    expect(state.impulse).toBe(1);
  });

  it('mixes only routed zones at their matrix gain', () => {
    const zones = defaultInteractionZones().slice(0, 2);
    const modifiers = new Map([
      [zones[0].id, { brightness: 1.2, size: 1, movement: 1.2, depth: 1.1, shaft: 0.2, vane: 0.6, fringe: 0, travel: 0.8, travelPosition: 0.4, axisX: 0, axisY: 0, axisZ: -0.6, layerDepth: 0 }],
      [zones[1].id, { brightness: 1.2, size: 1, movement: 2, depth: 1.2, shaft: 0, vane: 0, fringe: 1, travel: 0, travelPosition: 0, axisX: 0.4, axisY: 0, axisZ: 0, layerDepth: 0 }],
    ]);
    const mixed = mixRoutedInteractionZones(zones, modifiers, { [zones[0].id]: 0.5 });
    expect(mixed.brightness).toBeCloseTo(1.1);
    expect(mixed.size).toBeCloseTo(1);
    expect(mixed.movement).toBeCloseTo(1.1);
    expect(mixed.travel).toBeCloseTo(0.4);
    expect(mixed.axisZ).toBeCloseTo(-0.3);
  });

  it('returns neutral output for disabled zones', () => {
    const zone = { ...defaultInteractionZones()[0], enabled: false };
    expect(stepInteractionZone(zone, initialInteractionZoneState(), 1, 0, 1 / 60)).toEqual({ brightness: 1, size: 1, movement: 1, depth: 1, shaft: 0, vane: 0, fringe: 0, travel: 0, travelPosition: 0, axisX: 0, axisY: 0, axisZ: 0, layerDepth: 0 });
  });

  it('raises routed layer depth to the authored minimum while triggered', () => {
    const zone = { ...defaultInteractionZones()[0], layerDepth: 1.2, attack: 5 };
    const state = initialInteractionZoneState();
    const idle = stepInteractionZone(zone, initialInteractionZoneState(), 0, 0, 0.05);
    const fired = stepInteractionZone(zone, state, 1, 0.1, 0.1);
    expect(idle.layerDepth).toBe(0);
    expect(fired.layerDepth).toBeGreaterThan(0.4);
    const mixed = mixRoutedInteractionZones([zone], new Map([[zone.id, fired]]), { [zone.id]: 1 });
    expect(mixed.layerDepth).toBeCloseTo(fired.layerDepth);
  });

  it('keeps Y motion coupled to an X wave and defaults spatial presets to depth', () => {
    const depth = stepInteractionZone({ ...defaultInteractionZones()[0], axis: 'z' }, initialInteractionZoneState(), 1, 0.1, 0.1);
    const wave = stepInteractionZone({ ...defaultInteractionZones()[0], axis: 'xy' }, initialInteractionZoneState(), 1, 0.1, 0.1);
    expect(Math.abs(depth.axisZ)).toBeGreaterThan(0);
    expect(depth.axisY).toBe(0);
    expect(Math.abs(wave.axisX)).toBeGreaterThan(0);
    expect(wave.axisY).toBeGreaterThan(0);
    expect(wave.axisZ).toBe(0);
  });
});
