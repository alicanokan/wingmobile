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

/** Runtime validation of a frame from a phone. Phones run whatever build
 *  they last loaded, so a stale or hand-rolled client must not be able to
 *  NaN the transport or inject an unknown verb. Returns null for junk. */
export function parseControl(raw: unknown): Control | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num01 = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null);
  switch (r.t) {
    case 'hello':
      return { t: 'hello', ...(typeof r.name === 'string' ? { name: r.name.slice(0, 40) } : {}) };
    case 'motion':
    case 'blow': {
      const v = num01(r.v);
      return v === null ? null : { t: r.t, v };
    }
    case 'scene':
      return typeof r.key === 'string' && /^[a-z0-9_]{1,40}$/.test(r.key) ? { t: 'scene', key: r.key } : null;
    case 'bpm':
      return typeof r.v === 'number' && Number.isFinite(r.v) ? { t: 'bpm', v: Math.max(40, Math.min(220, Math.round(r.v))) } : null;
    case 'master': {
      const v = num01(r.v);
      return v === null ? null : { t: 'master', v };
    }
    default:
      return null;
  }
}

// ---- Console → phone messages ----------------------------------------------
//
// The data channel back to the phone used to be silent. It now carries one
// message: the console's channel directory, so a phone can offer "add another
// channel" without anyone reading codes off the projection screen.

/** One joinable room on the console: a single part or a multi-part group. */
export interface ChannelAd {
  d: string; // Device ID
  c: string; // Code
  label: string;
  /** phones currently in that room — 0 means free */
  peers: number;
  kind: 'part' | 'group';
}

export type HostMsg = { t: 'channels'; list: ChannelAd[] };

const CODE_RE = /^[A-Z0-9]{3,8}$/;

/** Validate a frame from the console — same reasoning as parseControl, in the
 *  other direction: the console may be a newer build than the phone. */
export function parseHostMsg(raw: unknown): HostMsg | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.t !== 'channels' || !Array.isArray(r.list)) return null;
  const list: ChannelAd[] = [];
  for (const it of r.list.slice(0, 24)) {
    if (!it || typeof it !== 'object') continue;
    const a = it as Record<string, unknown>;
    if (typeof a.d !== 'string' || typeof a.c !== 'string' || !CODE_RE.test(a.d) || !CODE_RE.test(a.c)) continue;
    list.push({
      d: a.d,
      c: a.c,
      label: typeof a.label === 'string' ? a.label.slice(0, 32) : `${a.d}-${a.c}`,
      peers: typeof a.peers === 'number' && Number.isFinite(a.peers) ? Math.max(0, Math.round(a.peers)) : 0,
      kind: a.kind === 'group' ? 'group' : 'part',
    });
  }
  return { t: 'channels', list };
}

// ---- Network configuration (signalling + ICE) -------------------------------
//
// Defaults are the free public services (PeerJS cloud + openrelay TURN), which
// is fine for a demo and a single point of failure for a show. A venue kit
// runs its own PeerJS server on the console laptop and, if phones are on
// cellular, its own TURN — configured here via Vite env (build time) or
// localStorage `wb.net.v1` (runtime, from the console's Settings). Both
// phones and console must agree, so the QR link carries nothing: the phone
// reads the same env build. See docs/VENUE_KIT.md.

export interface NetConfig {
  /** PeerJS signalling server — empty host = the free PeerJS cloud */
  peerHost: string;
  peerPort: number;
  peerPath: string;
  peerSecure: boolean;
  peerKey: string;
  stunUrls: string[];
  turnUrls: string[];
  turnUser: string;
  turnCred: string;
}

const NET_KEY = 'wb.net.v1';
const env = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}) as Record<string, string | undefined>;

const DEFAULT_NET: NetConfig = {
  peerHost: env.VITE_PEER_HOST ?? '',
  peerPort: Number(env.VITE_PEER_PORT ?? 443) || 443,
  peerPath: env.VITE_PEER_PATH ?? '/',
  peerSecure: (env.VITE_PEER_SECURE ?? 'true') !== 'false',
  peerKey: env.VITE_PEER_KEY ?? 'peerjs',
  stunUrls: (env.VITE_STUN_URLS ?? 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302').split(',').map((u) => u.trim()).filter(Boolean),
  turnUrls: (env.VITE_TURN_URLS ?? 'turn:openrelay.metered.ca:80,turn:openrelay.metered.ca:443,turn:openrelay.metered.ca:443?transport=tcp').split(',').map((u) => u.trim()).filter(Boolean),
  turnUser: env.VITE_TURN_USER ?? 'openrelayproject',
  turnCred: env.VITE_TURN_CRED ?? 'openrelayproject',
};

function validateNet(raw: unknown): NetConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const strs = (v: unknown, fb: string[]) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : fb);
  return {
    peerHost: typeof r.peerHost === 'string' ? r.peerHost.trim() : DEFAULT_NET.peerHost,
    peerPort: typeof r.peerPort === 'number' && r.peerPort > 0 && r.peerPort < 65536 ? Math.round(r.peerPort) : DEFAULT_NET.peerPort,
    peerPath: typeof r.peerPath === 'string' && r.peerPath.startsWith('/') ? r.peerPath : DEFAULT_NET.peerPath,
    peerSecure: typeof r.peerSecure === 'boolean' ? r.peerSecure : DEFAULT_NET.peerSecure,
    peerKey: typeof r.peerKey === 'string' && r.peerKey ? r.peerKey : DEFAULT_NET.peerKey,
    stunUrls: strs(r.stunUrls, DEFAULT_NET.stunUrls),
    turnUrls: strs(r.turnUrls, DEFAULT_NET.turnUrls),
    turnUser: typeof r.turnUser === 'string' ? r.turnUser : DEFAULT_NET.turnUser,
    turnCred: typeof r.turnCred === 'string' ? r.turnCred : DEFAULT_NET.turnCred,
  };
}

export function getNetConfig(): NetConfig {
  try {
    const raw = localStorage.getItem(NET_KEY);
    return validateNet(raw ? JSON.parse(raw) : undefined);
  } catch {
    return { ...DEFAULT_NET };
  }
}

/** Persist a runtime override (venue kit). Pass null to go back to env/defaults. */
export function setNetConfig(cfg: Partial<NetConfig> | null): NetConfig {
  try {
    if (!cfg) localStorage.removeItem(NET_KEY);
    else localStorage.setItem(NET_KEY, JSON.stringify(validateNet({ ...getNetConfig(), ...cfg })));
  } catch { /* private mode */ }
  return getNetConfig();
}

export function isUsingFreeInfra(cfg = getNetConfig()): { signalling: boolean; turn: boolean } {
  return {
    signalling: !cfg.peerHost,
    turn: cfg.turnUrls.some((u) => u.includes('openrelay.metered.ca')),
  };
}

function iceServers(cfg: NetConfig): RTCIceServer[] {
  const out: RTCIceServer[] = cfg.stunUrls.map((urls) => ({ urls }));
  for (const urls of cfg.turnUrls) out.push({ urls, username: cfg.turnUser, credential: cfg.turnCred });
  return out;
}

const peerOptions = () => {
  const cfg = getNetConfig();
  return {
    debug: 2 as const,
    config: { iceServers: iceServers(cfg) },
    ...(cfg.peerHost ? { host: cfg.peerHost, port: cfg.peerPort, path: cfg.peerPath, secure: cfg.peerSecure, key: cfg.peerKey } : {}),
  };
};

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
  /** Push a message to every connected phone (e.g. the channel directory). */
  broadcast(m: HostMsg): void;
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
  /** Called when a phone's channel opens — its return value is sent to that
   *  phone right away (the channel directory greeting). */
  hello?: () => HostMsg | null;
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
        const h = opts.hello?.();
        if (h) {
          try { conn.send(h); } catch { /* channel raced shut */ }
        }
      });
      conn.on('data', (d) => {
        const c = parseControl(d);
        if (!c) return; // malformed / unknown verb — drop, never crash the host
        if (c.t === 'hello') log(`hello from ${conn.peer}`);
        try {
          opts.onControl(c);
        } catch (err) {
          console.warn('[link] control handler failed', err);
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
      report();
    });
    // The signalling server dropped us (sleep, wifi hop). Data channels that
    // are already open keep working, but no NEW phone can find the room until
    // we re-register — so do, with a short backoff.
    peer.on('disconnected', () => {
      if (destroyed) return;
      log('signalling lost — re-registering room');
      setTimeout(() => {
        if (destroyed) return;
        try { peer.reconnect(); } catch { claim(); }
      }, 1000 + Math.random() * 1000);
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
    broadcast(m) {
      for (const c of conns) {
        if (!c.open) continue;
        try { c.send(m); } catch { /* mid-close */ }
      }
    },
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
  opts: { onStatus: (s: LinkStatus) => void; onMsg?: (m: HostMsg) => void; onLog?: Log },
): ClientHandle {
  const log = opts.onLog ?? noop;
  const targetId = peerIdFor(deviceId, code);
  const peer = new Peer(peerOptions());
  let conn: DataConnection | null = null;
  let attempts = 0;
  let destroyed = false;
  let warnedClosed = false;
  let redial: ReturnType<typeof setTimeout> | null = null;

  // A phone is pocketed, locked, walks out of range and comes back — many
  // times in one show. Keep dialing for as long as the page is open, with
  // backoff + jitter so five phones waking together don't hammer the room in
  // lock-step. `attempts` resets on every successful open, so the backoff
  // restarts small after each drop rather than growing for the whole night.
  const MAX_ATTEMPTS = 60;
  const scheduleRedial = (why: string) => {
    if (destroyed || redial) return;
    if (attempts >= MAX_ATTEMPTS) {
      log(`giving up after ${attempts} tries — tap connect to retry`);
      opts.onStatus('error');
      return;
    }
    const base = Math.min(15000, 1200 * Math.pow(1.5, Math.min(attempts, 8)));
    const wait = Math.round(base + Math.random() * 600);
    log(`${why} — redial in ${(wait / 1000).toFixed(1)}s`);
    redial = setTimeout(() => {
      redial = null;
      dial();
    }, wait);
  };

  const dial = () => {
    if (destroyed) return;
    if (peer.disconnected) {
      // signalling is down; reconnect() re-fires 'open', which dials again
      try { peer.reconnect(); } catch { /* destroyed */ }
      return;
    }
    attempts++;
    opts.onStatus('connecting');
    log(`dialing ${targetId} (try ${attempts})`);
    const c = peer.connect(targetId, { reliable: true });
    conn = c;
    c.on('open', () => {
      attempts = 0;
      warnedClosed = false;
      log('DATA CHANNEL OPEN ✓');
      watchIce(c, log);
      opts.onStatus('peer');
      c.send({ t: 'hello' } satisfies Control);
    });
    c.on('data', (d) => {
      const m = parseHostMsg(d);
      if (m) opts.onMsg?.(m);
    });
    c.on('close', () => {
      if (conn === c) conn = null;
      opts.onStatus('ready');
      scheduleRedial('data channel closed');
    });
    c.on('error', (e) => {
      log(`conn error: ${(e as Error).message ?? e}`);
      if (conn === c) conn = null;
      scheduleRedial('connection error');
    });
  };

  peer.on('open', (id) => {
    log(`phone ready id=${id}`);
    if (!conn || !conn.open) dial();
  });
  peer.on('disconnected', () => {
    if (destroyed) return;
    log('signalling lost — reconnecting');
    setTimeout(() => {
      if (destroyed) return;
      try { peer.reconnect(); } catch { /* destroyed */ }
    }, 800 + Math.random() * 800);
  });
  peer.on('error', (e) => {
    const type = (e as { type?: string }).type ?? '';
    log(`peer error: ${type} ${(e as Error).message ?? ''}`);
    console.warn('[link] client error', e);
    // 'peer-unavailable' → the console room isn't up yet (or the codes are
    // wrong). Keep trying: the console may simply be reloading.
    if (type === 'peer-unavailable' || type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') {
      scheduleRedial(type || 'peer error');
    } else {
      opts.onStatus('error');
    }
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
      if (redial) clearTimeout(redial);
      redial = null;
      conn?.close();
      peer.destroy();
    },
  };
}
