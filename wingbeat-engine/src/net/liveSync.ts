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

import { useEffect, useRef } from 'react';
import type { WingbeatEngine } from '../engine/WingbeatEngine.ts';
import type { AudioEngine } from '../engine/AudioEngine.ts';
import { loadIntoRig, notifyLayersChange } from '../sim/rig.ts';
import { saveLast } from '../sim/presets.ts';
import { SENSOR_CHANNELS } from '../sim/channels.ts';
import { getLive, onLiveChange, fetchSampleBuffer, type ConductorConfig, type LiveState } from './cloud.ts';

async function applyLoops(cfg: ConductorConfig, audio: AudioEngine): Promise<void> {
  for (const c of SENSOR_CHANNELS) {
    const ref = cfg.sensorSamples?.[c.sensor] ?? null;
    try {
      if (!ref) {
        audio.clearLoop(c.sensor);
        continue;
      }
      const buf = await fetchSampleBuffer(ref);
      await audio.loadLoopBuffer(c.sensor, buf, ref.name);
    } catch (err) {
      console.warn('[wingbeat] conductor loop failed for', c.sensor, err);
    }
  }
}

/** Prefetch all of a config's samples into the IndexedDB cache (no audio needed). */
function prefetch(cfg: ConductorConfig): void {
  for (const ref of Object.values(cfg.sensorSamples ?? {})) {
    if (ref) fetchSampleBuffer(ref).catch(() => {});
  }
}

export interface ConductorSyncOpts {
  engine: WingbeatEngine;
  audio: AudioEngine;
  /** Called with the feather id a push targets (drive your feather state with it). */
  onFeather?: (id: string) => void;
}

export function useConductorSync({ engine, audio, onFeather }: ConductorSyncOpts): void {
  // Refs so the subscription effect doesn't rebind on each render.
  const onFeatherRef = useRef(onFeather);
  onFeatherRef.current = onFeather;
  const pendingLoops = useRef<ConductorConfig | null>(null);
  const lastApplied = useRef('');

  useEffect(() => {
    let disposed = false;

    const apply = (live: LiveState | null) => {
      if (disposed || !live?.config?.preset) return;
      if (live.updated_at && live.updated_at === lastApplied.current) return;
      lastApplied.current = live.updated_at ?? '';
      const cfg = live.config;
      const preset = cfg.preset;

      loadIntoRig(preset);
      // Persist as this feather's "last" so Projection's per-feather recall
      // (which runs on every feather switch) re-applies the SAME config.
      if (preset.feather) saveLast(preset.feather);
      audio.setBpm(preset.global?.bpm ?? 120);
      if (cfg.scene) engine.setScene(cfg.scene);
      if (preset.feather) onFeatherRef.current?.(preset.feather);
      notifyLayersChange();

      if (audio.ready) {
        pendingLoops.current = null;
        void applyLoops(cfg, audio);
      } else {
        // audio not unlocked yet — warm the cache now, install on audioReady
        pendingLoops.current = cfg;
        prefetch(cfg);
      }
    };

    getLive().then(apply).catch(() => {});
    const offLive = onLiveChange(apply);
    const offReady = engine.on('audioReady', () => {
      const cfg = pendingLoops.current;
      if (cfg) {
        pendingLoops.current = null;
        void applyLoops(cfg, audio);
      }
    });

    return () => {
      disposed = true;
      offLive();
      offReady();
    };
  }, [engine, audio]);
}
