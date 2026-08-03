// ============================================================================
//  The musical element vocabulary.
//
//  Lives here rather than inside Feather2.tsx because two very different places
//  need it: the feather's visual routing matrix, and the Light Engine panel in
//  the control module. Importing it from the feather page would drag three.js
//  and the whole anatomy engine into the operator bundle, and duplicating it
//  would let the two lists drift the first time anyone adds a row.
// ============================================================================

/** Row order is roughly rhythm → pitch → texture, which reads top to bottom. */
export const ELEMENTS = [
  { id: 'sub', label: 'Sub', hint: 'the floor you feel, 20–60 Hz' },
  { id: 'kick', label: 'Kick', hint: 'low-band transient' },
  { id: 'snare', label: 'Snare', hint: 'shell-band transient' },
  { id: 'hat', label: 'Hat', hint: 'top-band transient' },
  { id: 'perc', label: 'Perc', hint: 'everything percussive, drums or not' },
  { id: 'bass', label: 'Bass', hint: 'pitched low end, kick removed' },
  { id: 'lead', label: 'Lead', hint: 'the dominant melodic line' },
  { id: 'vocal', label: 'Vocal', hint: 'centre-extracted voice' },
  { id: 'pad', label: 'Pad', hint: 'sustained chordal bed' },
  { id: 'space', label: 'Space', hint: 'stereo sides: reverb, wideners' },
  { id: 'note', label: 'Note', hint: 'pulses when the lead changes note' },
  { id: 'vibrato', label: 'Vibrato', hint: 'how much the lead WOBBLES — the sung-line tell' },
  { id: 'bright', label: 'Bright', hint: 'spectral centroid: dark mix … brilliant one' },
] as const;

export type ElementId = (typeof ELEMENTS)[number]['id'];
