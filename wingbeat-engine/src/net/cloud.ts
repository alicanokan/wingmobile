// ============================================================================
//  Cloud database for the Wing Beat installation (Supabase).
//
//    wingbeat_samples  — the audio-file library (bytes live in Storage)
//    wingbeat_presets  — named conductor presets, one per (feather, name)
//    wingbeat_live     — a single row: what the conductor has pushed to the
//                        whole installation. Every device subscribes to it.
//
//  Downloads go through the IndexedDB cache (sampleCache.ts) so devices keep
//  playing if the venue's internet drops mid-performance.
// ============================================================================

import { supabase, SUPABASE_URL } from './supabaseClient.ts';
import { cacheGet, cachePut, cacheDelete } from './sampleCache.ts';
import { validatePreset, type FeatherPreset } from '../sim/rig.ts';

const BUCKET = 'wingbeat-samples';

// ---- Conductor secret --------------------------------------------------------
//
// Reads are public; every WRITE goes through a SECURITY DEFINER function in
// Postgres that checks this secret, so a random visitor to the deployed site
// cannot push config to the installation or touch the library. The secret is
// entered once on the conducting device and kept in localStorage.

const SECRET_KEY = 'wb.conductorSecret.v1';

export function getConductorSecret(): string {
  try {
    return localStorage.getItem(SECRET_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setConductorSecret(secret: string): void {
  try {
    localStorage.setItem(SECRET_KEY, secret.trim());
  } catch { /* private mode — secret lives for the session only */ }
}

/** Map an RPC failure to something an operator can act on mid-show. */
function writeError(prefix: string, error: { message?: string } | null): Error {
  const msg = error?.message ?? 'unknown error';
  return new Error(
    msg.includes('bad conductor secret')
      ? `${prefix}: this device is missing the conductor secret — paste it in the Live bar on /conductor`
      : `${prefix}: ${msg}`,
  );
}

// ---- Samples ---------------------------------------------------------------

export interface CloudSample {
  id: string;
  name: string;
  feather: string | null;
  storage_path: string;
  mime: string | null;
  size_bytes: number | null;
  created_at: string;
}

/** Everything a device needs to fetch + label a sample, denormalized into the
 *  live config so applying it costs zero extra queries. */
export interface SampleRef {
  id: string;
  name: string;
  path: string;
  /** byte length as registered — lets a device reject a truncated or
   *  captive-portal download instead of caching it forever */
  size?: number;
}

export const sampleRef = (s: CloudSample): SampleRef => ({
  id: s.id,
  name: s.name,
  path: s.storage_path,
  ...(typeof s.size_bytes === 'number' && s.size_bytes > 0 ? { size: s.size_bytes } : {}),
});

// ---- Device identity ---------------------------------------------------------
// A stable per-browser id, stamped into every live push as `origin`. Today it
// only makes the live row attributable ("which laptop pushed this?"); it is
// the hook that stops echo loops if devices ever write back.
const CLIENT_KEY = 'wb.clientId.v1';
let clientIdMemo = '';
export function clientId(): string {
  if (clientIdMemo) return clientIdMemo;
  try {
    clientIdMemo = localStorage.getItem(CLIENT_KEY) ?? '';
    if (!/^[a-z0-9-]{8,}$/.test(clientIdMemo)) {
      clientIdMemo = crypto.randomUUID();
      localStorage.setItem(CLIENT_KEY, clientIdMemo);
    }
  } catch {
    clientIdMemo = clientIdMemo || crypto.randomUUID();
  }
  return clientIdMemo;
}

export async function listSamples(): Promise<CloudSample[]> {
  const { data, error } = await supabase
    .from('wingbeat_samples')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Couldn't list samples: ${error.message}`);
  return (data ?? []) as CloudSample[];
}

export async function uploadSample(file: File, feather: string | null = null): Promise<CloudSample> {
  const safe = file.name.replace(/[^\w.\-]+/g, '_');
  const path = `${crypto.randomUUID()}-${safe}`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'audio/mpeg',
  });
  if (upErr) throw new Error(`Upload failed for "${file.name}": ${upErr.message}`);
  // Registering the row is what puts a sample in the library — that's the
  // secret-gated step. (A junk upload without the secret never becomes
  // visible to any device.)
  const { data, error } = await supabase.rpc('wingbeat_register_sample', {
    p_secret: getConductorSecret(),
    p_name: file.name,
    p_feather: feather,
    p_path: path,
    p_mime: file.type || null,
    p_size: file.size,
  });
  if (error) throw writeError(`Couldn't register "${file.name}"`, error);
  return data as CloudSample;
}

export async function deleteSample(s: CloudSample): Promise<void> {
  // Best-effort direct removal (works until the lockdown migration drops the
  // public delete policy); the RPC also removes the storage object row.
  await supabase.storage.from(BUCKET).remove([s.storage_path]);
  const { error } = await supabase.rpc('wingbeat_delete_sample', {
    p_secret: getConductorSecret(),
    p_id: s.id,
  });
  if (error) throw writeError(`Couldn't delete "${s.name}"`, error);
  await cacheDelete(s.id);
}

export function sampleUrl(pathOrRef: string | SampleRef): string {
  const path = typeof pathOrRef === 'string' ? pathOrRef : pathOrRef.path;
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

/** Bytes of a sample — IndexedDB cache first, then Storage (and cache it). */
/** A sample download that hangs (venue wifi, captive portal) must not block
 *  the remaining loops forever — liveSync installs loops one after another. */
const FETCH_TIMEOUT_MS = 20000;

// One download per sample id at a time: a push that maps the same sample to
// three sensors, or a preset recall racing a push, shares one fetch.
const inflight = new Map<string, Promise<ArrayBuffer>>();

export function fetchSampleBuffer(ref: SampleRef): Promise<ArrayBuffer> {
  const running = inflight.get(ref.id);
  if (running) return running;
  const p = fetchSampleBufferOnce(ref).finally(() => inflight.delete(ref.id));
  inflight.set(ref.id, p);
  return p;
}

async function fetchSampleBufferOnce(ref: SampleRef): Promise<ArrayBuffer> {
  const cached = await cacheGet(ref.id);
  if (cached && (!ref.size || cached.byteLength === ref.size)) return cached;
  if (cached) await cacheDelete(ref.id); // a cached blob of the wrong length is poison
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(sampleUrl(ref), { signal: ctl.signal });
  } catch (err) {
    throw new Error(
      ctl.signal.aborted
        ? `Timed out downloading "${ref.name}" after ${FETCH_TIMEOUT_MS / 1000}s`
        : `Couldn't download "${ref.name}": ${(err as Error).message ?? err}`,
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`Couldn't download "${ref.name}" (${res.status})`);
  // A captive portal answers any URL with 200 + an HTML login page. Cached
  // blindly, that page became the sample on this device until someone
  // cleared site data.
  const type = (res.headers.get('content-type') ?? '').toLowerCase();
  if (type.startsWith('text/html')) throw new Error(`"${ref.name}" came back as a web page — captive portal or wrong URL?`);
  const buf = await res.arrayBuffer();
  if (ref.size && buf.byteLength !== ref.size) {
    throw new Error(`"${ref.name}" downloaded ${buf.byteLength} bytes, expected ${ref.size} — not caching`);
  }
  if (buf.byteLength < 64) throw new Error(`"${ref.name}" is empty`);
  await cachePut(ref.id, buf);
  return buf;
}

// ---- Conductor presets -------------------------------------------------------

/** Everything the conductor sets for one feather, as one recallable unit. */
export const CONDUCTOR_CONFIG_VERSION = 1;

export interface ConductorConfig {
  /** schema version — devices refuse what they don't understand rather than guess */
  v?: number;
  /** clientId() of the device that pushed it */
  origin?: string;
  /** The full rig: per-sensor motion/reach/attack/release/sensitivity/layers + global reaction. */
  preset: FeatherPreset;
  /** sensorId → which library sample loops on that sensor (null = none). */
  sensorSamples: Record<string, SampleRef | null>;
  /** Optional culture-scene override for this feather. */
  scene?: string;
}

/** Coerce a live/preset blob into a valid ConductorConfig, or null if it is
 *  not one at all (no preset) or from a future schema. */
export function validateConductorConfig(raw: unknown): ConductorConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.v === 'number' && r.v > CONDUCTOR_CONFIG_VERSION) {
    console.warn(`[wingbeat] live config is schema v${r.v}; this build understands v${CONDUCTOR_CONFIG_VERSION}`);
    return null;
  }
  if (!r.preset || typeof r.preset !== 'object') return null;
  const sensorSamples: Record<string, SampleRef | null> = {};
  if (r.sensorSamples && typeof r.sensorSamples === 'object') {
    for (const [k, v] of Object.entries(r.sensorSamples as Record<string, unknown>)) {
      if (v === null) { sensorSamples[k] = null; continue; }
      if (!v || typeof v !== 'object') continue;
      const x = v as Record<string, unknown>;
      if (typeof x.id === 'string' && typeof x.name === 'string' && typeof x.path === 'string' && !x.path.includes('..')) {
        sensorSamples[k] = { id: x.id, name: x.name, path: x.path, ...(typeof x.size === 'number' && x.size > 0 ? { size: x.size } : {}) };
      }
    }
  }
  return {
    v: typeof r.v === 'number' ? r.v : 0,
    ...(typeof r.origin === 'string' ? { origin: r.origin } : {}),
    preset: validatePreset(r.preset),
    sensorSamples,
    ...(typeof r.scene === 'string' ? { scene: r.scene } : {}),
  };
}

export interface CloudPreset {
  id: string;
  name: string;
  feather: string;
  config: ConductorConfig;
  updated_at: string;
}

export async function listCloudPresets(feather?: string): Promise<CloudPreset[]> {
  let q = supabase.from('wingbeat_presets').select('*').order('updated_at', { ascending: false });
  if (feather) q = q.eq('feather', feather);
  const { data, error } = await q;
  if (error) throw new Error(`Couldn't list presets: ${error.message}`);
  return (data ?? []) as CloudPreset[];
}

export async function saveCloudPreset(name: string, feather: string, config: ConductorConfig): Promise<CloudPreset> {
  const { data, error } = await supabase.rpc('wingbeat_save_preset', {
    p_secret: getConductorSecret(),
    p_name: name,
    p_feather: feather,
    p_config: config,
  });
  if (error) throw writeError(`Couldn't save preset "${name}"`, error);
  return data as CloudPreset;
}

export async function deleteCloudPreset(id: string): Promise<void> {
  const { error } = await supabase.rpc('wingbeat_delete_preset', {
    p_secret: getConductorSecret(),
    p_id: id,
  });
  if (error) throw writeError(`Couldn't delete preset`, error);
}

// ---- Live state ---------------------------------------------------------------

export interface LiveState {
  id: number;
  feather: string | null;
  preset_id: string | null;
  config: ConductorConfig | null;
  updated_at: string;
}

export async function getLive(): Promise<LiveState | null> {
  const { data, error } = await supabase.from('wingbeat_live').select('*').eq('id', 1).maybeSingle();
  if (error) return null;
  return (data as LiveState) ?? null;
}

/** Push a conductor config to the whole installation. Every connected device
 *  (console, /feather displays, phones through the console) applies it live. */
export async function pushLive(feather: string, config: ConductorConfig, presetId: string | null = null): Promise<void> {
  // Server stamps updated_at (now()), so ordering no longer depends on the
  // conducting laptop's clock.
  const { error } = await supabase.rpc('wingbeat_push_live', {
    p_secret: getConductorSecret(),
    p_feather: feather,
    p_config: { ...config, v: CONDUCTOR_CONFIG_VERSION, origin: clientId() } satisfies ConductorConfig,
    p_preset_id: presetId,
  });
  if (error) throw writeError(`Couldn't push live`, error);
}

export type LiveSubStatus = 'subscribing' | 'live' | 'error' | 'closed';

/** Subscribe to live-state changes. Returns an unsubscribe function.
 *  `onStatus` reports whether the realtime channel is actually delivering —
 *  a device that silently never subscribed used to look identical to one
 *  that simply hadn't been pushed to yet. */
export function onLiveChange(cb: (live: LiveState) => void, onStatus?: (s: LiveSubStatus) => void): () => void {
  onStatus?.('subscribing');
  const channel = supabase
    .channel('wingbeat-live')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'wingbeat_live' },
      (payload) => {
        if (payload.new && typeof payload.new === 'object') cb(payload.new as LiveState);
      },
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') onStatus?.('live');
      else if (status === 'CLOSED') onStatus?.('closed');
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('[wingbeat] live subscription', status);
        onStatus?.('error');
      }
    });
  return () => {
    supabase.removeChannel(channel);
  };
}
