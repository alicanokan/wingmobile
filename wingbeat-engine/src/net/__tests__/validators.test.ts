import { describe, expect, it } from 'vitest';
import { controlAllowed, parseControl, parseHostMsg } from '../link.ts';
import { parseSyncMsg } from '../../sim/sync.ts';

describe('parseControl (phone → console)', () => {
  it('accepts well-formed frames and clamps values', () => {
    expect(parseControl({ t: 'motion', v: 1.7 })).toEqual({ t: 'motion', v: 1 });
    expect(parseControl({ t: 'bpm', v: 999.4 })).toEqual({ t: 'bpm', v: 220 });
    expect(parseControl({ t: 'scene', key: 'crane_ghana' })).toEqual({ t: 'scene', key: 'crane_ghana' });
    expect(parseControl({ t: 'fx', x: 2, y: -0.5, on: true })).toEqual({ t: 'fx', x: 1, y: -0.5, on: true });
    expect(parseControl({ t: 'fx', x: 0, y: 0, on: 'yes' })).toEqual({ t: 'fx', x: 0, y: 0, on: false });
  });
  it('drops NaN, unknown verbs and injection-shaped keys', () => {
    expect(parseControl({ t: 'bpm', v: NaN })).toBeNull();
    expect(parseControl({ t: 'motion', v: '0.5' })).toBeNull();
    expect(parseControl({ t: 'reboot' })).toBeNull();
    expect(parseControl({ t: 'scene', key: '<script>' })).toBeNull();
    expect(parseControl({ t: 'fx', x: NaN, y: 0, on: true })).toBeNull();
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

describe('parseHostMsg (console → phone)', () => {
  it('accepts a channel directory and normalizes entries', () => {
    const m = parseHostMsg({ t: 'channels', list: [
      { d: 'ABCD', c: 'WXYZ', label: 'Tip', peers: 0, kind: 'part' },
      { d: 'EFGH', c: 'QRST', label: 'Tip + Tail', peers: 1.7, kind: 'group' },
      { d: 'bad!', c: 'WXYZ', label: 'nope' },
      { d: 'IJKL', c: 'MNOP', peers: -3, kind: 'weird' },
    ] });
    expect(m).toEqual({ t: 'channels', list: [
      { d: 'ABCD', c: 'WXYZ', label: 'Tip', peers: 0, kind: 'part' },
      { d: 'EFGH', c: 'QRST', label: 'Tip + Tail', peers: 2, kind: 'group' },
      { d: 'IJKL', c: 'MNOP', label: 'IJKL-MNOP', peers: 0, kind: 'part' },
    ] });
  });
  it('rejects junk and unknown verbs', () => {
    expect(parseHostMsg({ t: 'reboot' })).toBeNull();
    // host state: clamped, and an unknown permission level fails OPEN to the
    // pre-permissions behaviour rather than locking a phone out
    expect(parseHostMsg({ t: 'state', bpm: 999, master: -2, scene: 'crane_ghana', perms: 'fx' })).toEqual({ t: 'state', bpm: 220, master: 0, scene: 'crane_ghana', perms: 'fx' });
    expect(parseHostMsg({ t: 'state', bpm: 'fast', scene: '<x>', perms: 'root' })).toEqual({ t: 'state', bpm: 120, master: 0.7, scene: '', perms: 'full' });
    expect(parseHostMsg({ t: 'channels', list: 'x' })).toBeNull();
    expect(parseHostMsg(null)).toBeNull();
  });
});

describe('controlAllowed (host-side phone permissions)', () => {
  it('always lets a phone play, gates fx and the global verbs', () => {
    for (const p of ['play', 'fx', 'full'] as const) {
      expect(controlAllowed(p, 'motion')).toBe(true);
      expect(controlAllowed(p, 'blow')).toBe(true);
      expect(controlAllowed(p, 'hello')).toBe(true);
    }
    expect(controlAllowed('play', 'fx')).toBe(false);
    expect(controlAllowed('fx', 'fx')).toBe(true);
    for (const t of ['scene', 'bpm', 'master'] as const) {
      expect(controlAllowed('play', t)).toBe(false);
      expect(controlAllowed('fx', t)).toBe(false);
      expect(controlAllowed('full', t)).toBe(true);
    }
  });
});
