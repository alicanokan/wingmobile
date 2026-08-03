// ============================================================================
//  LedRouter — musical signal in, ESP-safe LED commands out.
//
//  This is the whole mapping decision in one pure, synchronous place. It holds
//  no sockets, touches no DOM and imports nothing from the UI, so the rules it
//  enforces can be tested in plain Node — which matters, because the rules
//  exist to protect hardware that is expensive to debug in a field.
//
//  Two of those rules do the real work:
//
//  RATE. The render loop runs at 60 fps. An ESP8266 running PubSubClient on a
//  bit-banged NeoPixel strip does not want 60 messages a second per node, and
//  the existing publish path uses QoS 1 — which needs a PUBACK round-trip, so
//  over-publishing does not merely waste packets, it BACKLOGS and turns into
//  visible lag. Every fixture therefore gets a minimum interval.
//
//  CHANGE. A held pad is the same colour frame after frame. Publishing it 15
//  times a second is pure noise on the air, so a command only goes out when it
//  differs meaningfully from the last one sent — with a slow heartbeat anyway,
//  so a node that rebooted gets re-synced and the operator can see it is alive.
// ============================================================================

import type { LedCommand, NodeId } from '../engine/types.ts';
import type { FeatherPart, LedEmission, LedFixture, LedInputs } from './types.ts';

/** Default publish ceiling per fixture. 15 Hz looks continuous and leaves the
 *  node's 62.5 fps local render loop plenty of room. */
export const DEFAULT_RATE_HZ = 15;
/** Re-send an unchanged fixture at least this often, so a rebooted node
 *  recovers and a silent one is distinguishable from a dead one. */
export const HEARTBEAT_MS = 2000;
/** Smallest colour step worth a packet — 1.5% of the 8-bit range. */
const RGB_EPS = 4;
const INTENSITY_EPS = 0.02;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const to255 = (v: number) => {
  const n = Math.round(clamp01(v) * 255);
  return n < 0 ? 0 : n > 255 ? 255 : n;
};

/**
 * HSV → RGB, all inputs 0..1. Used so a pitch class can become a hue directly:
 * the twelve notes land on twelve evenly spaced colours.
 */
export function hsv(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const hh = ((h % 1) + 1) % 1;
  const i = Math.floor(hh * 6);
  const f = hh * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r = 0, g = 0, b = 0;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    default: r = v; g = p; b = q; break;
  }
  return { r: to255(r), g: to255(g), b: to255(b) };
}

interface Sent {
  cmd: LedCommand;
  at: number;
}

export class LedRouter {
  private fixtures: LedFixture[] = [];
  private sent = new Map<NodeId, Sent>();
  private minIntervalMs: number;

  constructor(rateHz: number = DEFAULT_RATE_HZ) {
    this.minIntervalMs = 1000 / Math.max(0.5, Math.min(60, rateHz));
  }

  setRate(rateHz: number): void {
    this.minIntervalMs = 1000 / Math.max(0.5, Math.min(60, rateHz));
  }

  get rateHz(): number {
    return 1000 / this.minIntervalMs;
  }

  setFixtures(f: LedFixture[]): void {
    this.fixtures = f;
    // drop remembered state for fixtures that no longer exist, so a removed
    // and re-added node starts clean rather than inheriting a stale colour
    const live = new Set(f.map((x) => x.id));
    for (const id of [...this.sent.keys()]) if (!live.has(id)) this.sent.delete(id);
  }

  /** Forget what was sent, so the next tick re-publishes everything. */
  resync(): void {
    this.sent.clear();
  }

  /** The last command actually published for a fixture, for the UI. */
  lastSent(id: NodeId): LedCommand | null {
    return this.sent.get(id)?.cmd ?? null;
  }

  /** Resolve one fixture to a command, before any rate or change gating. */
  private resolve(fx: LedFixture, inp: LedInputs): LedCommand {
    const master = inp.master ?? 1;
    const off: LedCommand = { mode: 'off', r: 0, g: 0, b: 0, intensity: 0 };
    if (inp.blackout || fx.source === 'off') return off;

    let r = 0, g = 0, b = 0, level = 0;

    if (fx.source === 'elements') {
      // sum the routed elements, exactly as the visual matrix does
      let sum = 0;
      const els = inp.elements ?? {};
      for (const key in fx.gains) {
        const gain = fx.gains[key];
        const v = els[key];
        if (gain && v) sum += gain * v;
      }
      level = clamp01(sum);
      let hue = fx.hue;
      if (fx.hueFrom === 'pitch') {
        // leadNote is -1 when nothing is tracked; hold the fixed hue then
        // rather than snapping to red, which would read as a cue
        hue = inp.leadNote !== undefined && inp.leadNote >= 0 ? inp.leadNote : fx.hue;
      } else if (fx.hueFrom === 'scene' && inp.sceneLed) {
        const s = inp.sceneLed;
        r = s.r; g = s.g; b = s.b;
      }
      if (!(fx.hueFrom === 'scene' && inp.sceneLed)) {
        const c = hsv(hue, 0.85, 1);
        r = c.r; g = c.g; b = c.b;
      }
    } else if (fx.source === 'sensor') {
      const s = inp.sensors?.[fx.id];
      if (!s) return off;
      // wind carries the brightness, motion adds a lift, presence sets a floor
      level = clamp01(s.wind * 0.8 + Math.min(1, s.motion) * 0.35 + (s.present ? 0.12 : 0));
      const c = hsv(s.hue, 0.8, 1);
      r = c.r; g = c.g; b = c.b;
    } else if (fx.source === 'mirror') {
      const p = inp.parts?.[fx.part as FeatherPart];
      if (!p) return off;
      r = to255(p.r); g = to255(p.g); b = to255(p.b);
      level = clamp01(p.level);
    }

    const intensity = clamp01(level * fx.gain * master);
    if (intensity <= 0.002) return off;

    // `solid` is the only mode the engine genuinely drives — the others
    // self-animate from the node's own clock and cannot be beat-synced.
    return { mode: 'solid', r: to255(r / 255), g: to255(g / 255), b: to255(b / 255), intensity };
  }

  /** True when two commands differ enough to be worth a packet. */
  private changed(a: LedCommand, b: LedCommand): boolean {
    if (a.mode !== b.mode) return true;
    if (Math.abs(a.intensity - b.intensity) >= INTENSITY_EPS) return true;
    return (
      Math.abs(a.r - b.r) >= RGB_EPS ||
      Math.abs(a.g - b.g) >= RGB_EPS ||
      Math.abs(a.b - b.b) >= RGB_EPS
    );
  }

  /**
   * Called every frame. Returns only the fixtures that should actually be
   * published right now — usually none, occasionally a few.
   */
  tick(now: number, inp: LedInputs): LedEmission[] {
    const out: LedEmission[] = [];
    for (const fx of this.fixtures) {
      const prev = this.sent.get(fx.id);
      if (prev && now - prev.at < this.minIntervalMs) continue; // rate gate

      const cmd = this.resolve(fx, inp);
      if (!prev) {
        this.sent.set(fx.id, { cmd, at: now });
        out.push({ id: fx.id, cmd, reason: 'changed' });
        continue;
      }
      const isChanged = this.changed(prev.cmd, cmd);
      const stale = now - prev.at >= HEARTBEAT_MS;
      if (!isChanged && !stale) continue;
      this.sent.set(fx.id, { cmd, at: now });
      out.push({ id: fx.id, cmd, reason: isChanged ? 'changed' : 'heartbeat' });
    }
    return out;
  }
}
