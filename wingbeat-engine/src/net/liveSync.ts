// ============================================================================
//  Live conductor sync — every device that runs an engine (the console, the
//  /feather displays) calls useConductorSync. It fetches the current live
//  state on mount, subscribes to changes, and applies pushes immediately:
//
//    · loads the rig (per-sensor motion / sensitivity / envelopes + global
//      reaction) and persists it as the feather's "last" so Projection's own
//      per-feather recall agrees with the conductor
//    · switches the feather + scene
//    · downloads (cache-first) and installs each sensor's loop sample
//
//  Loop installation needs a running audio context; until "Start audio" is
//  pressed the samples are prefetched into the cache and installed the moment
//  the engine reports audioReady.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import type { WingbeatEngine } from '../engine/WingbeatEngine.ts';
import type { AudioEngine } from '../engine/AudioEngine.ts';
import { loadIntoRig, notifyLayersChange } from '../sim/rig.ts';
import { saveLast } from '../sim/presets.ts';
import { setFeatherScene } from '../sim/featherScenes.ts';
import { SENSOR_CHANNELS } from '../sim/channels.ts';
import { getLive, onLiveChange, fetchSampleBuffer, validateConductorConfig, type ConductorConfig, type LiveState, type LiveSubStatus, type SampleRef } from './cloud.ts';

export type SensorSamples = Record<string, SampleRef | null>;

// Only the NEWEST install run may touch the loops: two pushes in quick
// succession used to interleave (config A's sensor_03 landing after config
// B's), and a slow download for one sensor blocked the rest. Each run takes a
// generation number and stops as soon as a newer one starts.
let loopGen = 0;
let lastSamples: SensorSamples = {};

/** The sensor→sample map most recently applied on this device (for presets). */
export function lastAppliedSamples(): SensorSamples {
  return { ...lastSamples };
}

async function applyLoops(samples: SensorSamples | undefined, audio: AudioEngine): Promise<void> {
  const gen = ++loopGen;
  lastSamples = { ...(samples ?? {}) };
  // kick off every download at once (cache-first, deduped in cloud.ts), then
  // install in channel order as each arrives
  const fetches = SENSOR_CHANNELS.map((c) => {
    const ref = samples?.[c.sensor] ?? null;
    return ref ? fetchSampleBuffer(ref).then((buf) => ({ ref, buf })).catch((err: unknown) => ({ ref, err })) : Promise.resolve(null);
  });
  for (let i = 0; i < SENSOR_CHANNELS.length; i++) {
    const sensor = SENSOR_CHANNELS[i].sensor;
    const r = await fetches[i];
    if (gen !== loopGen) return; // superseded — a newer push owns the loops now
    try {
      if (!r) {
        audio.clearLoop(sensor);
        continue;
      }
      if ('err' in r) throw r.err;
      await audio.loadLoopBuffer(sensor, r.buf, r.ref.name);
    } catch (err) {
      console.warn('[wingbeat] conductor loop failed for', sensor, err);
    }
  }
}

/** Install a sensor→sample map now, or the moment audio is unlocked. Used by
 *  conductor pushes and by local preset recall (v2 presets carry SampleRefs). */
export function applySensorSamples(engine: WingbeatEngine, audio: AudioEngine, samples: SensorSamples | undefined): void {
  if (audio.ready) {
    void applyLoops(samples, audio);
  } else {
    for (const ref of Object.values(samples ?? {})) if (ref) fetchSampleBuffer(ref).catch(() => {});
    const off = engine.on('audioReady', () => {
      off();
      void applyLoops(samples, audio);
    });
  }
}

export interface ConductorSyncOpts {
  engine: WingbeatEngine;
  audio: AudioEngine;
  /** Called with the feather id a push targets (drive your feather state with it). */
  onFeather?: (id: string) => void;
}

/** Apply a conductor config to a local engine+audio pair — the same steps a
 *  live push runs, callable directly (e.g. picking a saved preset on
 *  /experience). If audio isn't unlocked yet the loops are prefetched and
 *  installed the moment the engine reports audioReady. */
export function applyConductorConfig(
  engine: WingbeatEngine,
  audio: AudioEngine,
  cfg: ConductorConfig,
  onFeather?: (id: string) => void,
): void {
  const preset = cfg.preset;
  if (!preset) return;
  loadIntoRig(preset);
  if (preset.feather) saveLast(preset.feather);
  audio.setBpm(preset.global?.bpm ?? 120);
  // Scene lives in featherScenes (the source of truth the console's
  // feather→scene effect reads). Writing it there FIRST means the feather
  // switch below lands on the pushed scene instead of reverting to the
  // feather's old one — the "remote scene changes revert" bug.
  if (cfg.scene && preset.feather) setFeatherScene(preset.feather, cfg.scene);
  if (preset.feather) onFeather?.(preset.feather);
  if (cfg.scene) engine.setScene(cfg.scene);
  notifyLayersChange();
  applySensorSamples(engine, audio, cfg.sensorSamples);
}

/** Returns the realtime channel's state so the UI can say whether this
 *  device would actually hear a push ("pushed ✓" on the conductor is not
 *  proof that anyone received it). */
export function useConductorSync({ engine, audio, onFeather }: ConductorSyncOpts): LiveSubStatus {
  // Refs so the subscription effect doesn't rebind on each render.
  const onFeatherRef = useRef(onFeather);
  onFeatherRef.current = onFeather;
  const lastApplied = useRef('');
  const [status, setStatus] = useState<LiveSubStatus>('subscribing');

  useEffect(() => {
    let disposed = false;

    const apply = (live: LiveState | null) => {
      if (disposed || !live?.config?.preset) return;
      // updated_at is stamped by the server (RPC), so it is monotonic across
      // devices — a strictly-newer check also rejects a stale row re-delivered
      // after a reconnect, which plain inequality let through.
      const at = live.updated_at ?? '';
      if (at && lastApplied.current && at <= lastApplied.current) return;
      lastApplied.current = at;
      const cfg = validateConductorConfig(live.config);
      if (!cfg) {
        console.warn('[wingbeat] ignoring malformed live config');
        return;
      }
      applyConductorConfig(engine, audio, cfg, (id) => onFeatherRef.current?.(id));
    };

    getLive().then(apply).catch(() => {});
    // Every time the realtime channel (re)connects, re-read the row: a push
    // that happened while this device was offline would otherwise be missed
    // until the next one, and `apply` dedupes by updated_at so it's cheap.
    const offLive = onLiveChange(apply, (s) => {
      setStatus(s);
      if (s === 'live') getLive().then(apply).catch(() => {});
    });
    // Laptop lid closed, phone pocketed, wifi hopped: the realtime socket may
    // or may not come back on its own. Re-read the row whenever we regain the
    // network or the tab — cheap, idempotent (dedup above), and it closes the
    // "pushed while we were asleep" gap.
    const rearm = () => {
      if (document.visibilityState === 'hidden') return;
      getLive().then(apply).catch(() => {});
    };
    window.addEventListener('online', rearm);
    document.addEventListener('visibilitychange', rearm);

    return () => {
      disposed = true;
      offLive();
      window.removeEventListener('online', rearm);
      document.removeEventListener('visibilitychange', rearm);
    };
  }, [engine, audio]);
  return status;
}
