// ============================================================================
//  Remote controller link — pairs phones to a running console over WebRTC.
//
//  Touch, microphone and /cam controllers all use PeerJS from a static deploy
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
  | { t: 'master'; v: number } // master volume 0..1
  /** the FX matrix pad: x,y in -1..1 (center = dry), on=false on release.
   *  Quadrants: TL delay · TR reverb · BL high-pass · BR low-pass. */
  | { t: 'fx'; x: number; y: number; on: boolean };

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
    case 'fx': {
      const cl = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : null);
      const x = cl(r.x);
      const y = cl(r.y);
      return x === null || y === null ? null : { t: 'fx', x, y, on: r.on === true };
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

/** What a paired phone is allowed to change, set by the host's operator:
 *  play = motion only · fx = motion + the FX pad · full = also scene, tempo
 *  and master volume. Enforced on the host; sent to phones so they hide what
 *  they cannot use. */
export type PhonePerms = 'play' | 'fx' | 'full';
export const PHONE_PERMS: readonly PhonePerms[] = ['play', 'fx', 'full'];

/** Whether a verb is allowed under a permission level (hello always is). */
export function controlAllowed(perms: PhonePerms, t: Control['t']): boolean {
  switch (t) {
    case 'hello':
    case 'motion':
    case 'blow':
      return true;
    case 'fx':
      return perms !== 'play';
    default:
      return perms === 'full';
  }
}

export type HostMsg =
  | { t: 'channels'; list: ChannelAd[] }
  /** the host's real values, so a phone's sliders start (and stay) where the
   *  installation actually is instead of at their own defaults */
  | { t: 'state'; bpm: number; master: number; scene: string; perms: PhonePerms };

const CODE_RE = /^[A-Z0-9]{3,8}$/;

/** Validate a frame from the console — same reasoning as parseControl, in the
 *  other direction: the console may be a newer build than the phone. */
export function parseHostMsg(raw: unknown): HostMsg | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.t === 'state') {
    const fin = (v: unknown, fb: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fb);
    return {
      t: 'state',
      bpm: Math.round(fin(r.bpm, 120, 40, 220)),
      master: fin(r.master, 0.7, 0, 1),
      scene: typeof r.scene === 'string' && /^[a-z0-9_]{1,40}$/.test(r.scene) ? r.scene : '',
      perms: PHONE_PERMS.includes(r.perms as PhonePerms) ? (r.perms as PhonePerms) : 'full',
    };
  }
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
 * message any connected phone sends, with the sending phone's peer id (so a
 * host can keep several hands apart — see net/arbiter.ts); `onDrop` fires when
 * that phone goes away; `onStatus` tracks the link; `onPeers` reports the live
 * controller count; `onLog` streams a human-readable trace.
 */
export function startHost(opts: {
  deviceId?: string;
  code?: string;
  onControl: (c: Control, from: string) => void;
  onDrop?: (from: string) => void;
  onStatus: (s: LinkStatus) => void;
  onPeers?: (n: number) => void;
  onIdentity?: (deviceId: string, code: string) => void;
  /** Called when a phone's channel opens — what it returns is sent to that
   *  phone right away (the channel directory, the host's state). */
  hello?: () => HostMsg | HostMsg[] | null;
  onLog?: Log;
}): HostHandle {
  const log = opts.onLog ?? noop;
  let deviceId = opts.deviceId ?? randId(4);
  let code = opts.code ?? randId(4);
  let peer: Peer | null = null;
  let destroyed = false;
  let collisions = 0;
  let attempt = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const conns = new Set<DataConnection>();
  const pending = new Map<DataConnection, ReturnType<typeof setTimeout>>();
  const count = () => [...conns].filter((c) => c.open).length;
  const report = () => {
    const n = count();
    opts.onPeers?.(n);
    opts.onStatus(n ? 'peer' : peer?.open ? 'ready' : 'connecting');
  };
  const cancelRetry = () => { clearTimeout(retry); retry = undefined; };
  const watch = (p: Peer) => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      if (destroyed || p !== peer || p.open) return;
      if (!count()) { p.destroy(); peer = null; }
      schedule('signalling timed out');
    }, 15000);
  };
  const schedule = (why: string) => {
    if (destroyed || retry) return;
    if (!count()) opts.onStatus('connecting');
    const delay = Math.min(15000, 800 * 2 ** Math.min(attempt++, 5)) + Math.random() * 400;
    log(`${why} — reconnecting in ${(delay / 1000).toFixed(1)}s`);
    retry = setTimeout(() => {
      retry = undefined;
      if (destroyed) return;
      if (!peer || peer.destroyed) claim();
      else if (peer.disconnected) {
        try { peer.reconnect(); watch(peer); } catch { if (!count()) { peer.destroy(); peer = null; claim(); } else schedule('signalling unavailable'); }
      } else if (!peer.open) watch(peer);
    }, delay);
  };
  const claim = () => {
    if (destroyed) return;
    opts.onStatus('connecting');
    const p = new Peer(peerIdFor(deviceId, code), peerOptions());
    peer = p;
    watch(p);
    p.on('open', () => {
      if (destroyed || p !== peer) return;
      attempt = 0; cancelRetry(); clearTimeout(watchdog);
      opts.onIdentity?.(deviceId, code);
      log('host ready — waiting for a phone');
      report();
    });
    p.on('disconnected', () => {
      if (p !== peer || destroyed) return;
      report(); schedule('signalling lost');
    });
    p.on('error', (e) => {
      if (p !== peer || destroyed) return;
      const type = (e as { type?: string }).type ?? '';
      log(`host error: ${type} ${(e as Error).message ?? e}`);
      if (type === 'unavailable-id' && collisions++ < 6) {
        p.destroy(); peer = null;
        deviceId = randId(4); code = randId(4);
        opts.onIdentity?.(deviceId, code);
      } else if (!p.open && !count()) {
        p.destroy(); peer = null;
      }
      if (!count()) opts.onStatus('error');
      schedule(type || 'host error');
    });
    p.on('connection', (conn) => {
      if (destroyed || p !== peer) { conn.close(); return; }
      conns.add(conn);
      const drop = () => {
        clearTimeout(pending.get(conn)); pending.delete(conn);
        if (!conns.delete(conn)) return;
        opts.onDrop?.(conn.peer);
        if (!destroyed) report();
      };
      pending.set(conn, setTimeout(() => { if (!conn.open) { conn.close(); drop(); } }, 15000));
      conn.on('open', () => {
        if (destroyed || !conns.has(conn)) return;
        clearTimeout(pending.get(conn)); pending.delete(conn);
        watchIce(conn, log); report();
        const h = opts.hello?.();
        for (const m of h ? (Array.isArray(h) ? h : [h]) : []) {
          try { conn.send(m); } catch { /* channel raced shut */ }
        }
      });
      conn.on('data', (d) => {
        if (destroyed || !conn.open) return;
        const c = parseControl(d);
        if (!c) return;
        try { opts.onControl(c, conn.peer); } catch (err) { log(`control failed: ${String(err)}`); }
      });
      conn.on('close', drop);
      conn.on('error', () => { drop(); conn.close(); });
    });
  };
  const offWake = watchNetworkWake(() => {
    if (destroyed || peer?.open) return;
    cancelRetry(); attempt = 0; schedule('network available');
  });
  claim();
  return {
    get deviceId() { return deviceId; },
    get code() { return code; },
    peerCount: count,
    broadcast(m) { for (const c of conns) if (c.open) { try { c.send(m); } catch { /* mid-close */ } } },
    destroy() {
      destroyed = true;
      cancelRetry(); clearTimeout(watchdog); offWake();
      pending.forEach(clearTimeout); pending.clear();
      for (const c of [...conns]) c.close();
      conns.clear(); peer?.destroy(); peer = null;
    },
  };
}

/** Re-arm networking after sleep or a Wi-Fi change; no listeners survive unmount. */
function watchNetworkWake(wake: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const visible = () => { if (document.visibilityState === 'visible') wake(); };
  window.addEventListener('online', wake);
  document.addEventListener('visibilitychange', visible);
  return () => { window.removeEventListener('online', wake); document.removeEventListener('visibilitychange', visible); };
}

export interface ClientHandle {
  send(c: Control): void;
  destroy(): void;
}

/**
 * Phone side: connect to the console's room. Retries with backoff so a phone that
 * loads before the console is ready (or across a slow TURN handshake) still lands.
 */
export function connectHost(
  deviceId: string,
  code: string,
  opts: { onStatus: (s: LinkStatus) => void; onMsg?: (m: HostMsg) => void; onLog?: Log },
): ClientHandle {
  const log = opts.onLog ?? noop;
  const targetId = peerIdFor(deviceId, code);
  let peer: Peer | null = null;
  let conn: DataConnection | null = null;
  let destroyed = false;
  let attempts = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let handshake: ReturnType<typeof setTimeout> | undefined;
  const cancelRetry = () => { clearTimeout(retry); retry = undefined; };
  const schedule = (why: string) => {
    if (destroyed || retry) return;
    if (!conn?.open) opts.onStatus('connecting');
    const delay = Math.min(15000, 800 * 2 ** Math.min(attempts++, 5)) + Math.random() * 400;
    log(`${why} — reconnecting in ${(delay / 1000).toFixed(1)}s`);
    retry = setTimeout(() => { retry = undefined; recover(); }, delay);
  };
  const watch = (p: Peer) => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      if (destroyed || p !== peer || p.open) return;
      if (!conn?.open) { p.destroy(); peer = null; }
      schedule('signalling timed out');
    }, 15000);
  };
  const dial = () => {
    if (destroyed || !peer?.open || conn) return;
    opts.onStatus('connecting');
    const c = peer.connect(targetId, { reliable: true });
    conn = c;
    const drop = (why: string) => {
      if (destroyed || conn !== c) return;
      conn = null; clearTimeout(handshake); c.close();
      schedule(why);
    };
    handshake = setTimeout(() => drop('data connection timed out'), 15000);
    c.on('open', () => {
      if (destroyed || conn !== c) { c.close(); return; }
      clearTimeout(handshake); attempts = 0; cancelRetry();
      watchIce(c, log); opts.onStatus('peer');
      c.send({ t: 'hello' } satisfies Control);
    });
    c.on('data', (d) => { if (conn !== c || destroyed) return; const m = parseHostMsg(d); if (m) opts.onMsg?.(m); });
    c.on('close', () => drop('data channel closed'));
    c.on('error', () => drop('data connection error'));
  };
  const create = () => {
    const p = new Peer(peerOptions());
    peer = p; watch(p);
    p.on('open', () => { if (destroyed || p !== peer) return; clearTimeout(watchdog); cancelRetry(); dial(); });
    p.on('disconnected', () => { if (!destroyed && p === peer) schedule('signalling lost'); });
    p.on('error', (e) => {
      if (destroyed || p !== peer) return;
      const type = (e as { type?: string }).type ?? '';
      log(`peer error: ${type} ${(e as Error).message ?? e}`);
      if (!conn?.open) {
        const old = conn; conn = null; clearTimeout(handshake); old?.close();
        if (!p.open) { p.destroy(); peer = null; }
      }
      schedule(type || 'peer error');
    });
  };
  const recover = () => {
    if (destroyed) return;
    if (!peer || peer.destroyed) create();
    else if (peer.disconnected) {
      try { peer.reconnect(); watch(peer); } catch { if (!conn?.open) { peer.destroy(); peer = null; create(); } else schedule('signalling unavailable'); }
    } else if (peer.open) dial();
    else watch(peer);
  };
  const offWake = watchNetworkWake(() => { if (!conn?.open || !peer?.open) { cancelRetry(); attempts = 0; recover(); } });
  create();
  return {
    send(c) { if (conn?.open) { try { conn.send(c); } catch { conn.close(); } } },
    destroy() {
      destroyed = true;
      cancelRetry(); clearTimeout(watchdog); clearTimeout(handshake); offWake();
      conn?.close(); conn = null; peer?.destroy(); peer = null;
    },
  };
}
