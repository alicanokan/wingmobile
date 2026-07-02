// ============================================================================
//  Input routing — a 3-stage patch:
//
//      source (key / mic / camera / ESP)  →  trigger SLOT (1 of 5)
//                                          →  feather PART(s) (1+ of 5)
//
//  SLOTS are abstract trigger points (a hardware sensor, a key, …). PARTS are
//  the visual zones the engine actually animates (Tip / Rachis / Color A / B /
//  Tail — i.e. the SENSOR_CHANNELS). Decoupling them lets one slot drive several
//  parts, and lets any input feed any slot. A central router in App reads each
//  source once per frame, resolves slot → part(s), and feeds the engine.
// ============================================================================

import { SENSOR_CHANNELS } from './channels.ts';

/** How many independent phone controllers / devices can pair at once. */
export const DEVICE_COUNT = 5;
/** Source keys for the paired devices: 'dev1' … 'dev5'. */
export const DEVICE_KEYS = Array.from({ length: DEVICE_COUNT }, (_, i) => `dev${i + 1}` as DeviceKey);
export type DeviceKey = `dev${number}`;

export type SourceKind = 'off' | 'key' | 'mic' | 'camera' | 'esp' | DeviceKey;

export interface SourceDef {
  key: SourceKind;
  label: string;
  hint: string;
  /** Only meaningful when the Hardware transport is connected. */
  hardware?: boolean;
}

export const INPUT_SOURCES: SourceDef[] = [
  { key: 'off', label: 'Off', hint: 'no input' },
  { key: 'key', label: 'Key', hint: 'keyboard / manual button' },
  { key: 'mic', label: 'Mic', hint: 'microphone breath / level' },
  { key: 'camera', label: 'Cam', hint: 'camera motion energy' },
  ...DEVICE_KEYS.map((k, i) => ({ key: k, label: `D${i + 1}`, hint: `phone / device ${i + 1} (pair it in the Controllers panel)` })),
  { key: 'esp', label: 'ESP', hint: 'attached hardware sensor (Hardware mode)', hardware: true },
];

/** All valid source keys — used to sanitise persisted routing. */
const VALID_SOURCES = new Set<string>(INPUT_SOURCES.map((s) => s.key));
export const isDeviceKey = (s: string): s is DeviceKey => /^dev\d+$/.test(s);
/** Index (0-based) of a device source key, or -1. */
export const deviceIndex = (s: string): number => (isDeviceKey(s) ? Number(s.slice(3)) - 1 : -1);

/** Abstract trigger slot, decoupled from the visual part it drives. */
export interface Slot {
  id: string;
  name: string;
  key: string; // keyboard key that fires this slot when its source is "Key"
}
export const SLOTS: Slot[] = SENSOR_CHANNELS.map((c, i) => ({
  id: `slot_${i + 1}`,
  name: `Sensor ${i + 1}`,
  key: c.key,
}));

/** The feather parts = engine channels the shader animates. */
export const PARTS = SENSOR_CHANNELS.map((c) => ({ id: c.sensor, label: c.label }));

export const KEY_TO_SLOT: Record<string, string> = Object.fromEntries(
  SLOTS.map((s) => [s.key, s.id]),
);

export type SourceMap = Record<string, SourceKind>; // slotId → source
export type PartMap = Record<string, string[]>; // slotId → partId[]
export type KeyMap = Record<string, string>; // slotId → keyboard letter

export function defaultSourceMap(): SourceMap {
  const m: SourceMap = {};
  for (const s of SLOTS) m[s.id] = 'key'; // keyboard by default (preserves QWERT)
  return m;
}
export function defaultPartMap(): PartMap {
  const m: PartMap = {};
  SLOTS.forEach((s, i) => (m[s.id] = [PARTS[i].id])); // identity: slot i → part i
  return m;
}
export function defaultKeyMap(): KeyMap {
  const m: KeyMap = {};
  for (const s of SLOTS) m[s.id] = s.key;
  return m;
}

const STORE_KEY = 'wb.routing.v2';

export interface RoutingState {
  sources: SourceMap;
  parts: PartMap;
  keys: KeyMap;
  /** Level a key press produces (0..1) and its envelope release in seconds. */
  keyAmount: number;
  keyRelease: number;
}

export function loadRouting(): RoutingState {
  const base: RoutingState = {
    sources: defaultSourceMap(),
    parts: defaultPartMap(),
    keys: defaultKeyMap(),
    keyAmount: 1,
    keyRelease: 0.25,
  };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<RoutingState>;
    for (const s of SLOTS) {
      if (saved.sources?.[s.id] && VALID_SOURCES.has(saved.sources[s.id])) base.sources[s.id] = saved.sources[s.id];
      if (Array.isArray(saved.parts?.[s.id])) base.parts[s.id] = saved.parts![s.id];
      if (typeof saved.keys?.[s.id] === 'string') base.keys[s.id] = saved.keys[s.id];
    }
    if (typeof saved.keyAmount === 'number') base.keyAmount = saved.keyAmount;
    if (typeof saved.keyRelease === 'number') base.keyRelease = saved.keyRelease;
  } catch {
    /* ignore malformed storage */
  }
  return base;
}

export function saveRouting(state: RoutingState): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    /* storage may be unavailable */
  }
}
