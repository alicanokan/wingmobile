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
import { EncounterModel } from './encounter.ts';
import { GestureTraceRecorder, replayGestureTrace } from './replay.ts';
import { DEFAULT_SCENE, SCENES, getScene } from './scenes.ts';
import { nodeGain, panForNode, nodeSpec } from './spatial.ts';
import type {
  EngineEvent,
  EngineEventType,
  CalibratedInputSample,
  GestureTrace,
  InputSource,
  ExpressiveState,
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

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

interface NodeRuntime extends NodeState {
  lastMelodyMs: number;
  lastPercMs: number;
  lastAccentMs: number;
  ledSettleAt: number;
}

export interface EngineConfig {
  /** Multiplier on incoming wind — bump when participants are tentative. */
  windSensitivity?: number;
  scene?: string;
  /** Which feather from the collection the projection shows. */
  feather?: string;
  /** Injectable dependencies make recorded sensor traces reproducible in tests. */
  clock?: () => number;
  random?: () => number;
}

export class WingbeatEngine {
  readonly bus = new Emitter();

  private nodes = new Map<NodeId, NodeRuntime>();
  private readonly clock: () => number;
  private readonly random: () => number;
  private readonly encounter = new EncounterModel();
  private expressiveState: ExpressiveState;
  private recorder: GestureTraceRecorder | null = null;
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
    this.clock = cfg.clock ?? (() => (typeof performance !== 'undefined' ? performance.now() : 0));
    this.random = cfg.random ?? Math.random;
    this.expressiveState = this.encounter.snapshot(this.clock());
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
  getExpressiveState(): ExpressiveState {
    return this.expressiveState;
  }
  /** Display-only mirrors may apply the console's derived state after ingesting
   *  node samples, avoiding a second encounter model drifting across windows. */
  applyExpressiveState(state: ExpressiveState): void {
    if (state.version !== 1) return;
    this.expressiveState = state;
    this.bus.emit({ type: 'expressive', state });
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
        lastSeen: this.clock(),
        led: { mode: 'pulse', r: 30, g: 30, b: 50, intensity: 0.3 },
        lastMelodyMs: 0,
        lastPercMs: 0,
        lastAccentMs: 0,
        ledSettleAt: 0,
      };
      this.nodes.set(id, n);
    }
    return n;
  }

  private publishNode(n: NodeRuntime) {
    this.bus.emit({ type: 'node', id: n.id, state: n });
  }

  // ---- Ingest: the only way data enters the engine -----------------------

  ingestSample(sample: CalibratedInputSample): void {
    this.recorder?.record(sample);
    this.bus.emit({ type: 'input', sample });
    for (const gesture of this.encounter.ingest(sample)) {
      this.bus.emit({ type: 'gesture', gesture });
    }
    if (!sample.valid) return;
    if (sample.kind === 'wind') this.ingestWindValue(sample.nodeId, sample.value, sample.timestamp);
    else if (sample.kind === 'motion') this.ingestMotionValue(sample.nodeId, sample.value, sample.timestamp);
    else this.ingestPresenceValue(sample.nodeId, sample.value >= 0.5, sample.timestamp);
    this.publishEncounter(sample.timestamp);
  }

  private sample(id: NodeId, kind: CalibratedInputSample['kind'], value: number, source: InputSource, timestamp: number, sourceTimestamp?: number): CalibratedInputSample {
    return {
      version: 1,
      source,
      nodeId: id,
      kind,
      value,
      timestamp,
      sourceTimestamp,
      valid: Number.isFinite(value),
      unit: kind === 'presence' ? 'boolean' : 'normalized',
    };
  }

  startRecording(timestamp = this.clock()): void {
    this.recorder = new GestureTraceRecorder();
    this.recorder.start(timestamp);
  }

  stopRecording(): GestureTrace | null {
    const trace = this.recorder?.export() ?? null;
    this.recorder = null;
    return trace;
  }

  replay(trace: GestureTrace): void {
    replayGestureTrace(trace, (sample) => this.ingestSample(sample), (timestamp) => this.tick(timestamp));
  }

  ingestStatus(id: NodeId, p: StatusPayload) {
    const n = this.ensure(id, p.role ?? 'sensor');
    n.online = p.online;
    if (p.role) n.role = p.role;
    n.rssi = p.rssi;
    n.fw = p.fw;
    n.lastSeen = this.clock();
    this.publishNode(n);
  }

  ingestWind(id: NodeId, v: number, source: InputSource = 'simulation', timestamp = this.clock(), sourceTimestamp?: number) {
    this.ingestSample(this.sample(id, 'wind', v, source, timestamp, sourceTimestamp));
  }

  private ingestWindValue(id: NodeId, v: number, timestamp: number) {
    const n = this.ensure(id);
    n.wind = clamp(v * this.windSensitivity, 0, 1);
    n.lastSeen = timestamp;

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
    const t = timestamp;
    if (this.patternsOn && n.wind > WIND_MELODY_THRESHOLD && t - n.lastMelodyMs > WIND_MELODY_COOLDOWN_MS) {
      n.lastMelodyMs = t;
      const scale = getScene(this.scene).melodyScale;
      const note = scale[Math.floor(this.random() * scale.length)];
      this.bus.emit({
        type: 'melody',
        id,
        note,
        velocity: 0.4 + n.wind * 0.6,
        pan: panForNode(id),
      });
      this.setLed(id, { mode: 'wind', ...getScene(this.scene).led, intensity: 1.0 });
      n.ledSettleAt = t + 300;
    }

    this.publishNode(n);
  }

  ingestMotion(id: NodeId, mag: number, source: InputSource = 'simulation', timestamp = this.clock(), sourceTimestamp?: number) {
    this.ingestSample(this.sample(id, 'motion', mag, source, timestamp, sourceTimestamp));
  }

  private ingestMotionValue(id: NodeId, mag: number, timestamp: number) {
    const n = this.ensure(id);
    n.motion = clamp(mag, 0, 1.5);
    n.lastSeen = timestamp;

    const t = timestamp;
    if (this.patternsOn && n.motion > MOTION_PERC_THRESHOLD && t - n.lastPercMs > MOTION_PERC_COOLDOWN_MS) {
      n.lastPercMs = t;
      const note = PERC_PITCHES[Math.floor(this.random() * PERC_PITCHES.length)];
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

  ingestPresence(id: NodeId, present: boolean, source: InputSource = 'simulation', timestamp = this.clock(), sourceTimestamp?: number) {
    this.ingestSample(this.sample(id, 'presence', present ? 1 : 0, source, timestamp, sourceTimestamp));
  }

  private ingestPresenceValue(id: NodeId, present: boolean, timestamp: number) {
    const n = this.ensure(id);
    n.present = present;
    n.lastSeen = timestamp;

    const t = timestamp;
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
    // getScene() falls back to the default pack, so it can't be used as a
    // guard: an unknown key must be rejected here, not stored and published.
    if (!Object.prototype.hasOwnProperty.call(SCENES, key)) {
      console.warn(`[engine] ignoring unknown scene "${key}"`);
      return;
    }
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
   *  engine). ON by default — a fresh boot must make sound when sensors fire;
   *  the console rail has a toggle for ambient-only (sensor + loop) moments. */
  patternsOn = true;
  setPatterns(on: boolean) {
    this.patternsOn = on;
  }

  emitAudioReady() {
    this.bus.emit({ type: 'audioReady' });
  }

  settle(): void {
    this.encounter.requestSettle();
    this.publishEncounter(this.clock());
  }

  hold(held = true): void {
    this.encounter.setHeld(held);
    this.publishEncounter(this.clock());
  }

  setReducedMotion(reduced: boolean): void {
    this.encounter.setReducedMotion(reduced);
    this.publishEncounter(this.clock());
  }

  emergencyStop(): void {
    this.patternsOn = false;
    this.encounter.emergencyStop();
    for (const node of this.nodes.values()) {
      this.setLed(node.id, { mode: 'off', r: 0, g: 0, b: 0, intensity: 0 });
    }
    this.publishEncounter(this.clock());
  }

  tick(timestamp = this.clock()): void {
    this.publishEncounter(timestamp);
    this.tickStaleness(timestamp);
  }

  private publishEncounter(timestamp: number): void {
    const update = this.encounter.advanceTo(timestamp);
    this.expressiveState = update.state;
    if (update.previousPhase) {
      this.bus.emit({ type: 'encounter', phase: update.state.phase, previous: update.previousPhase });
    }
    this.bus.emit({ type: 'expressive', state: update.state });
  }

  // ---- Housekeeping: mark silent nodes offline ---------------------------
  tickStaleness(t = this.clock()) {
    for (const n of this.nodes.values()) {
      if (n.ledSettleAt && t >= n.ledSettleAt) {
        n.ledSettleAt = 0;
        this.setLed(n.id, { mode: 'shimmer', ...getScene(this.scene).led, intensity: 0.4 });
      }
      const stale = t - n.lastSeen > NODE_STALE_MS;
      if (stale && n.online) {
        n.online = false;
        this.publishNode(n);
      }
    }
  }
}
