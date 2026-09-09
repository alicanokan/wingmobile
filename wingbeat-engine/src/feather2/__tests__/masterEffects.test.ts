import { describe, expect, it } from 'vitest';
import { initialMasterEffectState, stepMasterEffect, type MasterEffectConfig } from '../masterEffects.ts';

const config = (mode: MasterEffectConfig['mode'], preset: MasterEffectConfig['preset'] = 'pulse'): MasterEffectConfig => ({
  preset,
  trigger: 'kick',
  mode,
  amount: 1,
});

describe('master effect triggers', () => {
  it('toggles on separate rising edges without retriggering while held', () => {
    const state = initialMasterEffectState();
    const off = stepMasterEffect(config('toggle'), state, 0, 0, 1 / 60);
    const on = stepMasterEffect(config('toggle'), state, 1, 0.1, 1 / 60);
    const held = stepMasterEffect(config('toggle'), state, 1, 0.2, 1 / 60);
    stepMasterEffect(config('toggle'), state, 0, 0.3, 1 / 60);
    const offAgain = stepMasterEffect(config('toggle'), state, 1, 0.4, 1 / 60);
    expect(off.brightness).toBe(1);
    expect(on.brightness).toBeGreaterThan(1);
    expect(held.brightness).toBeGreaterThan(1);
    expect(offAgain.brightness).toBe(1);
  });

  it('follows a gate and releases immediately when the signal closes', () => {
    const state = initialMasterEffectState();
    expect(stepMasterEffect(config('gate', 'lift'), state, 0.8, 0, 1 / 60).depth).toBeGreaterThan(1);
    expect(stepMasterEffect(config('gate', 'lift'), state, 0, 0.1, 1 / 60).depth).toBe(1);
  });

  it('decays one-shot effects independently of frame rate', () => {
    const a = initialMasterEffectState();
    const b = initialMasterEffectState();
    stepMasterEffect(config('oneshot', 'lift'), a, 1, 0, 0);
    stepMasterEffect(config('oneshot', 'lift'), b, 1, 0, 0);
    stepMasterEffect(config('oneshot', 'lift'), a, 0, 1, 1);
    for (let i = 1; i <= 60; i++) stepMasterEffect(config('oneshot', 'lift'), b, 0, i / 60, 1 / 60);
    expect(a.envelope).toBeCloseTo(b.envelope, 5);
  });

  it('supports blackout without producing negative brightness', () => {
    const state = initialMasterEffectState();
    const result = stepMasterEffect({ ...config('gate', 'blackout'), amount: 2 }, state, 1, 0, 1 / 60);
    expect(result.brightness).toBe(0);
  });
});
