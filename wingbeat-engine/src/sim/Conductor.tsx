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
import {
  defaultPreset,
  loadIntoRig,
  MAX_LAYERS,
  MOTION_TYPES,
  MOTION_LABELS,
  AUDIO_BANDS,
  AUDIO_BAND_LABELS,
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

  const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem('wb.conductorTheme') === 'light' ? 'light' : 'dark'));
  useEffect(() => localStorage.setItem('wb.conductorTheme', theme), [theme]);

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

  useEffect(() => {
    previewSim.connect(previewEngine);
    previewSim.setPresence('feather_01', true); // keep the preview shape visible
    // Loop volume tracks each sensor's live activation, same as the console.
    // (Deliberately NOT calling previewAudio.attach(previewEngine) here — that
    // wires the ambient drone/wind-noise/bell synth voices, which would hum
    // continuously in this small preview. Only the assigned loop samples play.)
    const offNode = previewEngine.on('node', (e: { id: string; state: { wind: number; present: boolean } }) => {
      if (!e.id.startsWith('sensor_') || !previewAudio.hasLoop(e.id)) return;
      const lvl = Math.max(e.state.wind, e.state.present ? 0.9 : 0);
      previewAudio.setLoopGain(e.id, lvl > 0.12 ? Math.min(1.2, 0.25 + lvl) : 0);
    });
    return () => {
      offNode();
      previewSim.disconnect();
    };
  }, [previewEngine, previewAudio, previewSim]);

  // Keep the preview's rig in sync with whatever's being edited (not yet pushed live).
  useEffect(() => {
    loadIntoRig(cfg.preset);
  }, [cfg]);

  /** Stop a sensor's test — releases wind/presence so the shader's own Release
   *  setting plays out the natural decay (motion AND audio-reactive color), AND
   *  fully stops the loop. A loop's meter/FFT tap its RAW output (before the
   *  gain node) so a layer can react to sound before its gain is up — but that
   *  also means fading gain to 0 on Stop never actually reads as silence, so
   *  the audio-reactive glow kept going even with no audio audible. Stopped now
   *  means stopped: clearLoop so there's truly nothing left to react to. */
  const stopSensorTest = useCallback((sensorId: string) => {
    previewSim.releaseWind(sensorId);
    previewSim.setPresence(sensorId, false);
    previewAudio.clearLoop(sensorId);
    delete loadedSample.current[sensorId];
    setTestingSensors((s) => {
      if (!s.has(sensorId)) return s;
      const n = new Set(s);
      n.delete(sensorId);
      return n;
    });
  }, [previewSim, previewAudio]);

  /** Start a sensor's test — loads its assigned sample if needed, then HOLDS it
   *  (like a held key) until stopSensorTest is called, so Attack/Release and the
   *  sample's own length are fully audible/visible instead of a fixed blip.
   *  No auto-stop: audio and the particle reaction only end when you press Stop
   *  (or leave the page, which tears the preview down). A timed auto-stop here
   *  would silently desync the two — sound cutting out while the shape is still
   *  held "active" is exactly the bug this is meant to avoid. */
  const startSensorTest = async (sensorId: string) => {
    try {
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
      previewSim.setPresence(sensorId, true);
      previewSim.holdWind(sensorId, 1);
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
          <button className="wb-btn" onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))} title="Toggle light/dark theme">
            {theme === 'light' ? '☀ Light' : '☾ Dark'}
          </button>
          <button className={`wb-btn ${anyTesting ? 'active' : ''}`} onClick={toggleTestAll} title="Hold all 5 sensors on the preview below — nothing is pushed live">
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

      <div className="cond-cols">
        {/* LEFT — feather, sample library, presets */}
        <aside className="cond-side">
          <section className="cond-sec">
            <h3>Feather</h3>
            <div className="cond-feathers">
              {FEATHERS.map((f) => (
                <button key={f.id} className={`cond-feather ${feather === f.id ? 'active' : ''}`} onClick={() => selectFeather(f.id)} title={f.label}>
                  {f.procedural ? <span className="cond-feather-proc">✦</span> : <img src={f.src.replace('/feathers/', '/feathers/thumbs/')} alt={f.label} loading="lazy" />}
                </button>
              ))}
            </div>
            <div className="cond-feather-name">{featherLabel}</div>
          </section>

          <section className="cond-sec">
            <h3>Sample library</h3>
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
          </section>

          <section className="cond-sec">
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
        </aside>

        {/* RIGHT — per-sensor rigs + global reaction */}
        <main className="cond-main">
          <section className="cond-sec">
            <h3>Sensors — sample · effect · sensitivity</h3>
            <div className="cond-sensors">
              {SENSOR_CHANNELS.map((c) => {
                const s = cfg.preset.sensors[c.sensor];
                if (!s) return null;
                const assigned = cfg.sensorSamples[c.sensor] ?? null;
                return (
                  <div key={c.sensor} className="cond-sensor">
                    <div className="cond-sensor-head">
                      <b>{c.label}</b>
                      <span className="cond-sensor-sub">{c.sensor} · key {c.key.toUpperCase()} · {c.kind}</span>
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
                        className={`wb-btn ${testingSensors.has(c.sensor) ? 'active' : ''}`}
                        onClick={() => toggleSensorTest(c.sensor)}
                        title="Hold this sensor on the preview below — nothing is pushed live"
                      >
                        {testingSensors.has(c.sensor) ? '■ Stop' : '▶ Test'}
                      </button>
                    </div>

                    <Slider label="Sensitivity" value={s.sensitivity ?? 1} min={0.2} max={3} step={0.05} onChange={(v) => patchSensor(c.sensor, (x) => { x.sensitivity = v; })} fmt={(v) => `${v.toFixed(2)}×`} />

                    <div className="cond-field-row">
                      <label className="cond-field">
                        <span>Motion</span>
                        <select value={s.motionType} onChange={(e) => patchSensor(c.sensor, (x) => { x.motionType = e.target.value as SensorRig['motionType']; })}>
                          {MOTION_TYPES.map((m) => <option key={m} value={m}>{MOTION_LABELS[m]}</option>)}
                        </select>
                      </label>
                      <label className="cond-field">
                        <span>EQ band</span>
                        <div className="cond-field-row" style={{ gap: 6 }}>
                          <select style={{ flex: 1 }} value={s.audioBand} onChange={(e) => patchSensor(c.sensor, (x) => { x.audioBand = e.target.value as SensorRig['audioBand']; })}>
                            {AUDIO_BANDS.map((b) => <option key={b} value={b}>{AUDIO_BAND_LABELS[b]}</option>)}
                          </select>
                          <button
                            className={`wb-btn ${eqOpen.has(c.sensor) ? 'active' : ''}`}
                            style={{ padding: '5px 8px' }}
                            onClick={() => toggleEq(c.sensor)}
                            title="Visual EQ — see the loop's spectrum and set a custom frequency range"
                          >
                            ≈ EQ
                          </button>
                        </div>
                      </label>
                    </div>

                    {eqOpen.has(c.sensor) && (
                      <EqEditor
                        audio={previewAudio}
                        sensorId={c.sensor}
                        band={s.audioBand}
                        range={s.audioBandRange}
                        sensitivity={s.sensitivity ?? 1}
                        onChange={(band, range) => patchSensor(c.sensor, (x) => { x.audioBand = band; x.audioBandRange = range; })}
                      />
                    )}

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

                    <Slider label="Reach" value={s.reach} min={0} max={1} step={0.01} onChange={(v) => patchSensor(c.sensor, (x) => { x.reach = v; })} />
                    <Slider label="Attack" value={s.attack} min={0.03} max={0.6} step={0.01} onChange={(v) => patchSensor(c.sensor, (x) => { x.attack = v; x.modules.release = true; })} />
                    <Slider label="Release" value={s.release} min={0.02} max={0.4} step={0.01} onChange={(v) => patchSensor(c.sensor, (x) => { x.release = v; x.modules.release = true; })} />

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
          </section>

          <section className="cond-sec">
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
        </main>
      </div>

      <div className="cond-preview">
        <div className="cond-preview-head">
          <span>Preview</span>
          <span className="cond-preview-audio">{previewAudioOn ? '🔊 audio on' : '🔇 hit Test to enable audio'}</span>
        </div>
        <div className="cond-preview-canvas">
          <Projection engine={previewEngine} audio={previewAudio} featherId={feather} />
        </div>
      </div>
    </div>
  );
}
