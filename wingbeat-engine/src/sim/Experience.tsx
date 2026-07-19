// ============================================================================
//  /experience — the distilled front-of-house page.
//
//  The console (/) exposes everything; this page exposes the four things a
//  visitor or performer actually touches, over a full-bleed feather:
//
//    · FEATHER  — pick which feather is alive
//    · PRESETS  — recall the configs saved in /conductor (rig + loops + scene)
//    · CONTROL  — QR codes so phones join as controllers (dev1..dev5 → parts)
//    · MIX      — layer mixer with a master fader
//
//  One sheet open at a time; the feather stays the star. Live pushes from
//  /conductor still land here (useConductorSync), so the page follows the
//  installation. Deliberately dark-only: it wraps the projection surface.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import './ui.css';
import './experience.css';
import QRCode from 'qrcode';
import { WingbeatEngine } from '../engine/WingbeatEngine.ts';
import { AudioEngine } from '../engine/AudioEngine.ts';
import { SimTransport } from '../transports/SimTransport.ts';
import { Projection } from './Projection.tsx';
import { FEATHERS, DEFAULT_FEATHER } from './feathers.ts';
import { SENSOR_CHANNELS } from './channels.ts';
import { rig } from './rig.ts';
import { startHost, type HostHandle, type LinkStatus } from '../net/link.ts';
import { useConductorSync, applyConductorConfig } from '../net/liveSync.ts';
import { listCloudPresets, type CloudPreset } from '../net/cloud.ts';
import { DEVICE_COUNT } from './inputs.ts';

type Sheet = 'feather' | 'presets' | 'control' | 'mix' | null;

// Each phone slot drives one feather part, fixed 1:1 (dev1→Tip … dev5→Tail):
// no routing matrix here — that's what the console is for.
const SLOT_PART = SENSOR_CHANNELS.map((c) => c.sensor);

export default function Experience() {
  const engine = useMemo(() => new WingbeatEngine(), []);
  const audio = useMemo(() => new AudioEngine(), []);
  const [feather, setFeather] = useState(DEFAULT_FEATHER);
  const [audioReady, setAudioReady] = useState(false);
  const [masterGain, setMasterGain] = useState(0.7);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [, setTick] = useState(0); // mixer rerender
  const rerender = () => setTick((v) => v + 1);

  const chooseFeather = (id: string) => {
    setFeather(id);
    engine.setFeather(id);
  };

  // ---- engine room (sim transport populates the sensor ring) --------------
  const [transport] = useState(() => new SimTransport({}));
  useEffect(() => {
    transport.connect(engine);
    return () => transport.disconnect();
  }, [transport, engine]);

  // Conductor live pushes land here exactly like on the console + displays.
  useConductorSync({ engine, audio, onFeather: chooseFeather });

  // Held wind makes that sensor's loop audible (same rule as the console).
  useEffect(() => {
    const onNode = (e: { id: string; state: { wind: number; present: boolean } }) => {
      if (!e.id.startsWith('sensor_') || !audio.hasLoop(e.id)) return;
      const lvl = Math.max(e.state.wind, e.state.present ? 0.9 : 0);
      audio.setLoopGain(e.id, lvl > 0.12 ? Math.min(1.2, 0.25 + lvl) : 0);
    };
    return engine.on('node', onNode);
  }, [engine, audio]);

  useEffect(() => {
    audio.setMasterGain(masterGain);
  }, [audio, masterGain]);

  // ---- phone controllers: one host per slot, slot i drives part i ---------
  const linksRef = useRef<HostHandle[]>([]);
  const motion = useRef<number[]>(Array(DEVICE_COUNT).fill(0));
  const stale = useRef<Array<ReturnType<typeof setTimeout> | undefined>>(Array(DEVICE_COUNT).fill(undefined));
  const [deviceInfo, setDeviceInfo] = useState<Array<{ deviceId: string; code: string } | null>>(Array(DEVICE_COUNT).fill(null));
  const [devicePeers, setDevicePeers] = useState<number[]>(Array(DEVICE_COUNT).fill(0));
  const [deviceStatus, setDeviceStatus] = useState<LinkStatus[]>(Array(DEVICE_COUNT).fill('idle'));

  useEffect(() => {
    if (linksRef.current.length) return;
    const setAt = <T,>(setter: React.Dispatch<React.SetStateAction<T[]>>, i: number, value: T) =>
      setter((arr) => {
        const next = arr.slice();
        next[i] = value;
        return next;
      });
    linksRef.current = Array.from({ length: DEVICE_COUNT }, (_, i) =>
      startHost({
        onStatus: (s) => setAt(setDeviceStatus, i, s),
        onIdentity: (deviceId, code) => setAt<{ deviceId: string; code: string } | null>(setDeviceInfo, i, { deviceId, code }),
        onPeers: (n) => setAt(setDevicePeers, i, n),
        onControl: (c) => {
          switch (c.t) {
            case 'motion':
            case 'blow': {
              motion.current[i] = Math.max(0, Math.min(1, c.v));
              if (stale.current[i]) clearTimeout(stale.current[i]);
              stale.current[i] = setTimeout(() => {
                motion.current[i] = 0;
              }, 1500);
              break;
            }
            case 'scene':
              engine.setScene(c.key);
              break;
            case 'bpm':
              audio.setBpm(c.v);
              break;
            case 'master':
              setMasterGain(Math.max(0, Math.min(1, c.v)));
              break;
          }
        },
      }),
    );
    setDeviceInfo(linksRef.current.map((h) => ({ deviceId: h.deviceId, code: h.code })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(
    () => () => {
      stale.current.forEach((t) => t && clearTimeout(t));
      linksRef.current.forEach((h) => h.destroy());
      linksRef.current = [];
    },
    [],
  );

  // Per-frame: each slot's motion → its fixed part, shaped by rig sensitivity.
  useEffect(() => {
    let raf = 0;
    const driven = new Set<string>();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      for (let i = 0; i < SLOT_PART.length; i++) {
        const id = SLOT_PART[i];
        const sens = rig.sensors[id]?.sensitivity ?? 1;
        const v = Math.min(1, (motion.current[i] ?? 0) * sens);
        if (v > 0.001) {
          transport.holdWind(id, v);
          transport.setPresence(id, v > 0.05);
          driven.add(id);
        } else if (driven.has(id)) {
          transport.releaseWind(id);
          transport.setPresence(id, false);
          driven.delete(id);
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      driven.forEach((id) => {
        transport.releaseWind(id);
        transport.setPresence(id, false);
      });
    };
  }, [transport]);

  // ---- presets from /conductor -------------------------------------------
  const [presets, setPresets] = useState<CloudPreset[]>([]);
  const [presetsErr, setPresetsErr] = useState('');
  const [activePreset, setActivePreset] = useState('');
  const loadPresets = () => {
    setPresetsErr('');
    listCloudPresets()
      .then(setPresets)
      .catch((e) => setPresetsErr(String(e?.message ?? e)));
  };
  useEffect(loadPresets, []);

  const pickPreset = (p: CloudPreset) => {
    applyConductorConfig(engine, audio, p.config, chooseFeather);
    setActivePreset(p.id);
  };

  const startAudio = async () => {
    await audio.init(masterGain);
    await audio.resume();
    setAudioReady(true);
  };

  // Loops arrive asynchronously (conductor download → decode → install), so
  // while the mixer is open, poll for channels appearing rather than leaving a
  // stale "no samples" list on screen.
  const loaded = audio.loopChannels();
  useEffect(() => {
    if (sheet !== 'mix') return;
    const id = setInterval(rerender, 500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet]);

  const featherLabel = FEATHERS.find((f) => f.id === feather)?.label ?? feather;
  const joined = devicePeers.reduce((a, b) => a + (b > 0 ? 1 : 0), 0);

  const toggle = (s: Exclude<Sheet, null>) => setSheet((cur) => (cur === s ? null : s));

  return (
    <div className="xp">
      <Projection engine={engine} audio={audio} featherId={feather} paused={false} />

      {/* wordmark */}
      <header className="xp-mark">
        <h1>
          Wing Beat
          <small>experience</small>
        </h1>
        <a className="xp-back" href="/" title="back to the console">
          ✕
        </a>
      </header>

      {/* start audio — the one browser-mandated gesture, made a moment */}
      {!audioReady && (
        <button className="xp-start" onClick={() => void startAudio()}>
          <span className="xp-start-ring" />
          Begin
          <small>tap for sound</small>
        </button>
      )}

      {/* sheets */}
      {sheet === 'feather' && (
        <section className="xp-sheet" data-accent="feather">
          <h2>
            Feather <em>{featherLabel}</em>
          </h2>
          <div className="xp-feathers">
            {FEATHERS.map((f) => (
              <button
                key={f.id}
                className={`xp-feather ${feather === f.id ? 'active' : ''}`}
                onClick={() => chooseFeather(f.id)}
                title={f.label}
              >
                {f.procedural ? (
                  <span className="xp-feather-proc">✦</span>
                ) : (
                  <img src={f.src.replace('/feathers/', '/feathers/thumbs/')} alt={f.label} loading="lazy" decoding="async" />
                )}
                <span className="xp-feather-name">{f.label}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {sheet === 'presets' && (
        <section className="xp-sheet" data-accent="presets">
          <h2>
            Presets <em>from the conductor</em>
            <button className="xp-mini" onClick={loadPresets} title="refresh list">
              ↻
            </button>
          </h2>
          {presetsErr && <div className="xp-note">couldn’t reach the cloud — {presetsErr}</div>}
          {!presetsErr && presets.length === 0 && <div className="xp-note">no saved presets yet — save one in /conductor</div>}
          <div className="xp-presets">
            {presets.map((p) => {
              const fl = FEATHERS.find((f) => f.id === p.feather)?.label ?? p.feather;
              return (
                <button key={p.id} className={`xp-preset ${activePreset === p.id ? 'active' : ''}`} onClick={() => pickPreset(p)}>
                  <b>{p.name}</b>
                  <span>{fl}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {sheet === 'control' && (
        <section className="xp-sheet" data-accent="control">
          <h2>
            Control <em>scan to join on your phone</em>
          </h2>
          <div className="xp-devices">
            {deviceInfo.map((info, i) => (
              <DeviceQr
                key={i}
                index={i}
                partLabel={SENSOR_CHANNELS[i]?.label ?? `Part ${i + 1}`}
                info={info}
                status={deviceStatus[i]}
                peers={devicePeers[i]}
                level={motion}
              />
            ))}
          </div>
        </section>
      )}

      {sheet === 'mix' && (
        <section className="xp-sheet" data-accent="mix">
          <h2>
            Mix <em>sample playback levels</em>
          </h2>

          <div className="xp-master">
            <span className="xp-fader-name">Master</span>
            <input
              className="xp-fader master"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={masterGain}
              onChange={(e) => setMasterGain(parseFloat(e.target.value))}
            />
            <span className="xp-fader-val">{masterGain.toFixed(2)}</span>
          </div>

          {!audioReady && <div className="xp-note">press Begin — the loops load with the audio engine</div>}
          {audioReady && loaded.length === 0 && (
            <div className="xp-note">no sample loaded on any channel — load them per sensor in /conductor</div>
          )}

          {SENSOR_CHANNELS.map((c) => {
            const has = audio.hasLoop(c.sensor);
            const file = audio.loopName(c.sensor);
            const muted = audio.loopMuted(c.sensor);
            return (
              <div className={`xp-mixrow ${has ? '' : 'empty'}`} key={c.sensor}>
                <button
                  className={`xp-mute ${muted ? 'on' : ''}`}
                  disabled={!has}
                  title={muted ? 'unmute' : 'mute'}
                  onClick={() => {
                    audio.setLoopMute(c.sensor, !muted);
                    rerender();
                  }}
                >
                  {muted ? 'M' : '·'}
                </button>
                <span className="xp-fader-name">
                  {c.label}
                  <i title={file || 'no sample'}>{file || '—'}</i>
                </span>
                <input
                  className="xp-fader"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  disabled={!has}
                  value={audio.loopFader(c.sensor)}
                  onChange={(e) => {
                    audio.setLoopFader(c.sensor, parseFloat(e.target.value));
                    rerender();
                  }}
                />
                <span className="xp-fader-val">{audio.loopFader(c.sensor).toFixed(2)}</span>
              </div>
            );
          })}
        </section>
      )}

      {/* dock */}
      <nav className="xp-dock">
        <button className={sheet === 'feather' ? 'on' : ''} data-accent="feather" onClick={() => toggle('feather')}>
          Feather
        </button>
        <button className={sheet === 'presets' ? 'on' : ''} data-accent="presets" onClick={() => toggle('presets')}>
          Presets
        </button>
        <button className={sheet === 'control' ? 'on' : ''} data-accent="control" onClick={() => toggle('control')}>
          Control
          {joined > 0 && <i className="xp-dock-badge">{joined}</i>}
        </button>
        <button className={sheet === 'mix' ? 'on' : ''} data-accent="mix" onClick={() => toggle('mix')}>
          Mix
        </button>
      </nav>
    </div>
  );
}

// One phone slot: QR + code + a live meter once someone joins. The meter reads
// the shared motion ref at ~12 Hz — no per-frame React churn.
function DeviceQr({
  index,
  partLabel,
  info,
  status,
  peers,
  level,
}: {
  index: number;
  partLabel: string;
  info: { deviceId: string; code: string } | null;
  status: LinkStatus;
  peers: number;
  level: React.MutableRefObject<number[]>;
}) {
  const [qr, setQr] = useState('');
  const [lvl, setLvl] = useState(0);
  const url = info ? `${location.origin}/controller?d=${info.deviceId}&c=${info.code}` : '';

  useEffect(() => {
    if (!url) return;
    QRCode.toDataURL(url, { margin: 1, width: 160, color: { dark: '#e8e8e8', light: '#101018' } })
      .then(setQr)
      .catch(() => setQr(''));
  }, [url]);

  useEffect(() => {
    if (peers === 0) return;
    const id = setInterval(() => setLvl(level.current[index] ?? 0), 80);
    return () => clearInterval(id);
  }, [peers, index, level]);

  const connected = peers > 0;
  return (
    <div className={`xp-dev ${connected ? 'joined' : ''}`}>
      <div className="xp-dev-part">{partLabel}</div>
      {connected ? (
        <div className="xp-dev-live">
          <div className="xp-dev-meter">
            <div className="xp-dev-fill" style={{ height: `${Math.round(lvl * 100)}%` }} />
          </div>
          <span>live</span>
        </div>
      ) : qr ? (
        <img className="xp-dev-qr" src={qr} alt={`join ${partLabel}`} />
      ) : (
        <div className="xp-dev-wait">{status === 'error' ? 'error' : '…'}</div>
      )}
      {info && !connected && <div className="xp-dev-code">{info.code}</div>}
    </div>
  );
}
