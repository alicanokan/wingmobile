import type { ExpressiveState } from '../engine/types.ts';

const unit = (v: number) => Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;

/** Shared encounter consequences, added once before the anatomical clamps. */
export function encounterResponse(state: ExpressiveState) {
  const memory = unit(state.residue) * 0.18 + unit(state.recall) * 0.45;
  return {
    shaft: Math.min(0.32, unit(state.rootLoad) + memory * 0.12),
    vane: Math.min(1, unit(state.vaneLoad) * 0.65 + memory),
    fringe: Math.min(1, unit(state.fringeLoad) * 0.7 + memory * 0.65),
    shimmer: Math.min(0.25, memory * 0.3),
    anticipation: Math.min(0.18, unit(state.anticipation)),
  };
}
