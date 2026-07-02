// ============================================================================
//  Cross-window sync — mirrors the console's live feather state to the display.
//
//  The control console and the /feather window are SEPARATE browser contexts,
//  each with its own engine. The console broadcasts the dynamic state (per-node
//  wind/presence, scene, feather, palette) at ~30 Hz and the rig snapshot when it
//  changes; the /feather window applies them to its own engine so the projection
//  mirrors what you're doing — open it fullscreen on a second screen.
// ============================================================================

import type { FeatherPreset } from './rig.ts';

export interface SyncState {
  nodes: { i: string; w: number; p: boolean }[];
  scene: string;
  feather: string;
  palette: number[][];
}

export type SyncMsg =
  | { kind: 'state'; state: SyncState }
  | { kind: 'rig'; preset: FeatherPreset };

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
      bc?.postMessage(msg);
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
  bc.onmessage = (e) => onMsg(e.data as SyncMsg);
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
