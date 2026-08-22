// ============================================================================
//  Cross-window sync — mirrors the console's live feather state to the display.
//
//  The control console and the /feather window are SEPARATE browser contexts,
//  each with its own engine. The console broadcasts the dynamic state (per-node
//  wind/presence, scene, feather, palette) at ~30 Hz and the rig snapshot when it
//  changes; the /feather window applies them to its own engine so the projection
//  mirrors what you're doing — open it fullscreen on a second screen.
// ============================================================================

import { validatePreset, type FeatherPreset } from './rig.ts';
import type { RemoteLevels } from '../engine/AudioEngine.ts';

export const SYNC_VERSION = 1;

export interface SyncState {
  nodes: { i: string; w: number; p: boolean }[];
  scene: string;
  feather: string;
  palette: number[][];
  /** the console's live audio levels, so a display window with no audio
   *  context of its own is still audio-reactive (see AudioEngine.setRemoteLevels) */
  audio?: RemoteLevels;
}

export type SyncMsg =
  | { kind: 'state'; v?: number; state: SyncState }
  | { kind: 'rig'; v?: number; preset: FeatherPreset };

const f01 = (v: unknown, fb = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fb);

/** Validate a frame off the BroadcastChannel. Another tab may be running an
 *  older build; a malformed frame must not take the display down. */
export function parseSyncMsg(raw: unknown): SyncMsg | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.v === 'number' && r.v > SYNC_VERSION) return null;
  if (r.kind === 'rig') {
    return r.preset && typeof r.preset === 'object' ? { kind: 'rig', v: SYNC_VERSION, preset: validatePreset(r.preset) } : null;
  }
  if (r.kind !== 'state' || !r.state || typeof r.state !== 'object') return null;
  const s = r.state as Record<string, unknown>;
  const nodes = Array.isArray(s.nodes)
    ? s.nodes.filter((n) => n && typeof n === 'object' && typeof (n as { i: unknown }).i === 'string')
        .map((n) => ({ i: (n as { i: string }).i, w: f01((n as { w: unknown }).w), p: (n as { p: unknown }).p === true }))
    : [];
  const palette = Array.isArray(s.palette)
    ? s.palette.filter((c) => Array.isArray(c) && c.length >= 3 && c.every((x) => typeof x === 'number')).map((c) => (c as number[]).slice(0, 3))
    : [];
  let audio: RemoteLevels | undefined;
  if (s.audio && typeof s.audio === 'object') {
    const a = s.audio as Record<string, unknown>;
    const loops: RemoteLevels['loops'] = {};
    if (a.loops && typeof a.loops === 'object') {
      for (const [id, arr] of Object.entries(a.loops as Record<string, unknown>)) {
        if (Array.isArray(arr) && arr.length === 4) loops[id] = [f01(arr[0]), f01(arr[1]), f01(arr[2]), f01(arr[3])];
      }
    }
    audio = { level: f01(a.level), loops };
  }
  return {
    kind: 'state',
    v: SYNC_VERSION,
    state: {
      nodes,
      scene: typeof s.scene === 'string' ? s.scene : '',
      feather: typeof s.feather === 'string' ? s.feather : '',
      palette,
      ...(audio ? { audio } : {}),
    },
  };
}

const CHANNEL = 'wingbeat-sync';
const PRESENCE = 'wingbeat-presence';

function open(name: string): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(name) : null;
  } catch {
    return null;
  }
}

export function createBroadcaster() {
  const bc = open(CHANNEL);
  return {
    send(msg: SyncMsg) {
      bc?.postMessage({ ...msg, v: SYNC_VERSION });
    },
    close() {
      bc?.close();
    },
  };
}

/** Subscribe to console messages. Returns an unsubscribe fn. */
export function createReceiver(onMsg: (m: SyncMsg) => void): () => void {
  const bc = open(CHANNEL);
  if (!bc) return () => {};
  bc.onmessage = (e) => {
    const m = parseSyncMsg(e.data);
    if (m) onMsg(m);
  };
  return () => bc.close();
}

// ---- Presence: the /feather window pings; the console watches so it can pause
//      its own (now redundant) projection and free the GPU. ------------------

export function presenceSend() {
  const bc = open(PRESENCE);
  return {
    alive() {
      bc?.postMessage('alive');
    },
    bye() {
      bc?.postMessage('bye');
    },
    close() {
      bc?.close();
    },
  };
}

/** Watch for a /feather window. Calls onChange(true) while it's alive, false
 *  when it says goodbye or stops pinging. Returns an unsubscribe fn. */
export function presenceWatch(onChange: (open: boolean) => void): () => void {
  const bc = open(PRESENCE);
  if (!bc) return () => {};
  let stale: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    if (stale) clearTimeout(stale);
    stale = setTimeout(() => onChange(false), 2500);
  };
  bc.onmessage = (e) => {
    if (e.data === 'bye') {
      if (stale) clearTimeout(stale);
      onChange(false);
    } else {
      onChange(true);
      arm();
    }
  };
  return () => {
    if (stale) clearTimeout(stale);
    bc.close();
  };
}
