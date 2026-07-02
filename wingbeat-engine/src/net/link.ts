// ============================================================================
//  Remote controller link — pairs phones to a running console over WebRTC.
//
//  Unlike the /cam relay (a Vite dev-server WebSocket, which only exists on the
//  LAN during `vite dev`), this uses PeerJS so it works from a static deploy
//  (Vercel) with no backend of our own. The console is the "host" and claims a
//  peer id derived from a short Device ID + pairing Code; each phone is a
//  "client" that connects to that id. The host accepts MANY clients at once, so
//  several phones can drive one console. Both sides derive the same id, so
//  scanning the QR or typing the Device ID + Code by hand reach the same room.
//
//  A phone on cellular / a locked-down WiFi can't always reach the console with
//  STUN alone (NAT), so we add public TURN relays — that's the usual cause of a
//  link that shows "connected" but never delivers data.
// ============================================================================

import { Peer, type DataConnection } from 'peerjs';

/** Control messages the phone sends to the console. */
export type Control =
  | { t: 'hello'; name?: string } // client handshake
  | { t: 'motion'; v: number } // 0..1 continuous → drives the "Net" source
  | { t: 'blow'; v: number } // 0..1 one-shot pulse → "Net" source
  | { t: 'scene'; key: string } // switch scene
  | { t: 'bpm'; v: number } // loop tempo
  | { t: 'master'; v: number }; // master volume 0..1

export type LinkStatus = 'idle' | 'connecting' | 'ready' | 'peer' | 'error';

// STUN finds your public address; TURN relays traffic when a direct path is
// blocked (cellular / AP-isolated WiFi). The openrelay project is a free public
// TURN — fine for this, swap for your own for production reliability.
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];

const peerOptions = () => ({ debug: 2 as const, config: { iceServers: ICE_SERVERS } });

type Log = (msg: string) => void;
const noop: Log = () => {};

// Surface the live ICE state on a data connection — the single most useful clue
// when a link "connects" but no data flows.
function watchIce(conn: DataConnection, log: Log) {
  const pc = (conn as unknown as { peerConnection?: RTCPeerConnection }).peerConnection;
  if (!pc) return;
  const report = () => log(`ICE ${pc.iceConnectionState}`);
  pc.addEventListener('iceconnectionstatechange', report);
  report();
}

// Unambiguous alphabet — no I/L/O/0/1 so codes are easy to read off a screen
// and type back in.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randId(n: number): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}

/** The peer id both sides compute from the Device ID + Code combination. */
export function peerIdFor(deviceId: string, code: string): string {
  return `wb-${deviceId}-${code}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
}

export interface HostHandle {
  deviceId: string;
  code: string;
  peerCount(): number;
  destroy(): void;
}

/**
 * Console side: claim a room and listen for phones. `onControl` fires for every
 * message any connected phone sends; `onStatus` tracks the link; `onPeers`
 * reports the live controller count; `onLog` streams a human-readable trace.
 */
export function startHost(opts: {
  deviceId?: string;
  code?: string;
  onControl: (c: Control) => void;
  onStatus: (s: LinkStatus) => void;
  onPeers?: (n: number) => void;
  onIdentity?: (deviceId: string, code: string) => void;
  onLog?: Log;
}): HostHandle {
  const log = opts.onLog ?? noop;
  // A room id is exclusive on the PeerJS server, so a stale session or a second
  // console tab can be holding it → 'unavailable-id'. Start from the requested
  // codes but fall back to a fresh random room on collision, and report the
  // room we actually landed on via onIdentity.
  let deviceId = opts.deviceId ?? randId(4);
  let code = opts.code ?? randId(4);
  let peer: Peer;
  let destroyed = false;
  let tries = 0;
  const conns = new Set<DataConnection>();

  const report = () => {
    opts.onPeers?.(conns.size);
    opts.onStatus(conns.size ? 'peer' : 'ready');
  };

  const bindConnections = (p: Peer) => {
    p.on('connection', (conn) => {
      log(`phone connecting: ${conn.peer}`);
      conns.add(conn);
      conn.on('open', () => {
        log(`phone OPEN: ${conn.peer} (${conns.size} total)`);
        watchIce(conn, log);
        report();
      });
      conn.on('data', (d) => {
        try {
          const c = d as Control;
          if (c.t === 'hello') log(`hello from ${conn.peer}`);
          opts.onControl(c);
        } catch {
          /* ignore malformed frame */
        }
      });
      const drop = (why: string) => {
        if (!conns.has(conn)) return;
        conns.delete(conn);
        log(`phone ${why}: ${conn.peer} (${conns.size} left)`);
        report();
      };
      conn.on('close', () => drop('closed'));
      conn.on('error', (e) => {
        log(`phone error: ${(e as Error).message ?? e}`);
        drop('errored');
      });
    });
  };

  const claim = () => {
    if (destroyed) return;
    tries++;
    const id = peerIdFor(deviceId, code);
    log(`host starting, room=${id}`);
    opts.onStatus('connecting');
    peer = new Peer(id, peerOptions());
    peer.on('open', () => {
      log('host ready — waiting for a phone');
      opts.onIdentity?.(deviceId, code);
      opts.onStatus('ready');
    });
    peer.on('error', (e) => {
      const type = (e as { type?: string }).type ?? '';
      log(`host error: ${type} ${(e as Error).message ?? e}`);
      console.warn('[link] host error', e);
      // Room already taken (another tab / stale session) → grab a fresh room.
      if (type === 'unavailable-id' && tries < 6 && !destroyed) {
        try {
          peer.destroy();
        } catch {
          /* already gone */
        }
        deviceId = randId(4);
        code = randId(4);
        log(`room taken — switching to ${peerIdFor(deviceId, code)}`);
        setTimeout(claim, 250);
        return;
      }
      if (!conns.size) opts.onStatus('error');
    });
    bindConnections(peer);
  };

  claim();

  return {
    get deviceId() {
      return deviceId;
    },
    get code() {
      return code;
    },
    peerCount: () => conns.size,
    destroy() {
      destroyed = true;
      conns.forEach((c) => c.close());
      try {
        peer.destroy();
      } catch {
        /* already gone */
      }
    },
  };
}

export interface ClientHandle {
  send(c: Control): void;
  destroy(): void;
}

/**
 * Phone side: connect to the console's room. Retries a few times so a phone that
 * loads before the console is ready (or across a slow TURN handshake) still lands.
 */
export function connectHost(
  deviceId: string,
  code: string,
  opts: { onStatus: (s: LinkStatus) => void; onLog?: Log },
): ClientHandle {
  const log = opts.onLog ?? noop;
  const targetId = peerIdFor(deviceId, code);
  const peer = new Peer(peerOptions());
  let conn: DataConnection | null = null;
  let attempts = 0;
  let destroyed = false;
  let warnedClosed = false;

  const dial = () => {
    if (destroyed) return;
    attempts++;
    opts.onStatus('connecting');
    log(`dialing ${targetId} (try ${attempts})`);
    const c = peer.connect(targetId, { reliable: true });
    conn = c;
    c.on('open', () => {
      warnedClosed = false;
      log('DATA CHANNEL OPEN ✓');
      watchIce(c, log);
      opts.onStatus('peer');
      c.send({ t: 'hello' } satisfies Control);
    });
    c.on('data', () => {}); // console→phone is unused today, but keeps the channel warm
    c.on('close', () => {
      log('data channel closed');
      opts.onStatus('ready');
    });
    c.on('error', (e) => {
      log(`conn error: ${(e as Error).message ?? e}`);
      if (attempts < 4 && !destroyed) setTimeout(dial, 1200);
      else opts.onStatus('error');
    });
  };

  peer.on('open', (id) => {
    log(`phone ready id=${id}`);
    dial();
  });
  peer.on('error', (e) => {
    const type = (e as { type?: string }).type ?? '';
    log(`peer error: ${type} ${(e as Error).message ?? ''}`);
    console.warn('[link] client error', e);
    // 'peer-unavailable' → the console room isn't up (or wrong code). Retry a few.
    if (attempts < 4 && !destroyed) setTimeout(dial, 1500);
    else opts.onStatus('error');
  });

  return {
    send(c) {
      if (conn && conn.open) conn.send(c);
      else if (!warnedClosed) {
        warnedClosed = true;
        log('send skipped — channel not open yet');
      }
    },
    destroy() {
      destroyed = true;
      conn?.close();
      peer.destroy();
    },
  };
}
