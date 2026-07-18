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
import type { FeatherPreset } from '../sim/rig.ts';

const BUCKET = 'wingbeat-samples';

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
}

export const sampleRef = (s: CloudSample): SampleRef => ({ id: s.id, name: s.name, path: s.storage_path });

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
  const { data, error } = await supabase
    .from('wingbeat_samples')
    .insert({ name: file.name, feather, storage_path: path, mime: file.type || null, size_bytes: file.size })
    .select()
    .single();
  if (error) throw new Error(`Couldn't register "${file.name}": ${error.message}`);
  return data as CloudSample;
}

export async function deleteSample(s: CloudSample): Promise<void> {
  await supabase.storage.from(BUCKET).remove([s.storage_path]);
  await supabase.from('wingbeat_samples').delete().eq('id', s.id);
  await cacheDelete(s.id);
}

export function sampleUrl(pathOrRef: string | SampleRef): string {
  const path = typeof pathOrRef === 'string' ? pathOrRef : pathOrRef.path;
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

/** Bytes of a sample — IndexedDB cache first, then Storage (and cache it). */
export async function fetchSampleBuffer(ref: SampleRef): Promise<ArrayBuffer> {
  const cached = await cacheGet(ref.id);
  if (cached) return cached;
  const res = await fetch(sampleUrl(ref));
  if (!res.ok) throw new Error(`Couldn't download "${ref.name}" (${res.status})`);
  const buf = await res.arrayBuffer();
  await cachePut(ref.id, buf);
  return buf;
}

// ---- Conductor presets -------------------------------------------------------

/** Everything the conductor sets for one feather, as one recallable unit. */
export interface ConductorConfig {
  /** The full rig: per-sensor motion/reach/attack/release/sensitivity/layers + global reaction. */
  preset: FeatherPreset;
  /** sensorId → which library sample loops on that sensor (null = none). */
  sensorSamples: Record<string, SampleRef | null>;
  /** Optional culture-scene override for this feather. */
  scene?: string;
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
  const { data, error } = await supabase
    .from('wingbeat_presets')
    .upsert({ name, feather, config, updated_at: new Date().toISOString() }, { onConflict: 'feather,name' })
    .select()
    .single();
  if (error) throw new Error(`Couldn't save preset "${name}": ${error.message}`);
  return data as CloudPreset;
}

export async function deleteCloudPreset(id: string): Promise<void> {
  await supabase.from('wingbeat_presets').delete().eq('id', id);
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
  const { error } = await supabase
    .from('wingbeat_live')
    .upsert({ id: 1, feather, preset_id: presetId, config, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Couldn't push live: ${error.message}`);
}

/** Subscribe to live-state changes. Returns an unsubscribe function. */
export function onLiveChange(cb: (live: LiveState) => void): () => void {
  const channel = supabase
    .channel('wingbeat-live')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'wingbeat_live' },
      (payload) => {
        if (payload.new && typeof payload.new === 'object') cb(payload.new as LiveState);
      },
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
