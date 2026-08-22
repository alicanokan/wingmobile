// ============================================================================
//  Wire contract — the ONE description of what crosses the MQTT broker.
//
//  Both browser-side MQTT clients (MqttTransport for the engine, LedLink for
//  the light router) import their topic names, payload shapes and vocabulary
//  from here, and `scripts/gen-mqtt-doc.ts` renders this file into
//  wingbeat-system/docs/mqtt-topics.md — so the documentation cannot drift
//  from the code, and a firmware change has exactly one TypeScript file to be
//  reconciled against.
//
//  The firmware (wingbeat-system/firmware/*/ *.ino) is the other party to this
//  contract. Unknown JSON keys are ignored on both sides, which is what makes
//  additive changes (the `src` tag, `brightness`) safe to roll out in either
//  order.
// ============================================================================

import type { LedCommand, LedMode, NodeId, NodeRole, SensorKind } from '../engine/types.ts';
import type { LedSource, LedWire } from '../led/types.ts';

export type { LedCommand, LedMode, LedSource, LedWire, NodeId, NodeRole, SensorKind };

/** Bump when a payload changes shape incompatibly. Additive keys don't count. */
export const PROTOCOL_VERSION = 1;

export const PREFIX = 'wingbeat';

// ---- Topics -----------------------------------------------------------------

export const topics = {
  status: (id: NodeId) => `${PREFIX}/node/${id}/status`,
  sensor: (id: NodeId, kind: SensorKind) => `${PREFIX}/node/${id}/sensor/${kind}`,
  cmdLed: (id: NodeId) => `${PREFIX}/node/${id}/cmd/led`,
  cmdAudio: (id: NodeId) => `${PREFIX}/node/${id}/cmd/audio`,
  globalScene: `${PREFIX}/global/scene`,
  globalAll: `${PREFIX}/global/cmd/all`,
  /** subscription wildcards */
  anyStatus: `${PREFIX}/node/+/status`,
  anySensor: `${PREFIX}/node/+/sensor/+`,
  anyCmdLed: `${PREFIX}/node/+/cmd/led`,
} as const;

export type ParsedTopic =
  | { kind: 'status'; id: NodeId }
  | { kind: 'sensor'; id: NodeId; sensor: SensorKind }
  | { kind: 'cmd'; id: NodeId; cmd: 'led' | 'audio' }
  | { kind: 'global'; what: 'scene' | 'all' };

const SENSOR_KINDS: ReadonlySet<string> = new Set<SensorKind>(['wind', 'motion', 'presence']);

/** Classify an incoming topic. Null for anything outside the contract. */
export function parseTopic(topic: string): ParsedTopic | null {
  const p = topic.split('/');
  if (p[0] !== PREFIX) return null;
  if (p[1] === 'global') {
    if (p[2] === 'scene' && p.length === 3) return { kind: 'global', what: 'scene' };
    if (p[2] === 'cmd' && p[3] === 'all' && p.length === 4) return { kind: 'global', what: 'all' };
    return null;
  }
  if (p[1] !== 'node' || !p[2]) return null;
  const id = p[2];
  if (p[3] === 'status' && p.length === 4) return { kind: 'status', id };
  if (p[3] === 'sensor' && p.length === 5 && SENSOR_KINDS.has(p[4])) return { kind: 'sensor', id, sensor: p[4] as SensorKind };
  if (p[3] === 'cmd' && p.length === 5 && (p[4] === 'led' || p[4] === 'audio')) return { kind: 'cmd', id, cmd: p[4] };
  return null;
}

// ---- Vocabulary -------------------------------------------------------------

export const LED_MODES: readonly LedMode[] = ['off', 'solid', 'pulse', 'shimmer', 'wind', 'rainbow'];
export const isLedMode = (m: unknown): m is LedMode => typeof m === 'string' && (LED_MODES as readonly string[]).includes(m);

export const NODE_ROLES: readonly NodeRole[] = ['sensor', 'feather', 'audio', 'plant'];
export const isNodeRole = (r: unknown): r is NodeRole => typeof r === 'string' && (NODE_ROLES as readonly string[]).includes(r);

export type GlobalAction = 'reset' | 'calibrate' | 'rainbow' | 'silence';
export const GLOBAL_ACTIONS: readonly GlobalAction[] = ['reset', 'calibrate', 'rainbow', 'silence'];

export type AudioLayer = 'bed' | 'melody' | 'perc' | 'accent';

// ---- Payloads ---------------------------------------------------------------

/** wingbeat/node/<id>/status — retained, with an LWT of {online:false}. */
export interface StatusWire {
  online: boolean;
  role?: NodeRole;
  fw?: string;
  rssi?: number;
  ip?: string;
}

export interface WindWire { v: number; raw?: number; ts?: number }
export interface MotionWire { mag: number; ax?: number; ay?: number; az?: number; ts?: number }
export interface PresenceWire { present: boolean; distance_cm?: number; ts?: number }

/** wingbeat/node/<id>/cmd/led. `brightness` (0..1) is the strip's global
 *  brightness cap, applied on top of `intensity`; firmware ≥ 0.2 honours it. */
export type LedCmdWire = LedWire & { brightness?: number };

/** wingbeat/node/<id>/cmd/audio — audio-role nodes only. */
export interface AudioCmdWire {
  layer: AudioLayer;
  gain?: number;
  play?: boolean;
  loop?: boolean;
}

/** wingbeat/global/scene — retained; carries the LED tint so scene-aware
 *  firmware can react without a lookup table. */
export interface SceneWire {
  scene: string;
  fade_ms: number;
  led?: { r: number; g: number; b: number };
}

export interface GlobalCmdWire { action: GlobalAction }

// ---- QoS conventions --------------------------------------------------------

export const QOS = {
  status: 1,
  sensor: 0,
  /** one-off event commands (engine pipeline) — delivered, in order */
  cmdEvent: 1,
  /** continuous colour stream (router pipeline) — freshness beats delivery;
   *  QoS 1 would queue behind PUBACKs on a lossy link and lag the music */
  cmdStream: 0,
  cmdAudio: 1,
  scene: 1,
  all: 1,
} as const;

// ---- Parsing helpers (lenient: a node mid-flash can emit junk) ---------------

export function parseJson(msg: Uint8Array | string): Record<string, unknown> | null {
  try {
    const text = typeof msg === 'string' ? msg : new TextDecoder().decode(msg);
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function parseStatus(p: Record<string, unknown>): StatusWire {
  return {
    online: p.online !== false,
    role: isNodeRole(p.role) ? p.role : undefined,
    fw: typeof p.fw === 'string' ? p.fw : undefined,
    rssi: typeof p.rssi === 'number' ? p.rssi : undefined,
    ip: typeof p.ip === 'string' ? p.ip : undefined,
  };
}

const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export function parseLedCmd(p: Record<string, unknown>): LedCmdWire | null {
  if (!isLedMode(p.mode)) return null;
  const src = p.src === 'engine' || p.src === 'router' || p.src === 'identify' ? p.src : undefined;
  return {
    mode: p.mode,
    r: clamp(Math.round(num(p.r)), 0, 255),
    g: clamp(Math.round(num(p.g)), 0, 255),
    b: clamp(Math.round(num(p.b)), 0, 255),
    intensity: clamp(num(p.intensity, 1), 0, 1),
    ...(src ? { src } : {}),
    ...(typeof p.brightness === 'number' ? { brightness: clamp(num(p.brightness, 1), 0, 1) } : {}),
  };
}

// ---- Documentation source --------------------------------------------------
// Rendered by scripts/gen-mqtt-doc.ts. Keep examples valid JSON.

export interface WireDocEntry {
  topic: string;
  direction: 'node → broker' | 'browser → node' | 'browser → all nodes';
  example: string;
  notes: string;
  qos: number;
  retain: boolean;
}

export const WIRE_DOC: readonly WireDocEntry[] = [
  { topic: 'wingbeat/node/<id>/status', direction: 'node → broker', qos: QOS.status, retain: true,
    example: '{"online":true,"role":"feather","fw":"0.2.0","rssi":-62,"ip":"10.0.0.21"}',
    notes: 'Retained. The node\'s last-will publishes {"online":false,"role":…} so every client flags a dead node at once. The engine also sweeps: a node silent for 8 s is marked offline even if its TCP session survived.' },
  { topic: 'wingbeat/node/<id>/sensor/wind', direction: 'node → broker', qos: QOS.sensor, retain: false,
    example: '{"v":0.42,"raw":612,"ts":12345678}',
    notes: 'Smoothed breath/wind 0..1. ~20 Hz while changing.' },
  { topic: 'wingbeat/node/<id>/sensor/motion', direction: 'node → broker', qos: QOS.sensor, retain: false,
    example: '{"ax":0.02,"ay":-0.11,"az":0.97,"mag":0.14,"ts":12345678}',
    notes: 'Accelerometer in g; `mag` is the high-pass shake magnitude (~0..1.5). ~10 Hz above the noise floor.' },
  { topic: 'wingbeat/node/<id>/sensor/presence', direction: 'node → broker', qos: QOS.sensor, retain: true,
    example: '{"present":true,"distance_cm":120,"ts":12345678}',
    notes: 'Edge-triggered, retained. The node publishes {"present":false} on boot so a retained `true` from a previous life is cleared. `distance_cm` is optional (PIR nodes omit it).' },
  { topic: 'wingbeat/node/<id>/cmd/led', direction: 'browser → node', qos: QOS.cmdEvent, retain: false,
    example: '{"mode":"solid","r":120,"g":40,"b":200,"intensity":0.8,"src":"router","brightness":1}',
    notes: '`mode` ∈ off · solid · pulse · shimmer · wind · rainbow. `intensity` 0..1. `src` says which pipeline sent it (engine = event-driven modes at QoS 1; router = the solid-colour stream at QoS 0; identify = the operator\'s white flash) — the two pipelines arbitrate per node on this tag (led/types.ts LedArbiter). `brightness` 0..1 caps the whole strip (firmware ≥ 0.2). Feather/plant nodes only.' },
  { topic: 'wingbeat/node/<id>/cmd/audio', direction: 'browser → node', qos: QOS.cmdAudio, retain: false,
    example: '{"layer":"accent","gain":0.8,"play":true}',
    notes: 'Audio-role nodes only. `layer` ∈ bed · melody · perc · accent; `loop` defaults to true for bed. The engine sends `accent` to every online audio node on a presence onset.' },
  { topic: 'wingbeat/global/scene', direction: 'browser → all nodes', qos: QOS.scene, retain: true,
    example: '{"scene":"crane_ghana","fade_ms":2500,"led":{"r":60,"g":200,"b":130}}',
    notes: 'Retained, so a freshly booted node syncs to the current pack. `led` is the pack tint for firmware that wants to react without a table.' },
  { topic: 'wingbeat/global/cmd/all', direction: 'browser → all nodes', qos: QOS.all, retain: false,
    example: '{"action":"calibrate"}',
    notes: '`action` ∈ reset (ESP.restart) · calibrate (feather nodes: re-zero the IMU + wind baseline) · rainbow (feather nodes: test pattern) · silence (audio nodes: stop playback).' },
];
