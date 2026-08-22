// ============================================================================
//  LED routing — types
//
//  These describe how a physical ESP node's strip gets its colour. They sit
//  deliberately BELOW the UI and BELOW the transport, so the mapping logic can
//  be exercised in plain Node with no browser, no broker and no hardware.
//
//  What the firmware can actually do bounds everything here. The wire contract
//  (wingbeat/node/<id>/cmd/led) is ONE colour + ONE intensity + ONE mode for
//  the whole 32-pixel strip — there is no per-pixel field, and four of the six
//  modes (pulse, shimmer, wind, rainbow) self-animate from the node's own
//  millis() and so cannot be beat-synced from here. That leaves `solid` as the
//  only mode the engine truly drives, which is why the router streams solid
//  colours rather than delegating animation to the node.
// ============================================================================

import type { LedCommand, NodeId } from '../engine/types.ts';

/** Where a fixture's colour and brightness come from. */
export type LedSourceKind =
  /** dark, but still heartbeat-published so a node is provably reachable */
  | 'off'
  /** the /feather2 musical elements, via per-element gains */
  | 'elements'
  /** the node's own wind/motion/presence, as the installation behaves today */
  | 'sensor'
  /** echo one anatomical part of the on-screen feather */
  | 'mirror'
  /** hand the node to the engine's event-driven modes (shimmer / wind /
   *  pulse on melody, presence and scene) — the router stays silent for it
   *  except under blackout */
  | 'engine';

/** Who put a packet on `cmd/led`. Carried in the payload as `src`; the
 *  firmware ignores keys it doesn't know, and every other client on the
 *  broker can now tell the two pipelines apart. */
export type LedSource = 'engine' | 'router' | 'identify';
export type LedWire = LedCommand & { src?: LedSource };

/**
 * The arbitration seam between the two LED pipelines. The engine's transport
 * asks before every event-driven publish; the router reports what it sees on
 * the wire so "a router stream is live for this node" is a fact, not a guess.
 */
export interface LedArbiter {
  /** May the engine's event-driven command go out for this node right now? */
  engineMayDrive(id: NodeId): boolean;
  /** A packet was observed on cmd/led (from any client, including ourselves). */
  noteWire(id: NodeId, cmd: LedWire): void;
  /** Fires when blackout / fixtures / config change. */
  onChange(cb: () => void): () => void;
  /** Global blackout — when true nobody publishes anything but `off`. */
  readonly blackout: boolean;
}

/** The anatomical parts a fixture can mirror. Matches PART in anatomy.ts. */
export type FeatherPart = 'calamus' | 'rachis' | 'vane' | 'down' | 'markings';

export type HueSource =
  /** follow the dominant pitch class — the feather changes colour on the note */
  | 'pitch'
  /** a colour the operator picked */
  | 'fixed'
  /** the current cultural scene's tint */
  | 'scene';

export interface LedFixture {
  /** MQTT node id — the <id> in wingbeat/node/<id>/cmd/led */
  id: NodeId;
  /** operator-facing name; falls back to the id */
  label?: string;
  source: LedSourceKind;
  /** `elements` mode: element id → 0..1 gain. Summed, then clamped. */
  gains: Record<string, number>;
  hueFrom: HueSource;
  /** 0..1, used when hueFrom === 'fixed' */
  hue: number;
  /** `mirror` mode: which part of the feather to echo */
  part: FeatherPart;
  /** per-fixture trim, 0..1 — the last thing applied before publish */
  gain: number;
}

export interface PartColor {
  r: number;
  g: number;
  b: number;
  /** 0..1 how active that part currently is */
  level: number;
}

export interface SensorSnapshot {
  wind: number;
  motion: number;
  present: boolean;
  /** 0..1 the node's default tint */
  hue: number;
}

/** Everything the router may read on a tick. All fields optional. */
export interface LedInputs {
  /** element id → 0..1, straight from the /feather2 matrix */
  elements?: Record<string, number>;
  /** 0..1 dominant pitch class, or -1 when nothing is tracked */
  leadNote?: number;
  /** engine-side node states, keyed by node id. Leave UNDEFINED when the
   *  producing page has no engine (e.g. /feather2): the router then skips
   *  sensor fixtures instead of publishing them black. */
  sensors?: Record<NodeId, SensorSnapshot>;
  /** current colour of each anatomical part of the on-screen feather */
  parts?: Partial<Record<FeatherPart, PartColor>>;
  /** the active scene tint, 0..255 each */
  sceneLed?: { r: number; g: number; b: number };
  /** global 0..1 trim the operator can pull down without retuning anything */
  master?: number;
  /** when true every fixture publishes black regardless of source */
  blackout?: boolean;
}

export interface LedEmission {
  id: NodeId;
  cmd: LedCommand;
  /** why this one went out — shown in the operator's output monitor */
  reason: 'changed' | 'heartbeat';
}

export const DEFAULT_FIXTURE: Omit<LedFixture, 'id'> = {
  source: 'elements',
  gains: { kick: 1, bass: 0.5 },
  hueFrom: 'pitch',
  hue: 0.75,
  part: 'vane',
  gain: 1,
};
