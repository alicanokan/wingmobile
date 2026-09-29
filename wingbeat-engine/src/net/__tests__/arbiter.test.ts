import { describe, expect, it } from 'vitest';
import { InputArbiter } from '../arbiter.ts';

describe('InputArbiter — motion', () => {
  it('plays the loudest hand, and one release does not silence another hold', () => {
    const a = new InputArbiter(5);
    a.feed('phoneA', [0], 0.7, 0);
    a.feed('phoneB', [0], 0.4, 10);
    expect(a.level(0, 20)).toBe(0.7);
    a.feed('phoneA', [0], 0, 30); // A lets go — B is still holding
    expect(a.level(0, 40)).toBe(0.4);
    a.feed('phoneB', [0], 0, 50);
    expect(a.level(0, 60)).toBe(0);
  });

  it('fans a group frame out to all its slots and keeps it apart from a part room', () => {
    const a = new InputArbiter(5);
    a.feed('group', [1, 3], 0.5, 0);
    a.feed('part', [1], 0.9, 0);
    expect([0, 1, 2, 3, 4].map((i) => a.level(i, 1))).toEqual([0, 0.9, 0, 0.5, 0]);
    a.feed('group', [1, 3], 0, 2);
    expect(a.level(1, 3)).toBe(0.9);
    expect(a.level(3, 3)).toBe(0);
  });

  it('lets go of a phone that stops sending, and at once of one that disconnects', () => {
    const a = new InputArbiter(2, 1500);
    a.feed('pocketed', [0], 0.7, 0);
    a.feed('gone', [1], 0.7, 0);
    expect(a.level(0, 1500)).toBe(0.7);
    expect(a.level(0, 1501)).toBe(0);
    a.drop('gone');
    expect(a.level(1, 1)).toBe(0);
  });

  it('clamps junk and ignores slots that do not exist', () => {
    const a = new InputArbiter(2);
    a.feed('x', [0, 7, -1], 3, 0);
    a.feed('y', [1], NaN, 0);
    expect(a.level(0, 1)).toBe(1);
    expect(a.level(1, 1)).toBe(0);
    expect(a.level(7, 1)).toBe(0);
    expect(a.hands(0, 1)).toBe(1);
  });
});

describe('InputArbiter — fx', () => {
  it('follows the most recently moved held pad and only goes dry when nobody holds', () => {
    const a = new InputArbiter(1);
    expect(a.feedFx('A', -1, 1, true, 0)).toEqual({ x: -1, y: 1, on: true });
    expect(a.feedFx('B', 1, -1, true, 10)).toEqual({ x: 1, y: -1, on: true });
    // A releases: B's hold must survive it
    expect(a.feedFx('A', 0, 0, false, 20)).toEqual({ x: 1, y: -1, on: true });
    expect(a.feedFx('B', 0, 0, false, 30)).toEqual({ x: 0, y: 0, on: false });
    expect(a.fxHeld()).toBe(false);
  });

  it('releases a pad whose phone vanished mid-hold', () => {
    const a = new InputArbiter(1, 1500);
    a.feedFx('A', 0.5, 0.5, true, 0);
    expect(a.fxState(1000).on).toBe(true);
    expect(a.fxState(1600).on).toBe(false);
    a.feedFx('B', 0.2, 0.2, true, 2000);
    a.drop('B');
    expect(a.fxState(2001).on).toBe(false);
  });
});
