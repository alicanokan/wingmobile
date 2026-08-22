import { describe, expect, it } from 'vitest';
import { noteToMidi } from '../MidiOut.ts';

describe('noteToMidi', () => {
  it('maps scientific pitch names', () => {
    expect(noteToMidi('C4')).toBe(60);
    expect(noteToMidi('A4')).toBe(69);
    expect(noteToMidi('Eb3')).toBe(51);
    expect(noteToMidi('F#5')).toBe(78);
    expect(noteToMidi('C2')).toBe(36);
  });
  it('rejects junk', () => {
    expect(noteToMidi('H4')).toBeNull();
    expect(noteToMidi('C')).toBeNull();
    expect(noteToMidi('')).toBeNull();
  });
});
