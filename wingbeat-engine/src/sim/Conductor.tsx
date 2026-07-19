// ============================================================================
//  /conductor — the preset generator for the whole installation.
//
//  Pick a feather, then decide for each of its 5 sensors:
//    · which SAMPLE loops on that sensor (from the shared cloud library)
//    · what the sensor AFFECTS (motion shape, feather layers, EQ band, color)
//    · its SENSITIVITY (input gain on the incoming level)
//    · its envelope (attack / release) and reach
//  plus the feather's global REACTION (sway, wing beat, gravity, tempo …).
//
//  Everything saves as named presets in the cloud database, and "Push live"
//  (or Live mode) applies the config instantly on every connected device —
//  the console, /feather displays, and through them the paired phones.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './ui.css';
import './conductor.css';
import { FEATHERS, DEFAULT_FEATHER } from './feathers.ts';
import { SENSOR_CHANNELS } from './channels.ts';
import { SCENES } from '../engine/scenes.ts';
import { WingbeatEngine } from '../engine/WingbeatEngine.ts';
import { AudioEngine } from '../engine/AudioEngine.ts';
import { SimTransport } from '../transports/SimTransport.ts';
import { Projection } from './Projection.tsx';
import { EqEditor } from './EqEditor.tsx';
import { useTheme } from './theme.ts';
import {
  defaultPreset,
  loadIntoRig,
  MAX_LAYERS,
  MOTION_TYPES,
  MOTION_LABELS,
  AUDIO_BANDS,
  AUDIO_BAND_LABELS,
  audioRouteTargets,
  type SensorRig,
} from './rig.ts';
import {
  listSamples,
  uploadSample,
  deleteSample,
  sampleUrl,
  sampleRef,
  fetchSampleBuffer,
  listCloudPresets,
  saveCloudPreset,
  deleteCloudPreset,
  getLive,
  pushLive,
  onLiveChange,
  type CloudSample,
  type CloudPreset,
  type ConductorConfig,
} from '../net/cloud.ts';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const rgbToHex = (rgb: [number, number, number]) =>
  '#' + rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
const hexToRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];

function Slider({
  label, value, min, max, step, onChange, fmt,
}: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; fmt?: (v: number) => string;
}) {
  return (
    <label className="cond-slider">
      <span className="cond-slider-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="cond-slider-val">{fmt ? fmt(value) : value.toFixed(2)}</span>
    </label>
  );
}

/** Live audio meter — polls the preview engine each frame (imperative, no
 *  per-frame React render). `mode: 'input'` shows the sample's raw level
 *  (pre-EQ); `mode: 'filtered'` shows the post-EQ band level (or the full
 *  level when EQ is bypassed). Always live while a loop is loaded — the audio
 *  input keeps arriving whether or not the part has been pulsed. */
function LiveMeter({
  audio, sensorId, mode, band, range, eqOn, label,
}: {
  audio: AudioEngine; sensorId: string; mode: 'input' | 'filtered';
  band: SensorRig['audioBand']; range?: [number, number]; eqOn: boolean;
  label: string;
}) {
  const fillRef = useRef<HTMLDivElement | null>(null);
  const valRef = useRef<HTMLSpanElement | null>(null);
  const rafRef = useRef(0);
  useEffect(() => {
    const tick = () => {
      let v = 0;
      if (audio.ready) {
        if (mode === 'input') v = audio.getLoopLevel(sensorId);
        else if (!eqOn) v = audio.getLoopLevel(sensorId);
        else if (band === 'custom' && range) v = audio.getLoopBandRange(sensorId, range[0], range[1]);
        else v = audio.getLoopBand(sensorId, band === 'custom' ? 'full' : band);
      }
      if (fillRef.current) fillRef.current.style.width = `${Math.round(Math.min(1, v) * 100)}%`;
      if (valRef.current) valRef.current.textContent = v.toFixed(2);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [audio, sensorId, mode, band, range, eqOn]);
  return (
    <div className={`cond-meter cond-meter-${mode}`}>
      <span className="cond-meter-label">{label}</span>
      <div className="cond-meter-bar"><div ref={fillRef} className="cond-meter-fill" /></div>
      <span ref={valRef} className="cond-meter-val">0.00</span>
    </div>
  );
}

/** How much balloon air a part is holding — i.e. how hard it's been pulsed.
 *  Reads the live ref each frame rather than re-rendering React. */
function AirMeter({ airRef, sensorId }: { airRef: React.RefObject<Record<string, number>>; sensorId: string }) {
  const fillRef = useRef<HTMLDivElement | null>(null);
  const valRef = useRef<HTMLSpanElement | null>(null);
  const rafRef = useRef(0);
  useEffect(() => {
    const tick = () => {
      const a = airRef.current?.[sensorId] ?? 0;
      if (fillRef.current) fillRef.current.style.width = `${Math.round(Math.min(1, a) * 100)}%`;
      if (valRef.current) valRef.current.textContent = a.toFixed(2);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [airRef, sensorId]);
  return (
    <div className="cond-air">
      <span className="cond-air-label">Pulse air</span>
      <div className="cond-air-bar"><div ref={fillRef} className="cond-air-fill" /></div>
      <span ref={valRef} className="cond-air-val">0.00</span>
    </div>
  );
}

/** The audio channel(s) routed INTO this part, with the live filtered level
 *  they're feeding it (loudest wins, matching the engine's router). */
function RoutedAudioIn({
  audio, sources,
}: {
  audio: AudioEngine;
  sources: { id: string; label: string; eqOn: boolean; band: SensorRig['audioBand']; range?: [number, number] }[];
}) {
  const fillRef = useRef<HTMLDivElement | null>(null);
  const valRef = useRef<HTMLSpanElement | null>(null);
  const rafRef = useRef(0);
  const srcRef = useRef(sources);
  srcRef.current = sources; // always read the latest routing without resubscribing
  useEffect(() => {
    const tick = () => {
      let v = 0;
      if (audio.ready) {
        for (const s of srcRef.current) {
          const x = !s.eqOn
            ? audio.getLoopLevel(s.id)
            : s.band === 'custom' && s.range
              ? audio.getLoopBandRange(s.id, s.range[0], s.range[1])
              : audio.getLoopBand(s.id, s.band === 'custom' ? 'full' : s.band);
          if (x > v) v = x;
        }
      }
      // NOT gated by the pulse: the audio input keeps flowing in and stays
      // visible here. The pulse is a separate thing — it's what opens the gate
      // so you HEAR this sound and SEE the feather move.
      if (fillRef.current) fillRef.current.style.width = `${Math.round(Math.min(1, v) * 100)}%`;
      if (valRef.current) valRef.current.textContent = v.toFixed(2);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [audio]);
  return (
    <div className="cond-audioin">
      <div className="cond-audioin-top">
        <span className="cond-audioin-label">Audio in</span>
        <span className="cond-audioin-src">{sources.map((s) => s.label).join(' · ')}</span>
      </div>
      <div className="cond-audioin-row">
        <div className="cond-audioin-bar"><div ref={fillRef} className="cond-audioin-fill" /></div>
        <span ref={valRef} className="cond-audioin-val">0.00</span>
      </div>
    </div>
  );
}

export default function Conductor() {
  const [samples, setSamples] = useState<CloudSample[]>([]);
  const [presets, setPresets] = useState<CloudPreset[]>([]);
  const [feather, setFeather] = useState(DEFAULT_FEATHER);
  const [cfg, setCfg] = useState<ConductorConfig>(() => ({ preset: defaultPreset(DEFAULT_FEATHER), sensorSamples: {} }));
  const [presetName, setPresetName] = useState('');
  const [liveMode, setLiveMode] = useState(false);
  const [status, setStatus] = useState('connecting to the cloud database…');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [liveInfo, setLiveInfo] = useState<string>('');
  const [playing, setPlaying] = useState<string | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const skipFirstLivePush = useRef(true);

  // Shared with the landing/console/mobile so the whole engine agrees on a theme.
  const [theme, toggleTheme] = useTheme();

  // ---- live preview (own engine, so you can hear + see a config before pushing it) ---
  const previewEngine = useMemo(() => new WingbeatEngine(), []);
  const previewAudio = useMemo(() => new AudioEngine(), []);
  const previewSim = useMemo(() => new SimTransport(), []);
  const [previewAudioOn, setPreviewAudioOn] = useState(false);
  const [testingSensors, setTestingSensors] = useState<Set<string>>(new Set());
  const [eqOpen, setEqOpen] = useState<Set<string>>(new Set());
  const toggleEq = (sensorId: string) =>
    setEqOpen((s) => {
      const n = new Set(s);
      if (n.has(sensorId)) n.delete(sensorId);
      else n.add(sensorId);
      return n;
    });
  const loadedSample = useRef<Record<string, string>>({}); // sensorId → sample id currently loaded in the preview
  // The balloon, as a two-stage AR envelope. `airTarget` is how much air has been
  // pumped in (Pulse adds to it; it leaks out at RELEASE). `airLevel` chases the
  // target at ATTACK when inflating / RELEASE when deflating, and IS the value
  // that drives the sensor — so sound and picture share one gate: no air, nothing.
  const airTarget = useRef<Record<string, number>>({});
  const airLevel = useRef<Record<string, number>>({});
  // Channels whose router row is OFF are fully out: no video reaction AND no
  // audible output, even when the part is pulsed. Kept in a ref so the engine's
  // node handler (subscribed once) always sees the current routing.
  const lastGain = useRef<Record<string, number>>({}); // last gain applied, so we only ramp on change
  const mutedChannels = useRef<Set<string>>(new Set());
  mutedChannels.current = new Set(
    SENSOR_CHANNELS.filter((c) => audioRouteTargets(cfg.preset, c.sensor).length === 0).map((c) => c.sensor),
  );

  useEffect(() => {
    previewSim.connect(previewEngine);
    previewSim.setPresence('feather_01', true); // keep the preview shape visible
    // Loop volume tracks each sensor's live activation, same as the console.
    // (Deliberately NOT calling previewAudio.attach(previewEngine) here — that
    // wires the ambient drone/wind-noise/bell synth voices, which would hum
    // continuously in this small preview. Only the assigned loop samples play.)
    // Loop volume is decided once per frame in the envelope loop below (it needs
    // the pulse air, the Test monitor state and the routing together), so nothing
    // is wired to node events here.
    return () => {
      previewSim.disconnect();
    };
  }, [previewEngine, previewAudio, previewSim]);

  // Keep the preview's rig in sync with whatever's being edited (not yet pushed live).
  useEffect(() => {
    loadIntoRig(cfg.preset);
  }, [cfg]);

  // AUDIO INPUT runs continuously and independently of the pulse: once audio is
  // unlocked, every assigned sample is loaded and looping so its level/spectrum
  // keeps arriving for all five channels. Loops start (and stay) at gain 0 —
  // the pulse is what opens the gate to actually hear them.
  useEffect(() => {
    if (!previewAudioOn) return;
    let cancelled = false;
    void (async () => {
      for (const c of SENSOR_CHANNELS) {
        const ref = cfg.sensorSamples[c.sensor] ?? null;
        if (!ref) {
          if (loadedSample.current[c.sensor]) {
            previewAudio.clearLoop(c.sensor);
            delete loadedSample.current[c.sensor];
          }
          continue;
        }
        if (loadedSample.current[c.sensor] === ref.id) continue;
        try {
          const buf = await fetchSampleBuffer(ref);
          if (cancelled) return;
          await previewAudio.loadLoopBuffer(c.sensor, buf, ref.name);
          loadedSample.current[c.sensor] = ref.id;
        } catch (e) {
          setStatus(String(e));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [cfg.sensorSamples, previewAudioOn, previewAudio]);

  // Apply an OFF row's mute straight away, rather than waiting for the next
  // engine node event to push the gain down.
  useEffect(() => {
    for (const c of SENSOR_CHANNELS) {
      if (mutedChannels.current.has(c.sensor)) previewAudio.setLoopGain(c.sensor, 0);
    }
  }, [cfg, previewAudio]);

  // THE BALLOON ENVELOPE — air comes from PULSES AND NOTHING ELSE.
  //   · Pulse pumps air into `airTarget`; it leaks out at the part's RELEASE.
  //   · `airLevel` chases the target at ATTACK rising / RELEASE falling, and is
  //     what drives the part — so Attack/Release shape the pulse, and the
  //     Pulse-air meter only ever moves because you pulsed.
  //   · TEST is deliberately NOT part of this. It is an audio monitor: it makes
  //     that channel's loop audible so you can hear and EQ it, and moves neither
  //     the air nor the feather.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      for (const c of SENSOR_CHANNELS) {
        const id = c.sensor;
        const s = cfg.preset.sensors[id];
        const atk = s?.attack ?? 0.15;
        const rel = s?.release ?? 0.08;

        let tgt = airTarget.current[id] ?? 0;
        if (tgt > 0) tgt = Math.max(0, tgt - dt * (0.2 + rel * 5)); // leak
        airTarget.current[id] = tgt;

        const lvl = airLevel.current[id] ?? 0;
        // per-frame lerp rates are authored at 60fps; scale by dt to stay steady
        const rate = Math.min(1, (tgt > lvl ? atk : rel) * 60 * dt);
        const next = lvl + (tgt - lvl) * rate;

        if (next > 0.02) {
          airLevel.current[id] = next;
          previewSim.setPresence(id, true);
          previewSim.holdWind(id, next);
        } else if (lvl > 0.02) {
          airLevel.current[id] = 0;
          previewSim.releaseWind(id);
          previewSim.setPresence(id, false);
        }

        // Loop volume, decided in one place: a channel routed Off is silent, a
        // channel being monitored with Test is audible at a steady level, and
        // otherwise the pulse's air fades it in and out.
        const g = mutedChannels.current.has(id)
          ? 0
          : testingSensors.has(id)
            ? 0.9
            : next > 0.02
              ? Math.min(1.2, next * 1.2)
              : 0;
        if (Math.abs((lastGain.current[id] ?? -1) - g) > 0.01) {
          lastGain.current[id] = g;
          previewAudio.setLoopGain(id, g);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cfg, testingSensors, previewSim, previewAudio]);

  /** Stop monitoring a channel. The loop keeps running and being analysed (the
   *  audio input carries on arriving); it just stops being audible. Nothing to
   *  do with the pulse — Test never touched the air. */
  const stopSensorTest = useCallback((sensorId: string) => {
    setTestingSensors((s) => {
      if (!s.has(sensorId)) return s;
      const n = new Set(s);
      n.delete(sensorId);
      return n;
    });
  }, []);

  /** Make sure the audio context is live and this sensor's assigned loop is
   *  loaded, so a Test *or* a Pulse actually makes sound. */
  const ensureLoop = useCallback(async (sensorId: string) => {
    if (!previewAudio.ready) await previewAudio.init();
    await previewAudio.resume();
    setPreviewAudioOn(true);
    const ref = cfg.sensorSamples[sensorId] ?? null;
    if (ref) {
      if (loadedSample.current[sensorId] !== ref.id) {
        const buf = await fetchSampleBuffer(ref);
        await previewAudio.loadLoopBuffer(sensorId, buf, ref.name);
        loadedSample.current[sensorId] = ref.id;
      }
    } else if (loadedSample.current[sensorId]) {
      previewAudio.clearLoop(sensorId);
      delete loadedSample.current[sensorId];
    }
  }, [cfg, previewAudio]);

  /** MONITOR a channel: load its sample if needed and make the loop audible so
   *  you can hear it and set its EQ. It does NOT pulse — no air, no feather
   *  movement — because a pulse must only ever come from the Pulse button. */
  const startSensorTest = async (sensorId: string) => {
    try {
      await ensureLoop(sensorId);
      setTestingSensors((s) => new Set(s).add(sensorId));
    } catch (e) {
      setStatus(String(e));
    }
  };

  const toggleSensorTest = (sensorId: string) => {
    if (testingSensors.has(sensorId)) stopSensorTest(sensorId);
    else void startSensorTest(sensorId);
  };

  /** Test-all toggle: stagger the starts a touch so the sweep reads left-to-right,
   *  then hold everything until Stop is pressed. */
  const anyTesting = testingSensors.size > 0;
  const toggleTestAll = () => {
    if (anyTesting) SENSOR_CHANNELS.forEach((c) => stopSensorTest(c.sensor));
    else SENSOR_CHANNELS.forEach((c, i) => setTimeout(() => void startSensorTest(c.sensor), i * 150));
  };

  /** PULSE = pumping a balloon. Each press puffs more air IN, so pulses STACK:
   *  the more you pulse, the more interaction air the part has, the louder and
   *  more agitated it gets. The air then leaks back out (see the effect below),
   *  and since the air level IS the sensor's drive, no pulses means no air —
   *  which means no sound and no reaction at all. Preview only. */
  const pulseSensor = async (sensorId: string) => {
    try {
      await ensureLoop(sensorId); // a pulse has to be able to make sound
      const sens = cfg.preset.sensors[sensorId]?.sensitivity ?? 1;
      const puff = 0.4 * Math.min(1.5, sens); // Sensitivity = air per pulse
      airTarget.current[sensorId] = Math.min(1, (airTarget.current[sensorId] ?? 0) + puff);
      // the envelope loop takes it from here: inflate at Attack, leak at Release
    } catch (e) {
      setStatus(String(e));
    }
  };

  const featherPresets = useMemo(() => presets.filter((p) => p.feather === feather), [presets, feather]);
  const featherLabel = FEATHERS.find((f) => f.id === feather)?.label ?? feather;

  const refreshSamples = useCallback(() => listSamples().then(setSamples).catch((e) => setStatus(String(e))), []);
  const refreshPresets = useCallback(() => listCloudPresets().then(setPresets).catch((e) => setStatus(String(e))), []);

  // Initial load: library + presets + the current live state (adopt it so the
  // conductor opens showing what the installation is actually playing).
  useEffect(() => {
    Promise.all([listSamples(), listCloudPresets(), getLive()])
      .then(([smp, pst, live]) => {
        setSamples(smp);
        setPresets(pst);
        if (live?.config?.preset) {
          setCfg(clone(live.config));
          if (live.feather) setFeather(live.feather);
          setStatus('showing the current live config');
        } else {
          setStatus('connected — nothing pushed live yet');
        }
      })
      .catch((e) => setStatus(`cloud error: ${e.message ?? e}`));
    return onLiveChange((live) => {
      setLiveInfo(`live: ${live.feather ?? '—'} · ${new Date(live.updated_at).toLocaleTimeString()}`);
    });
  }, []);

  // ---- editing helpers ------------------------------------------------------
  const patch = (fn: (c: ConductorConfig) => void) =>
    setCfg((c) => {
      const n = clone(c);
      fn(n);
      return n;
    });
  const patchSensor = (sensorId: string, fn: (s: SensorRig) => void) =>
    patch((c) => {
      const s = c.preset.sensors[sensorId];
      if (s) fn(s);
    });

  /** Toggle one cell of the AUDIO → VIDEO router. The identity route is implicit
   *  until you touch a row, so we materialise it on first edit. */
  const toggleRoute = (srcId: string, dstId: string) =>
    patch((c) => {
      const routes = (c.preset.audioRoutes ??= {});
      const cur = routes[srcId] ?? [srcId];
      routes[srcId] = cur.includes(dstId) ? cur.filter((t) => t !== dstId) : [...cur, dstId];
    });

  /** OFF — this channel's sound drives no part at all (an explicit empty route,
   *  which is distinct from "unset", i.e. the implicit identity route). */
  const routeOff = (srcId: string) =>
    patch((c) => {
      (c.preset.audioRoutes ??= {})[srcId] = [];
    });

  const selectFeather = (id: string) => {
    setFeather(id);
    const latest = presets.find((p) => p.feather === id); // list is newest-first
    if (latest) {
      setCfg(clone(latest.config));
      setPresetName(latest.name);
      setStatus(`loaded preset "${latest.name}"`);
    } else {
      setCfg({ preset: defaultPreset(id), sensorSamples: {} });
      setPresetName('');
      setStatus('new feather — starting from defaults');
    }
  };

  // ---- cloud actions ---------------------------------------------------------
  const doPush = useCallback(async (quiet = false) => {
    setBusy(true);
    try {
      await pushLive(feather, cfg);
      if (!quiet) setStatus('pushed live ✓ — every connected device updates now');
    } catch (e) {
      setStatus(String(e));
    } finally {
      setBusy(false);
    }
  }, [feather, cfg]);

  // Live mode: any edit pushes automatically (debounced).
  useEffect(() => {
    if (!liveMode) {
      skipFirstLivePush.current = true;
      return;
    }
    if (skipFirstLivePush.current) {
      skipFirstLivePush.current = false; // don't re-push just for turning it on…
    }
    const id = setTimeout(() => void doPush(true), 600);
    return () => clearTimeout(id);
  }, [cfg, liveMode, doPush]);

  const doSavePreset = async () => {
    const name = presetName.trim() || 'preset';
    setBusy(true);
    try {
      await saveCloudPreset(name, feather, cfg);
      await refreshPresets();
      setPresetName(name);
      setStatus(`saved "${name}" for ${featherLabel}`);
    } catch (e) {
      setStatus(String(e));
    } finally {
      setBusy(false);
    }
  };

  const doUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        setStatus(`uploading ${f.name}…`);
        await uploadSample(f, null);
      }
      await refreshSamples();
      setStatus(`uploaded ${files.length} file${files.length > 1 ? 's' : ''} ✓`);
    } catch (e) {
      setStatus(String(e));
    } finally {
      setUploading(false);
    }
  };

  const doDeleteSample = async (s: CloudSample) => {
    if (!confirm(`Delete "${s.name}" from the library?`)) return;
    await deleteSample(s).catch((e) => setStatus(String(e)));
    patch((c) => {
      for (const [sid, ref] of Object.entries(c.sensorSamples)) {
        if (ref?.id === s.id) {
          c.sensorSamples[sid] = null;
          const sensor = c.preset.sensors[sid];
          if (sensor) sensor.loopSample = undefined;
        }
      }
    });
    refreshSamples();
  };

  const preview = (s: CloudSample) => {
    if (playing === s.id) {
      player.current?.pause();
      setPlaying(null);
      return;
    }
    player.current?.pause();
    const a = new Audio(sampleUrl(s.storage_path));
    a.onended = () => setPlaying(null);
    a.play().catch(() => setStatus(`couldn't play ${s.name}`));
    player.current = a;
    setPlaying(s.id);
  };

  const assignSample = (sensorId: string, sampleId: string) => {
    const s = samples.find((x) => x.id === sampleId) ?? null;
    patch((c) => {
      c.sensorSamples[sensorId] = s ? sampleRef(s) : null;
      const sensor = c.preset.sensors[sensorId];
      if (sensor) sensor.loopSample = s?.name;
    });
  };

  const g = cfg.preset.global;

  return (
    <div className={`cond-shell ${theme === 'light' ? 'cond-light' : ''}`}>
      <header className="cond-head">
        <div className="cond-title">
          Wing Beat <b>· Conductor</b>
          <small>{status}</small>
        </div>
        <div className="cond-head-actions">
          {liveInfo && <span className="cond-liveinfo">{liveInfo}</span>}
          <button className="wb-btn" onClick={toggleTheme} title="Toggle light/dark theme">
            {theme === 'light' ? '☀ Light' : '☾ Dark'}
          </button>
          <button className={`wb-btn ${anyTesting ? 'active' : ''}`} onClick={toggleTestAll} title="Monitor all 5 channels — audible only, no pulse and nothing pushed live">
            {anyTesting ? '■ Stop' : '▶ Test all'}
          </button>
          <label className={`wb-btn cond-livemode ${liveMode ? 'active' : ''}`}>
            <input type="checkbox" checked={liveMode} onChange={(e) => setLiveMode(e.target.checked)} />
            ● Live mode
          </label>
          <button className="wb-btn accent" disabled={busy} onClick={() => void doPush()}>
            ⇪ Push live
          </button>
        </div>
      </header>

      {/* Two separate signal chains: an AUDIO ENGINE (sample → EQ → level) and a
          FEATHER ENGINE (feather → per-part video controls → video output). */}
      <div className="cond-engines">
        {/* ═══════════ AUDIO ENGINE ═══════════ */}
        <section className="cond-engine cond-engine-audio">
          <div className="cond-engine-head">Audio Engine</div>
          <div className="cond-achans">
            {SENSOR_CHANNELS.map((c) => {
              const s = cfg.preset.sensors[c.sensor];
              if (!s) return null;
              const assigned = cfg.sensorSamples[c.sensor] ?? null;
              const eqOn = s.eqOn !== false;
              const testing = testingSensors.has(c.sensor);
              return (
                <div key={c.sensor} className="cond-achan">
                  <div className="cond-achan-head">
                    <b>{c.label}</b>
                    <span className="cond-sensor-sub">{c.sensor} · key {c.key.toUpperCase()}</span>
                    {mutedChannels.current.has(c.sensor) && (
                      <span className="cond-achan-off" title="Routed Off — this channel is muted and drives no feather part">off</span>
                    )}
                  </div>
                  <div className="cond-field-row">
                    <label className="cond-field">
                      <span>Sample</span>
                      <select value={assigned?.id ?? ''} onChange={(e) => assignSample(c.sensor, e.target.value)}>
                        <option value="">— none —</option>
                        {samples.map((smp) => (
                          <option key={smp.id} value={smp.id}>{smp.name}</option>
                        ))}
                      </select>
                    </label>
                    <button
                      className={`wb-btn ${testing ? 'active' : ''}`}
                      onClick={() => toggleSensorTest(c.sensor)}
                      title="Monitor this channel — makes its loop audible so you can hear + EQ it. Does not pulse the feather."
                    >
                      {testing ? '■ Stop' : '▶ Test'}
                    </button>
                  </div>

                  <LiveMeter audio={previewAudio} sensorId={c.sensor} mode="input" band={s.audioBand} range={s.audioBandRange} eqOn={eqOn} label="Input level" />

                  <div className="cond-eq-controls">
                    <button
                      className={`cond-eq-power ${eqOn ? 'on' : ''}`}
                      onClick={() => patchSensor(c.sensor, (x) => { x.eqOn = !eqOn; })}
                      title="EQ on/off — off reacts to the full-range level"
                    >
                      EQ {eqOn ? 'ON' : 'OFF'}
                    </button>
                    <select className="cond-eq-band" disabled={!eqOn} value={s.audioBand} onChange={(e) => patchSensor(c.sensor, (x) => { x.audioBand = e.target.value as SensorRig['audioBand']; })}>
                      {AUDIO_BANDS.map((b) => <option key={b} value={b}>{AUDIO_BAND_LABELS[b]}</option>)}
                    </select>
                    <button
                      className={`wb-btn ${eqOpen.has(c.sensor) ? 'active' : ''}`}
                      style={{ padding: '5px 8px' }}
                      disabled={!eqOn}
                      onClick={() => toggleEq(c.sensor)}
                      title="Visual EQ — see the loop's spectrum and set a custom frequency range"
                    >
                      ≈ EQ
                    </button>
                  </div>

                  {eqOn && eqOpen.has(c.sensor) && (
                    <EqEditor
                      audio={previewAudio}
                      sensorId={c.sensor}
                      band={s.audioBand}
                      range={s.audioBandRange}
                      eqOn={eqOn}
                      onChange={(band, range) => patchSensor(c.sensor, (x) => { x.audioBand = band; x.audioBandRange = range; })}
                    />
                  )}

                  <LiveMeter audio={previewAudio} sensorId={c.sensor} mode="filtered" band={s.audioBand} range={s.audioBandRange} eqOn={eqOn} label={eqOn ? 'Filtered' : 'Full (EQ off)'} />
                </div>
              );
            })}

            {/* ROUTER — sends each channel's FILTERED value to the video part(s)
                it should drive. Sits alongside the channels it patches. */}
            <div className="cond-router">
              <div className="cond-router-head">Audio → Video router</div>
              <div className="cond-router-sub">filtered level drives the routed part</div>
              <table className="cond-matrix">
                <thead>
                  <tr>
                    <th />
                    <th className="cond-matrix-off">Off</th>
                    {SENSOR_CHANNELS.map((p) => <th key={p.sensor} title={p.label}>{p.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {SENSOR_CHANNELS.map((src) => {
                    const targets = audioRouteTargets(cfg.preset, src.sensor);
                    return (
                      <tr key={src.sensor}>
                        <th title={`${src.label} audio`}>{src.label}</th>
                        <td>
                          <button
                            className={`cond-cell cond-cell-off ${targets.length === 0 ? 'on' : ''}`}
                            onClick={() => routeOff(src.sensor)}
                            title={`${src.label} audio drives nothing`}
                          />
                        </td>
                        {SENSOR_CHANNELS.map((dst) => (
                          <td key={dst.sensor}>
                            <button
                              className={`cond-cell ${targets.includes(dst.sensor) ? 'on' : ''}`}
                              onClick={() => toggleRoute(src.sensor, dst.sensor)}
                              title={`${src.label} audio → ${dst.label} video`}
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="cond-lib">
            <div className="cond-lib-head">Sample library</div>
            <label className={`wb-btn ${uploading ? 'active' : ''}`} style={{ display: 'block', textAlign: 'center' }}>
              {uploading ? 'uploading…' : '⇧ Upload audio files'}
              <input type="file" accept="audio/*" multiple hidden disabled={uploading} onChange={(e) => { void doUpload(e.target.files); e.target.value = ''; }} />
            </label>
            <div className="cond-samples">
              {samples.length === 0 && <div className="cond-empty">no samples yet — upload .wav / .mp3 / .ogg</div>}
              {samples.map((s) => (
                <div key={s.id} className="cond-sample">
                  <button className={`cond-play ${playing === s.id ? 'on' : ''}`} onClick={() => preview(s)}>
                    {playing === s.id ? '■' : '▶'}
                  </button>
                  <span className="cond-sample-name" title={s.name}>{s.name}</span>
                  <span className="cond-sample-size">{s.size_bytes ? `${Math.round(s.size_bytes / 1024)}k` : ''}</span>
                  <button className="cond-x" onClick={() => void doDeleteSample(s)} title="delete from library">✕</button>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ═══════════ FEATHER ENGINE ═══════════ */}
        <section className="cond-engine cond-engine-video">
          <div className="cond-engine-head">Feather Engine</div>

          <div className="cond-feather-select">
            <div className="cond-feathers">
              {FEATHERS.map((f) => (
                <button key={f.id} className={`cond-feather ${feather === f.id ? 'active' : ''}`} onClick={() => selectFeather(f.id)} title={f.label}>
                  {f.procedural ? <span className="cond-feather-proc">✦</span> : <img src={f.src.replace('/feathers/', '/feathers/thumbs/')} alt={f.label} loading="lazy" />}
                </button>
              ))}
            </div>
            <div className="cond-feather-name">{featherLabel}</div>
          </div>

          <div className="cond-video-split">
            <div className="cond-vparts">
              {SENSOR_CHANNELS.map((c) => {
                const s = cfg.preset.sensors[c.sensor];
                if (!s) return null;
                // which audio channels does the router feed into this part?
                const audioIn = SENSOR_CHANNELS
                  .filter((src) => audioRouteTargets(cfg.preset, src.sensor).includes(c.sensor))
                  .map((src) => {
                    const ss = cfg.preset.sensors[src.sensor];
                    return { id: src.sensor, label: src.label, eqOn: ss?.eqOn !== false, band: ss?.audioBand ?? 'full', range: ss?.audioBandRange };
                  });
                return (
                  <div key={c.sensor} className="cond-vpart">
                    <div className="cond-vpart-head">
                      <div>
                        <b>{c.label}</b>
                        <span className="cond-sensor-sub">{c.sensor} · {c.kind}</span>
                      </div>
                      <button className="cond-pulse" onClick={() => void pulseSensor(c.sensor)} title="Pump this part like a balloon — pulses stack, then the air leaks out">
                        ● Pulse
                      </button>
                    </div>

                    <AirMeter airRef={airLevel} sensorId={c.sensor} />

                    {audioIn.length > 0 && <RoutedAudioIn audio={previewAudio} sources={audioIn} />}

                    <div className="cond-field-row">
                      <label className="cond-field">
                        <span>Motion</span>
                        <select value={s.motionType} onChange={(e) => patchSensor(c.sensor, (x) => { x.motionType = e.target.value as SensorRig['motionType']; })}>
                          {MOTION_TYPES.map((m) => <option key={m} value={m}>{MOTION_LABELS[m]}</option>)}
                        </select>
                      </label>
                    </div>
                    <div className="cond-field">
                      <span>Affects layers</span>
                      <div className="cond-layers">
                        {Array.from({ length: MAX_LAYERS }, (_, li) => (
                          <button
                            key={li}
                            className={`cond-layer ${s.layers.includes(li) ? 'on' : ''}`}
                            onClick={() => patchSensor(c.sensor, (x) => { x.layers = x.layers.includes(li) ? x.layers.filter((n) => n !== li) : [...x.layers, li]; })}
                          >
                            L{li + 1}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="cond-pulsegrp">
                      <div className="cond-pulsegrp-head">Pulse response</div>
                      <Slider label="Sensitivity" value={s.sensitivity ?? 1} min={0.2} max={3} step={0.05} onChange={(v) => patchSensor(c.sensor, (x) => { x.sensitivity = v; })} fmt={(v) => `${v.toFixed(2)}×`} />
                      <Slider label="Attack" value={s.attack} min={0.03} max={0.6} step={0.01} onChange={(v) => patchSensor(c.sensor, (x) => { x.attack = v; x.modules.release = true; })} />
                      <Slider label="Release" value={s.release} min={0.02} max={0.4} step={0.01} onChange={(v) => patchSensor(c.sensor, (x) => { x.release = v; x.modules.release = true; })} />
                      <Slider label="Reach" value={s.reach} min={0} max={1} step={0.01} onChange={(v) => patchSensor(c.sensor, (x) => { x.reach = v; })} />
                    </div>
                    <div className="cond-field-row">
                      <label className="cond-check">
                        <input type="checkbox" checked={s.modules.movement} onChange={(e) => patchSensor(c.sensor, (x) => { x.modules.movement = e.target.checked; })} />
                        moves particles
                      </label>
                      <label className="cond-check">
                        <input type="checkbox" checked={s.modules.color} onChange={(e) => patchSensor(c.sensor, (x) => { x.modules.color = e.target.checked; })} />
                        recolor
                        <input type="color" value={rgbToHex(s.overrideRGB)} onChange={(e) => patchSensor(c.sensor, (x) => { x.overrideRGB = hexToRgb(e.target.value); })} />
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="cond-video-out">
              <div className="cond-video-out-head">
                <span>Video output</span>
                <span className="cond-preview-audio">{previewAudioOn ? '🔊 audio on' : '🔇 hit Test to enable audio'}</span>
              </div>
              <div className="cond-video-out-canvas">
                <Projection engine={previewEngine} audio={previewAudio} featherId={feather} />
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* ═══════════ GLOBAL REACTION + PRESETS ═══════════ */}
      <div className="cond-bottom">
        <section className="cond-sec cond-global-sec">
          <h3>Feather reaction — global</h3>
          <div className="cond-global">
            <Slider label="Sway" value={g.sway} min={0} max={1} step={0.01} onChange={(v) => patch((c) => { c.preset.global.sway = v; })} />
            <Slider label="Wing beat" value={g.wingBeat} min={0} max={1} step={0.01} onChange={(v) => patch((c) => { c.preset.global.wingBeat = v; })} />
            <Slider label="Gravity" value={g.gravity} min={0} max={1} step={0.01} onChange={(v) => patch((c) => { c.preset.global.gravity = v; })} />
            <Slider label="Motion" value={g.motion} min={0} max={1.5} step={0.01} onChange={(v) => patch((c) => { c.preset.global.motion = v; })} />
            <Slider label="Ambient drift" value={g.ambient} min={0} max={1} step={0.01} onChange={(v) => patch((c) => { c.preset.global.ambient = v; })} />
            <Slider label="Audio react" value={g.audioReact} min={0} max={1.5} step={0.01} onChange={(v) => patch((c) => { c.preset.global.audioReact = v; })} />
            <Slider label="Size" value={g.size} min={20} max={90} step={1} onChange={(v) => patch((c) => { c.preset.global.size = v; })} fmt={(v) => v.toFixed(0)} />
            <Slider label="Tempo" value={g.bpm} min={60} max={200} step={1} onChange={(v) => patch((c) => { c.preset.global.bpm = v; })} fmt={(v) => `${v.toFixed(0)} bpm`} />
            <Slider label="Idle fall" value={g.idleFall} min={0} max={30} step={0.5} onChange={(v) => patch((c) => { c.preset.global.idleFall = v; })} fmt={(v) => `${v.toFixed(1)}s`} />
            <Slider label="Auto layers" value={cfg.preset.autoK} min={2} max={6} step={1} onChange={(v) => patch((c) => { c.preset.autoK = v; })} fmt={(v) => v.toFixed(0)} />
            <label className="cond-check">
              <input type="checkbox" checked={g.autoAudio} onChange={(e) => patch((c) => { c.preset.global.autoAudio = e.target.checked; })} />
              auto audio (loops play + drive layers without triggering)
            </label>
            <label className="cond-field cond-scene">
              <span>Scene</span>
              <select value={cfg.scene ?? ''} onChange={(e) => patch((c) => { c.scene = e.target.value || undefined; })}>
                <option value="">feather default</option>
                {Object.values(SCENES).map((sc) => <option key={sc.key} value={sc.key}>{sc.label}</option>)}
              </select>
            </label>
          </div>
        </section>

        <section className="cond-sec cond-presets-sec">
          <h3>Presets · {featherLabel}</h3>
          <div className="cond-preset-save">
            <input className="wb-input" placeholder="preset name" value={presetName} onChange={(e) => setPresetName(e.target.value)} />
            <button className="wb-btn" disabled={busy} onClick={() => void doSavePreset()}>save</button>
          </div>
          <div className="cond-presets">
            {featherPresets.length === 0 && <div className="cond-empty">no presets for this feather yet</div>}
            {featherPresets.map((p) => (
              <div key={p.id} className="cond-preset">
                <span className="cond-preset-name" title={new Date(p.updated_at).toLocaleString()}>{p.name}</span>
                <button className="wb-btn" onClick={() => { setCfg(clone(p.config)); setPresetName(p.name); setStatus(`loaded "${p.name}"`); }}>load</button>
                <button className="wb-btn" onClick={() => { setCfg(clone(p.config)); setPresetName(p.name); void pushLive(feather, p.config, p.id).then(() => setStatus(`pushed "${p.name}" live ✓`)).catch((e) => setStatus(String(e))); }}>push</button>
                <button className="cond-x" onClick={() => { if (confirm(`Delete preset "${p.name}"?`)) void deleteCloudPreset(p.id).then(refreshPresets); }}>✕</button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
