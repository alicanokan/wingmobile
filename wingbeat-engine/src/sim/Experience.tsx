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
import { useRigTick } from './useRig.ts';
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
import { startHost, type ChannelAd, type Control, type HostHandle, type HostMsg, type LinkStatus } from '../net/link.ts';
import { saveJson } from './persisted.ts';
import { useConductorSync, applyConductorConfig } from '../net/liveSync.ts';
import { listCloudPresets, type CloudPreset } from '../net/cloud.ts';
import { DEVICE_COUNT } from './inputs.ts';

type Sheet = 'feather' | 'presets' | 'control' | 'mix' | null;

// Each phone slot drives one feather part, fixed 1:1 (dev1→Tip … dev5→Tail):
// no routing matrix here — that's what the console is for.
const SLOT_PART = SENSOR_CHANNELS.map((c) => c.sensor);

// ---- control groups ---------------------------------------------------------
// A group is ONE extra room whose phone drives SEVERAL parts at once: pick the
// parts in the Control sheet, mint a code, and every motion frame that arrives
// on it fans out to all of them. Groups persist across reloads (same codes, so
// a paired phone survives a page refresh).
const GROUPS_KEY = 'wb.xpGroups.v1';
interface SavedGroup { deviceId?: string; code?: string; slots: number[] }
interface GroupView { uid: number; slots: number[]; deviceId: string; code: string; status: LinkStatus; peers: number }

function loadSavedGroups(): SavedGroup[] {
  try {
    const raw = JSON.parse(localStorage.getItem(GROUPS_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    const ok = (v: unknown) => typeof v === 'string' && /^[A-Z0-9]{3,8}$/.test(v);
    return raw
      .map((g) => {
        if (!g || typeof g !== 'object' || !Array.isArray((g as SavedGroup).slots)) return null;
        const slots = [...new Set((g as SavedGroup).slots.filter((i) => typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < DEVICE_COUNT))].sort((a, b) => a - b);
        if (slots.length < 2) return null;
        const sg = g as Record<string, unknown>;
        return { slots, ...(ok(sg.deviceId) ? { deviceId: sg.deviceId as string } : {}), ...(ok(sg.code) ? { code: sg.code as string } : {}) } as SavedGroup;
      })
      .filter((g): g is SavedGroup => !!g);
  } catch {
    return [];
  }
}

export default function Experience() {
  const engine = useMemo(() => new WingbeatEngine(), []);
  const audio = useMemo(() => new AudioEngine(), []);
  const [feather, setFeather] = useState(DEFAULT_FEATHER);
  const [audioReady, setAudioReady] = useState(false);
  const [masterGain, setMasterGain] = useState(0.7);
  const [sheet, setSheet] = useState<Sheet>(null);
  const rerender = useRigTick(); // mixer + rig rerender

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

  // Wire audio onto the engine bus. Without this the AudioEngine has no engine
  // reference, so init() never starts the drone bed and never emits audioReady
  // — which is what installs the conductor's loop samples. No attach, no sound.
  useEffect(() => {
    const detach = audio.attach(engine);
    const off = engine.on('audioReady', () => setAudioReady(true));
    return () => {
      detach();
      off();
    };
  }, [audio, engine]);

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

  // No drone here. The bed is a continuous pad that starts with the audio
  // engine and never stops — right for the console, wrong for a page whose
  // whole point is the sample loops. Muted before init(), so the bus is built
  // silent rather than fading down after you hear it.
  useEffect(() => {
    audio.setLayerMute('bed', true);
  }, [audio]);

  // ---- phone controllers: one host per slot, slot i drives part i ---------
  const linksRef = useRef<HostHandle[]>([]);
  const motion = useRef<number[]>(Array(DEVICE_COUNT).fill(0));
  const stale = useRef<Array<ReturnType<typeof setTimeout> | undefined>>(Array(DEVICE_COUNT).fill(undefined));
  const [deviceInfo, setDeviceInfo] = useState<Array<{ deviceId: string; code: string } | null>>(Array(DEVICE_COUNT).fill(null));
  const [devicePeers, setDevicePeers] = useState<number[]>(Array(DEVICE_COUNT).fill(0));
  const [deviceStatus, setDeviceStatus] = useState<LinkStatus[]>(Array(DEVICE_COUNT).fill('idle'));

  const [groups, setGroups] = useState<GroupView[]>([]);
  const [groupSel, setGroupSel] = useState<Set<number>>(new Set());
  const groupHostsRef = useRef<Map<number, HostHandle>>(new Map());
  const groupDefsRef = useRef<Map<number, SavedGroup>>(new Map());
  const groupUid = useRef(0);
  const adsRef = useRef<ChannelAd[]>([]);

  // One motion frame in → one or many parts driven. Devices pass [i]; groups
  // pass their whole slot list.
  const feedMotion = (i: number, v: number) => {
    motion.current[i] = Math.max(0, Math.min(1, v));
    if (stale.current[i]) clearTimeout(stale.current[i]);
    stale.current[i] = setTimeout(() => {
      motion.current[i] = 0;
    }, 1500);
  };
  const handleControl = (c: Control, slots: number[]) => {
    switch (c.t) {
      case 'motion':
      case 'blow':
        for (const i of slots) feedMotion(i, c.v);
        break;
      case 'scene':
        engine.setScene(c.key);
        break;
      case 'bpm': {
        const v = Number(c.v);
        if (!Number.isFinite(v)) break;
        const bpm = Math.max(40, Math.min(220, Math.round(v)));
        rig.global.bpm = bpm; // the ONE tempo store; audio follows it
        audio.setBpm(bpm);
        break;
      }
      case 'master':
        setMasterGain(Math.max(0, Math.min(1, c.v)));
        break;
      case 'fx':
        audio.setFx(c.x, c.y, c.on);
        break;
    }
  };

  const persistGroups = () =>
    saveJson(GROUPS_KEY, [...groupDefsRef.current.values()].map((g) => ({ deviceId: g.deviceId, code: g.code, slots: g.slots })));

  const spawnGroup = (slots: number[], saved?: SavedGroup) => {
    const uid = ++groupUid.current;
    groupDefsRef.current.set(uid, { slots, deviceId: saved?.deviceId, code: saved?.code });
    const h = startHost({
      deviceId: saved?.deviceId,
      code: saved?.code,
      onStatus: (st) => setGroups((gs) => gs.map((g) => (g.uid === uid ? { ...g, status: st } : g))),
      onIdentity: (d, c) => {
        groupDefsRef.current.set(uid, { slots, deviceId: d, code: c });
        persistGroups();
        setGroups((gs) => gs.map((g) => (g.uid === uid ? { ...g, deviceId: d, code: c } : g)));
      },
      onPeers: (n) => setGroups((gs) => gs.map((g) => (g.uid === uid ? { ...g, peers: n } : g))),
      onControl: (c) => handleControl(c, slots),
      hello: () => ({ t: 'channels', list: adsRef.current }),
    });
    groupHostsRef.current.set(uid, h);
    persistGroups();
    setGroups((gs) => [...gs, { uid, slots, deviceId: h.deviceId, code: h.code, status: 'connecting', peers: 0 }]);
  };

  const removeGroup = (uid: number) => {
    groupHostsRef.current.get(uid)?.destroy();
    groupHostsRef.current.delete(uid);
    groupDefsRef.current.delete(uid);
    persistGroups();
    setGroups((gs) => gs.filter((g) => g.uid !== uid));
  };

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
        onControl: (c) => handleControl(c, [i]),
        hello: () => ({ t: 'channels', list: adsRef.current }),
      }),
    );
    setDeviceInfo(linksRef.current.map((h) => ({ deviceId: h.deviceId, code: h.code })));
    // groups saved by an earlier session come back with the SAME codes
    loadSavedGroups().forEach((g) => spawnGroup(g.slots, g));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(
    () => () => {
      stale.current.forEach((t) => t && clearTimeout(t));
      linksRef.current.forEach((h) => h.destroy());
      linksRef.current = [];
      groupHostsRef.current.forEach((h) => h.destroy());
      groupHostsRef.current.clear();
    },
    [],
  );

  // Keep every connected phone's channel directory current: the "+" button on
  // a phone lists exactly these (free ones), so nobody reads codes off the
  // projection screen.
  useEffect(() => {
    const list: ChannelAd[] = [];
    deviceInfo.forEach((info, i) => {
      if (info) list.push({ d: info.deviceId, c: info.code, label: SENSOR_CHANNELS[i]?.label ?? `Part ${i + 1}`, peers: devicePeers[i] ?? 0, kind: 'part' });
    });
    for (const g of groups) {
      list.push({ d: g.deviceId, c: g.code, label: g.slots.map((i) => SENSOR_CHANNELS[i]?.label ?? `P${i + 1}`).join(' + '), peers: g.peers, kind: 'group' });
    }
    adsRef.current = list;
    const msg: HostMsg = { t: 'channels', list };
    linksRef.current.forEach((h) => h.broadcast(msg));
    groupHostsRef.current.forEach((h) => h.broadcast(msg));
  }, [deviceInfo, devicePeers, groups]);

  // ---- keyboard: each key press puffs air into its part ------------------
  //
  // Same balloon behaviour as the conductor's Pulse: a press pumps air IN and
  // presses STACK, then the air leaks back out at that part's Release. Keys are
  // per-channel (q w e r t), so the page is playable without a phone.
  const keyAir = useRef<number[]>(new Array(SLOT_PART.length).fill(0));

  // Console-debuggable, same as the operator page.
  useEffect(() => {
    (window as unknown as { xp?: object }).xp = { audio, engine, transport, rig, motion, keyAir };
  }, [audio, engine, transport]);
  useEffect(() => {
    const onDown = (ev: KeyboardEvent) => {
      if (ev.repeat || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      // don't fire while someone is working a fader or a number box
      const tag = (ev.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const i = SENSOR_CHANNELS.findIndex((c) => c.key === ev.key.toLowerCase());
      if (i < 0) return;
      ev.preventDefault();
      const sens = rig.sensors[SLOT_PART[i]]?.sensitivity ?? 1;
      keyAir.current[i] = Math.min(1, keyAir.current[i] + 0.4 * Math.min(1.5, sens));
    };
    window.addEventListener('keydown', onDown);
    return () => window.removeEventListener('keydown', onDown);
  }, []);

  // The input pump: each slot's motion → its fixed part, shaped by rig
  // sensitivity. Runs on a TIMER, not requestAnimationFrame — rAF stops
  // COMPLETELY when the tab is hidden (behind another window, screen off),
  // which silenced the whole page the moment you looked away from it while
  // playing from a phone. A timer is throttled in a hidden tab but keeps
  // ticking, and once sound is audible Chrome stops throttling it entirely.
  useEffect(() => {
    let last = performance.now();
    const driven = new Set<string>();
    const loop = () => {
      const t = performance.now();
      const dt = Math.min(0.25, (t - last) / 1000);
      last = t;
      for (let i = 0; i < SLOT_PART.length; i++) {
        const id = SLOT_PART[i];
        const sens = rig.sensors[id]?.sensitivity ?? 1;
        // key air leaks out at this part's Release, exactly like a pulse
        const rel = rig.sensors[id]?.release ?? 0.08;
        if (keyAir.current[i] > 0) {
          keyAir.current[i] = Math.max(0, keyAir.current[i] - dt * (0.2 + rel * 5));
        }
        // phone motion and key air both drive the part — loudest wins
        const v = Math.min(1, Math.max((motion.current[i] ?? 0) * sens, keyAir.current[i]));
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
    const timer = setInterval(loop, 33);
    return () => {
      clearInterval(timer);
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
  const joined = devicePeers.reduce((a, b) => a + (b > 0 ? 1 : 0), 0) + groups.reduce((a, g) => a + (g.peers > 0 ? 1 : 0), 0);

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
            Control <em>scan to join · or press the key</em>
          </h2>
          <div className="xp-devices">
            {deviceInfo.map((info, i) => (
              <DeviceQr
                key={i}
                label={SENSOR_CHANNELS[i]?.label ?? `Part ${i + 1}`}
                partKey={SENSOR_CHANNELS[i]?.key ?? ''}
                info={info}
                status={deviceStatus[i]}
                peers={devicePeers[i]}
                level={motion}
                indices={[i]}
              />
            ))}
          </div>

          <div className="xp-groupbar">
            <div className="xp-note">
              Group — one code, several parts: a phone that joins it drives them all with the same gesture. Pick parts, mint a code.
            </div>
            <div className="xp-groupchips">
              {SENSOR_CHANNELS.map((c, i) => (
                <button
                  key={c.sensor}
                  className={`xp-chip ${groupSel.has(i) ? 'active' : ''}`}
                  onClick={() =>
                    setGroupSel((sel) => {
                      const next = new Set(sel);
                      if (next.has(i)) next.delete(i);
                      else next.add(i);
                      return next;
                    })
                  }
                >
                  {c.label}
                </button>
              ))}
              <button
                className="xp-chip make"
                disabled={groupSel.size < 2}
                title={groupSel.size < 2 ? 'pick at least two parts' : 'create a QR + code for this combination'}
                onClick={() => {
                  spawnGroup([...groupSel].sort((a, b) => a - b));
                  setGroupSel(new Set());
                }}
              >
                ＋ create group code
              </button>
            </div>
            {groups.length > 0 && (
              <div className="xp-devices">
                {groups.map((g) => (
                  <DeviceQr
                    key={g.uid}
                    label={g.slots.map((i) => SENSOR_CHANNELS[i]?.label ?? `P${i + 1}`).join(' + ')}
                    kindTag="group"
                    info={{ deviceId: g.deviceId, code: g.code }}
                    status={g.status}
                    peers={g.peers}
                    level={motion}
                    indices={g.slots}
                    onRemove={() => removeGroup(g.uid)}
                  />
                ))}
              </div>
            )}
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

// One joinable room: QR + code + a live meter once someone joins — a single
// part or a whole group (the meter then shows the loudest of its parts). The
// meter reads the shared motion ref at ~12 Hz — no per-frame React churn.
function DeviceQr({
  label,
  partKey,
  kindTag,
  info,
  status,
  peers,
  level,
  indices,
  onRemove,
}: {
  label: string;
  partKey?: string;
  kindTag?: string;
  info: { deviceId: string; code: string } | null;
  status: LinkStatus;
  peers: number;
  level: React.MutableRefObject<number[]>;
  indices: number[];
  onRemove?: () => void;
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
    const id = setInterval(() => setLvl(Math.max(...indices.map((i) => level.current[i] ?? 0), 0)), 80);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peers, indices.join(','), level]);

  const connected = peers > 0;
  return (
    <div className={`xp-dev ${connected ? 'joined' : ''}`}>
      {onRemove && (
        <button className="xp-dev-remove" title="remove this group" onClick={onRemove}>
          ✕
        </button>
      )}
      <div className="xp-dev-part">
        {label}
        {partKey && <kbd title={`press ${partKey.toUpperCase()} to pump this part`}>{partKey.toUpperCase()}</kbd>}
      </div>
      {kindTag && <div className="xp-dev-tag">{kindTag}</div>}
      {connected ? (
        <div className="xp-dev-live">
          <div className="xp-dev-meter">
            <div className="xp-dev-fill" style={{ height: `${Math.round(lvl * 100)}%` }} />
          </div>
          <span>live</span>
        </div>
      ) : qr ? (
        <img className="xp-dev-qr" src={qr} alt={`join ${label}`} />
      ) : (
        <div className="xp-dev-wait">{status === 'error' ? 'error' : '…'}</div>
      )}
      {info && !connected && <div className="xp-dev-code">{info.code}</div>}
    </div>
  );
}
