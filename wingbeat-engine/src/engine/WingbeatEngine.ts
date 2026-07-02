// ============================================================================
//  Wing Beat — Engine core (transport-agnostic, output-agnostic)
//
//  This is THE BRAIN. It does exactly one thing: turn sensor readings into
//  meaning, and broadcast that meaning on an event bus. It knows nothing about
//  WebSockets, MQTT, Tone.js, React, or LEDs.
//
//    transport.ingest*(...)  ──►  [ WingbeatEngine ]  ──►  bus events
//                                       │
//                  state model + thresholds + cooldowns + scene
//
//  Consumers (audio engine, on-screen feathers, the MQTT transport's outbound
//  side that drives real LED strips) all subscribe to the same bus. Swap the
//  transport from "simulation" to "real hardware" and the brain is byte-for-
//  byte identical — which is the whole point of building it this way.
// ============================================================================

import { Emitter } from './emitter.ts';
import { DEFAULT_SCENE, getScene } from './scenes.ts';
import { nodeGain, panForNode, nodeSpec } from './spatial.ts';
import type {
  EngineEvent,
  EngineEventType,
  LedCommand,
  NodeId,
  NodeRole,
  NodeState,
  StatusPayload,
} from './types.ts';

// Mapping constants — the "feel" of the instrument. Tuned to match the
// behavior in wingbeat-system/web/app.js; tweak freely.
const WIND_MELODY_THRESHOLD = 0.55;
const WIND_MELODY_COOLDOWN_MS = 800;
const MOTION_PERC_THRESHOLD = 0.6;
const MOTION_PERC_COOLDOWN_MS = 250;
const PRESENCE_ACCENT_COOLDOWN_MS = 1500;
const NODE_STALE_MS = 8000;

const PERC_PITCHES = ['C2', 'D2', 'E2', 'G2', 'A2'];

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

interface NodeRuntime extends NodeState {
  lastMelodyMs: number;
  lastPercMs: number;
  lastAccentMs: number;
}

export interface EngineConfig {
  /** Multiplier on incoming wind — bump when participants are tentative. */
  windSensitivity?: number;
  scene?: string;
  /** Which feather from the collection the projection shows. */
  feather?: string;
}

export class WingbeatEngine {
  readonly bus = new Emitter();

  private nodes = new Map<NodeId, NodeRuntime>();
  scene: string;
  feather: string;
  /** Dominant color groups extracted from the current feather (rgb 0..1). */
  featherPalette: number[][] = [];
  /** Pixel count per color group — the size of each analyzed "layer". */
  featherLayerCounts: number[] = [];
  windSensitivity: number;

  constructor(cfg: EngineConfig = {}) {
    this.scene = cfg.scene ?? DEFAULT_SCENE;
    this.feather = cfg.feather ?? 'procedural';
    this.windSensitivity = cfg.windSensitivity ?? 1.0;
  }

  // ---- Subscription ------------------------------------------------------
  on<T extends EngineEventType>(
    type: T,
    handler: (e: Extract<EngineEvent, { type: T }>) => void,
  ): () => void {
    return this.bus.on(type, handler);
  }

  // ---- State access ------------------------------------------------------
  getNode(id: NodeId): NodeState | undefined {
    return this.nodes.get(id);
  }
  getNodes(): NodeState[] {
    return [...this.nodes.values()];
  }

  private ensure(id: NodeId, role: NodeRole = 'sensor'): NodeRuntime {
    let n = this.nodes.get(id);
    if (!n) {
      const spec = nodeSpec(id);
      n = {
        id,
        role: spec?.role ?? role,
        online: true,
        wind: 0,
        motion: 0,
        present: false,
        hue: Math.floor((id.length * 47 + id.charCodeAt(0) * 13) % 360),
        lastSeen: now(),
        led: { mode: 'pulse', r: 30, g: 30, b: 50, intensity: 0.3 },
        lastMelodyMs: 0,
        lastPercMs: 0,
        lastAccentMs: 0,
      };
      this.nodes.set(id, n);
    }
    return n;
  }

  private publishNode(n: NodeRuntime) {
    this.bus.emit({ type: 'node', id: n.id, state: n });
  }

  // ---- Ingest: the only way data enters the engine -----------------------

  ingestStatus(id: NodeId, p: StatusPayload) {
    const n = this.ensure(id, p.role ?? 'sensor');
    n.online = p.online;
    if (p.role) n.role = p.role;
    n.rssi = p.rssi;
    n.fw = p.fw;
    n.lastSeen = now();
    this.publishNode(n);
  }

  ingestWind(id: NodeId, v: number) {
    const n = this.ensure(id);
    n.wind = clamp(v * this.windSensitivity, 0, 1);
    n.lastSeen = now();

    // The wind layer is a global swell: the loudest breath in the room wins,
    // and it's spatialized toward whoever is making it.
    let maxWind = 0;
    let loudest: NodeRuntime | null = null;
    for (const node of this.nodes.values()) {
      if (node.wind > maxWind) {
        maxWind = node.wind;
        loudest = node;
      }
    }
    const perSpeakerGain = nodeGain(loudest ? loudest.id : id);
    this.bus.emit({ type: 'wind', maxWind, perSpeakerGain });

    // Melody triggers on a wind crest (threshold + per-node cooldown).
    const t = now();
    if (this.patternsOn && n.wind > WIND_MELODY_THRESHOLD && t - n.lastMelodyMs > WIND_MELODY_COOLDOWN_MS) {
      n.lastMelodyMs = t;
      const scale = getScene(this.scene).melodyScale;
      const note = scale[Math.floor(Math.random() * scale.length)];
      this.bus.emit({
        type: 'melody',
        id,
        note,
        velocity: 0.4 + n.wind * 0.6,
        pan: panForNode(id),
      });
      this.setLed(id, { mode: 'wind', ...getScene(this.scene).led, intensity: 1.0 });
      // settle back to a shimmer shortly after the gust
      setTimeout(
        () => this.setLed(id, { mode: 'shimmer', ...getScene(this.scene).led, intensity: 0.4 }),
        300,
      );
    }

    this.publishNode(n);
  }

  ingestMotion(id: NodeId, mag: number) {
    const n = this.ensure(id);
    n.motion = clamp(mag, 0, 1.5);
    n.lastSeen = now();

    const t = now();
    if (this.patternsOn && n.motion > MOTION_PERC_THRESHOLD && t - n.lastPercMs > MOTION_PERC_COOLDOWN_MS) {
      n.lastPercMs = t;
      const note = PERC_PITCHES[Math.floor(Math.random() * PERC_PITCHES.length)];
      this.bus.emit({
        type: 'perc',
        id,
        note,
        velocity: 0.5 + Math.min(0.5, n.motion * 0.5),
        pan: panForNode(id),
      });
    }
    this.publishNode(n);
  }

  ingestPresence(id: NodeId, present: boolean) {
    const n = this.ensure(id);
    n.present = present;
    n.lastSeen = now();

    const t = now();
    if (this.patternsOn && present && t - n.lastAccentMs > PRESENCE_ACCENT_COOLDOWN_MS) {
      n.lastAccentMs = t;
      this.bus.emit({ type: 'accent', id, note: 'A5', velocity: 0.5, pan: panForNode(id) });
      this.setLed(id, { mode: 'shimmer', ...getScene(this.scene).led, intensity: 0.6 });
    } else if (!present) {
      this.setLed(id, { mode: 'pulse', r: 30, g: 30, b: 50, intensity: 0.3 });
    }
    this.publishNode(n);
  }

  // ---- LED command emission (consumed by transports + the on-screen sim) -
  private setLed(id: NodeId, cmd: LedCommand) {
    const n = this.ensure(id);
    n.led = cmd;
    this.bus.emit({ type: 'led', id, cmd });
  }

  // ---- Scene control -----------------------------------------------------
  setScene(key: string, fadeMs = 2500) {
    if (!getScene(key)) return;
    this.scene = key;
    this.bus.emit({ type: 'scene', key, fadeMs });
    // tint every known feather/sensor to the new pack
    const led = getScene(key).led;
    for (const n of this.nodes.values()) {
      this.setLed(n.id, { mode: 'shimmer', ...led, intensity: 0.5 });
    }
  }

  /** Choose which feather from the collection the projection renders. */
  setFeather(id: string) {
    this.feather = id;
    this.bus.emit({ type: 'feather', id });
  }

  /** Store the color groups the projection extracted from the current feather. */
  setFeatherPalette(palette: number[][], counts: number[] = []) {
    this.featherPalette = palette;
    this.featherLayerCounts = counts;
  }

  setWindSensitivity(s: number) {
    this.windSensitivity = s;
  }

  /** Auto-generated melody/perc/accent triggers (the "pulsating" generative
   *  engine). Turn OFF to drive the piece purely from sensors + loaded loops. */
  patternsOn = true;
  setPatterns(on: boolean) {
    this.patternsOn = on;
  }

  emitAudioReady() {
    this.bus.emit({ type: 'audioReady' });
  }

  // ---- Housekeeping: mark silent nodes offline ---------------------------
  tickStaleness() {
    const t = now();
    for (const n of this.nodes.values()) {
      const stale = t - n.lastSeen > NODE_STALE_MS;
      if (stale && n.online) {
        n.online = false;
        this.publishNode(n);
      }
    }
  }
}
