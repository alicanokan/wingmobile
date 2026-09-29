// ============================================================================
//  Input arbiter — many phones, one feather.
//
//  A room accepts several phones, and a group room overlaps the part rooms, so
//  one slot can have several hands on it at once. Writing each frame straight
//  into a shared level made them fight: one phone's release (v = 0) silenced a
//  part another phone was still holding until its next frame, and one pad's
//  FX release cut the filter out from under everyone else.
//
//  The arbiter keeps every source's last word separately and merges on read:
//
//    · motion — the LOUDEST fresh source on a slot wins
//    · fx     — the most recently moved HELD pad wins; the bus only goes dry
//               when nobody is holding any more
//    · a source that stops sending goes stale (a pocketed phone must not hold
//      a note for ever); one that disconnects is dropped at once
//
//  Pure and clock-injected, so it is unit-tested without a browser.
// ============================================================================

export interface FxState { x: number; y: number; on: boolean }

/** Phone frames arrive every ~66 ms while held; this many ms of silence means
 *  the phone is gone (pocketed, out of range) rather than holding still. */
export const SOURCE_STALE_MS = 1500;

const DRY: FxState = { x: 0, y: 0, on: false };

export class InputArbiter {
  /** per slot: source → { level, at } */
  private readonly motion: Array<Map<string, { v: number; at: number }>>;
  private readonly fx = new Map<string, { x: number; y: number; at: number }>();

  constructor(slots: number, private readonly staleMs = SOURCE_STALE_MS) {
    this.motion = Array.from({ length: slots }, () => new Map());
  }

  /** One motion frame from `source`, fanned out to every slot it drives. */
  feed(source: string, slots: readonly number[], v: number, now: number): void {
    const level = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
    for (const i of slots) {
      const slot = this.motion[i];
      if (!slot) continue;
      // a release needs no bookkeeping — forget the source instead of storing 0
      if (level <= 0) slot.delete(source);
      else slot.set(source, { v: level, at: now });
    }
  }

  /** The level a slot should play right now: the loudest fresh source. */
  level(i: number, now: number): number {
    const slot = this.motion[i];
    if (!slot || slot.size === 0) return 0;
    let best = 0;
    for (const [source, m] of slot) {
      if (now - m.at > this.staleMs) slot.delete(source);
      else if (m.v > best) best = m.v;
    }
    return best;
  }

  /** How many fresh sources are on a slot (for "2 hands" style UI). */
  hands(i: number, now: number): number {
    const slot = this.motion[i];
    if (!slot) return 0;
    let n = 0;
    for (const m of slot.values()) if (now - m.at <= this.staleMs) n++;
    return n;
  }

  /** One FX-pad frame. Returns what the bus should be set to. */
  feedFx(source: string, x: number, y: number, on: boolean, now: number): FxState {
    if (on) this.fx.set(source, { x, y, at: now });
    else this.fx.delete(source);
    return this.fxState(now);
  }

  /** The winning FX pad: the most recently moved one still held. */
  fxState(now: number): FxState {
    let best: { x: number; y: number; at: number } | null = null;
    for (const [source, f] of this.fx) {
      if (now - f.at > this.staleMs) this.fx.delete(source);
      else if (!best || f.at >= best.at) best = f;
    }
    return best ? { x: best.x, y: best.y, on: true } : DRY;
  }

  /** True when any pad is (still) registered — the host polls fxState only then. */
  fxHeld(): boolean {
    return this.fx.size > 0;
  }

  /** A phone disconnected: let go of everything it was holding, now. */
  drop(source: string): void {
    for (const slot of this.motion) slot.delete(source);
    this.fx.delete(source);
  }

  /** FX was locked (or the page is letting go): forget every held pad. */
  clearFx(): void {
    this.fx.clear();
  }

  clear(): void {
    for (const slot of this.motion) slot.clear();
    this.fx.clear();
  }
}
