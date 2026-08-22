import { describe, expect, it } from 'vitest';
import { ledService, ROUTER_LIVE_MS } from '../ledService.ts';
import { DEFAULT_FIXTURE } from '../types.ts';

describe('LED arbiter', () => {
  ledService.setFixtures([
    { id: 'n_router', ...DEFAULT_FIXTURE, source: 'elements' },
    { id: 'n_engine', ...DEFAULT_FIXTURE, source: 'engine' },
  ]);
  const wire = (src: 'router' | 'engine' | 'identify') => ({ mode: 'solid' as const, r: 1, g: 1, b: 1, intensity: 1, src });

  it('engine drives unknown nodes and idle router fixtures', () => {
    expect(ledService.engineMayDrive('n_unknown')).toBe(true);
    expect(ledService.engineMayDrive('n_router')).toBe(true);
  });
  it('yields to a live router stream', () => {
    ledService.noteWire('n_router', wire('router'));
    expect(ledService.engineMayDrive('n_router')).toBe(false);
  });
  it("keeps the floor on 'engine' fixtures regardless of wire traffic", () => {
    ledService.noteWire('n_engine', wire('router'));
    expect(ledService.engineMayDrive('n_engine')).toBe(true);
  });
  it('ignores its own engine packets', () => {
    ledService.noteWire('n_unknown', wire('engine'));
    expect(ledService.engineMayDrive('n_unknown')).toBe(true);
  });
  it('liveness window outlasts the router heartbeat and then expires', () => {
    const t0 = performance.now();
    ledService.noteWire('n_router', wire('router'));
    expect(ROUTER_LIVE_MS).toBeGreaterThan(2000);
    expect(ledService.routerLive('n_router', t0 + ROUTER_LIVE_MS - 50)).toBe(true);
    expect(ledService.routerLive('n_router', t0 + ROUTER_LIVE_MS + 50)).toBe(false);
  });
  it('blackout silences the engine everywhere', () => {
    ledService.setConfig({ blackout: true });
    expect(ledService.engineMayDrive('n_unknown')).toBe(false);
    expect(ledService.engineMayDrive('n_engine')).toBe(false);
    ledService.setConfig({ blackout: false });
    expect(ledService.engineMayDrive('n_engine')).toBe(true);
  });
});
