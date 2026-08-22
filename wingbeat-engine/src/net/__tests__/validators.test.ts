import { describe, expect, it } from 'vitest';
import { parseControl } from '../link.ts';
import { parseSyncMsg } from '../../sim/sync.ts';

describe('parseControl (phone → console)', () => {
  it('accepts well-formed frames and clamps values', () => {
    expect(parseControl({ t: 'motion', v: 1.7 })).toEqual({ t: 'motion', v: 1 });
    expect(parseControl({ t: 'bpm', v: 999.4 })).toEqual({ t: 'bpm', v: 220 });
    expect(parseControl({ t: 'scene', key: 'crane_ghana' })).toEqual({ t: 'scene', key: 'crane_ghana' });
  });
  it('drops NaN, unknown verbs and injection-shaped keys', () => {
    expect(parseControl({ t: 'bpm', v: NaN })).toBeNull();
    expect(parseControl({ t: 'motion', v: '0.5' })).toBeNull();
    expect(parseControl({ t: 'reboot' })).toBeNull();
    expect(parseControl({ t: 'scene', key: '<script>' })).toBeNull();
    expect(parseControl('hello')).toBeNull();
  });
});

describe('parseSyncMsg (console → display)', () => {
  it('validates state frames', () => {
    const m = parseSyncMsg({ kind: 'state', state: { nodes: [{ i: 'sensor_01', w: 2, p: 1 }, { w: 1 }], scene: 'x', feather: '01f', palette: [[1, 0, 0], [1]], audio: { level: 3, loops: { sensor_01: [0.5, 2, -1, 0.1], bad: [1] } } } });
    expect(m?.kind).toBe('state');
    if (m?.kind !== 'state') return;
    expect(m.state.nodes).toEqual([{ i: 'sensor_01', w: 1, p: false }]);
    expect(m.state.palette).toEqual([[1, 0, 0]]);
    expect(m.state.audio).toEqual({ level: 1, loops: { sensor_01: [0.5, 1, 0, 0.1] } });
  });
  it('rejects future versions and junk', () => {
    expect(parseSyncMsg({ kind: 'state', v: 99, state: {} })).toBeNull();
    expect(parseSyncMsg({ kind: 'rig' })).toBeNull();
    expect(parseSyncMsg(null)).toBeNull();
  });
});
