import { PART, type Anatomy } from './anatomy.ts';

/** Measurements of the recovered cloud, not species identification or AI confidence. */
export function describeAnatomy(anatomy: Anatomy) {
  const parts = [0, 0, 0, 0, 0];
  const palette = anatomy.palette.map(() => 0);
  const patterns = Array.from({ length: anatomy.zones.length }, () => 0);
  const profile = Array.from({ length: 32 }, () => ({ left: 0, right: 0 }));
  let left = 0, right = 0, flow = 0, vane = 0;
  for (let i = 0; i < anatomy.count; i++) {
    parts[anatomy.part[i]]++;
    const color = anatomy.cluster[i];
    if (color >= 0 && color < palette.length) palette[color]++;
    const pattern = anatomy.pattern[i];
    if (pattern >= 0 && pattern < patterns.length) patterns[pattern]++;
    const x = anatomy.pos[i * 2];
    const bin = Math.max(0, Math.min(31, Math.floor((anatomy.pos[i * 2 + 1] + 1) * 16)));
    profile[bin].left = Math.max(profile[bin].left, -x);
    profile[bin].right = Math.max(profile[bin].right, x);
    if (anatomy.part[i] !== PART.rachis && anatomy.part[i] !== PART.calamus) {
      if (x < 0) left++; else right++;
      flow += anatomy.surf[i * 4 + 2];
      vane++;
    }
  }
  return { parts, palette, patterns, profile, left: left / (vane || 1), right: right / (vane || 1), clarity: flow / (vane || 1) };
}
