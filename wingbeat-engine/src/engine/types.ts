// ============================================================================
//  Wing Beat — Engine domain types
//
//  These types are the contract between the three layers of the system:
//
//    transport  →  engine  →  consumers (UI / hardware / audio)
//
//  A "node" is any addressable sensing point in the installation. In the
//  simulation it is one of the 8 ring sensors or the feather; in the real
//  install it is one ESP8266 (`feather_01`, `sensor_03`, `plant_01`, …).
//  The engine does not care which — the shape is identical, exactly as the
//  MQTT schema in wingbeat-system/docs/mqtt-topics.md intends.
// ============================================================================

export type NodeId = string;

/** The three things a node can sense. Matches `wingbeat/node/<id>/sensor/<kind>`. */
export type SensorKind = 'wind' | 'motion' | 'presence';

/** A node's job in the space. Mirrors the `role` field in MQTT status. */
export type NodeRole = 'sensor' | 'feather' | 'audio' | 'plant';

// ---------- Sensor payloads (what arrives FROM a transport) -----------------
// These match the JSON published by the ESP8266 firmware byte-for-byte so the
// MqttTransport can hand them straight through with zero translation.

export interface WindPayload {
  /** Smoothed breath/wind intensity, 0..1. */
  v: number;
  raw?: number;
  ts?: number;
}

export interface MotionPayload {
  ax?: number;
  ay?: number;
  az?: number;
  /** High-pass-filtered shake magnitude, ~0..1.5. */
  mag: number;
  ts?: number;
}

export interface PresencePayload {
  present: boolean;
  distance_cm?: number;
  ts?: number;
}

export interface StatusPayload {
  online: boolean;
  role?: NodeRole;
  fw?: string;
  rssi?: number;
  ip?: string;
}

// ---------- Commands (what the engine emits OUT to a transport) -------------

export type LedMode = 'off' | 'solid' | 'pulse' | 'shimmer' | 'wind' | 'rainbow';

export interface LedCommand {
  mode: LedMode;
  r: number; // 0..255
  g: number;
  b: number;
  intensity: number; // 0..1
}

export type AudioLayer = 'bed' | 'melody' | 'perc' | 'accent';

export interface AudioCommand {
  layer: AudioLayer;
  gain: number; // 0..1
  play: boolean;
}

// ---------- Runtime node state (engine-owned, read by the UI) ---------------

export interface NodeState {
  id: NodeId;
  role: NodeRole;
  online: boolean;
  /** Smoothed wind 0..1. */
  wind: number;
  /** Shake magnitude 0..1.5. */
  motion: number;
  present: boolean;
  /** Hue used for this node's default tint. */
  hue: number;
  rssi?: number;
  fw?: string;
  /** ms timestamp (performance.now-style) of last sensor packet. */
  lastSeen: number;
  /** Last LED command the engine sent to this node. */
  led: LedCommand;
}

// ---------- Scenes (cultural feather packs) ---------------------------------

export interface Scene {
  key: string;
  label: string;
  /** Continent / origin tag, for the operator UI. */
  origin: string;
  /** Default LED tint for this pack. */
  led: { r: number; g: number; b: number };
  /** Held drone chord. */
  bedNotes: string[];
  /** Notes the wind-crest pluck draws from. */
  melodyScale: string[];
  /** Tone.js subdivision the melody quantizes to (informational). */
  melodyTempo: string;
  /** Percussion rate (informational). */
  percRate: string;
  /** Tempo (beats per minute) the scene's uploaded loops/samples are authored at,
   *  so the loop transport and any MIDI/pattern engine can sync to them. */
  bpm: number;
}

// ---------- Spatial model (the room in the layout diagram) ------------------

/** Normalized room coordinate, 0..1, origin top-left (matches the diagram). */
export interface Point {
  x: number;
  y: number;
}

export interface SpeakerSpec {
  id: string;
  pos: Point;
  /** Live gain 0..1, computed by the engine for spatialization/visuals. */
}

export interface SpatialNodeSpec {
  id: NodeId;
  role: NodeRole;
  pos: Point;
}

export interface SpatialLayout {
  /** Center of the interaction zone. */
  center: Point;
  /** Radius of the interaction zone (normalized). */
  interactionRadius: number;
  screen: { pos: Point; w: number; h: number };
  speakers: SpeakerSpec[];
  nodes: SpatialNodeSpec[];
}

// ---------- Engine events (the bus the UI + audio listen on) ----------------

export type EngineEvent =
  | { type: 'node'; id: NodeId; state: NodeState }
  | { type: 'scene'; key: string; fadeMs: number }
  | { type: 'feather'; id: string }
  | { type: 'led'; id: NodeId; cmd: LedCommand }
  | { type: 'melody'; id: NodeId; note: string; velocity: number; pan: number }
  | { type: 'perc'; id: NodeId; note: string; velocity: number; pan: number }
  | { type: 'accent'; id: NodeId; note: string; velocity: number; pan: number }
  | { type: 'wind'; maxWind: number; perSpeakerGain: number[] }
  | { type: 'audioReady' };

export type EngineEventType = EngineEvent['type'];
