import { ExperienceGuide, ExperiencePanelBar, ExperienceStepHint, type ExperienceStep } from './ExperienceGuide.tsx';
import { AudioOutputPanel } from './AudioOutputPanel.tsx';
// ============================================================================
//  /experience — the distilled front-of-house page.
//
//  The console (/) exposes everything; this page exposes the four things a
//  visitor or performer actually touches, over a full-bleed feather:
//
//    · FEATHER  — pick which feather is alive
//    · PRESETS  — recall the configs saved in /conductor (rig + loops + scene)
//    · CONTROL  — QR codes so phones join as controllers (dev1..dev5 → parts),
//                 and what those phones are allowed to change
//    · MIX      — layer mixer with a master fader, tempo and scene
//    · PLAY     — the living feather: each trigger channel drives one part of
//                 the feather with a chosen movement, strength and speed
//
//  One sheet open at a time; the feather stays the star. Live pushes from
//  /conductor still land here (useConductorSync), so the page follows the
//  installation. Deliberately dark-only: it wraps the projection surface.
// ============================================================================

import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { useRigTick } from './useRig.ts';
import './ui.css';
import './experience.css';
import QRCode from 'qrcode';
import { WingbeatEngine } from '../engine/WingbeatEngine.ts';
import { AudioEngine } from '../engine/AudioEngine.ts';
import { SimTransport } from '../transports/SimTransport.ts';
import { MqttTransport } from '../transports/MqttTransport.ts';
import type { TransportStatus } from '../transports/Transport.ts';
import { ledService } from '../led/ledService.ts';
import { engineLedInputs } from '../led/engineInputs.ts';
import { LedPanel } from './LedPanel.tsx';
import { Projection } from './Projection.tsx';
import { FEATHERS, DEFAULT_FEATHER } from './feathers.ts';
import { SENSOR_CHANNELS } from './channels.ts';
import { rig, onRigChange } from './rig.ts';
import { startHost, controlAllowed, PHONE_PERMS, type ChannelAd, type Control, type HostHandle, type HostMsg, type LinkStatus, type PhonePerms } from '../net/link.ts';
import { InputArbiter } from '../net/arbiter.ts';
import { SCENES, SCENE_KEYS } from '../engine/scenes.ts';
import { loadJson, saveJson, finite, oneOf } from './persisted.ts';
import { PLAY_EFFECTS, PLAY_PARTS, playChannelsFromClassic, validatePlayChannels, type FeatherPlay, type PlayChannel } from '../feather2/play.ts';
import { loadFeatherPresets, onFeatherPresetsChange, type FeatherPreset } from '../feather2/presets.ts';
import { useConductorSync, applyConductorConfig } from '../net/liveSync.ts';
import { listCloudPresets, type CloudPreset } from '../net/cloud.ts';
import { DEVICE_COUNT } from './inputs.ts';

// The studio renderer pulls three.js and the anatomy engine; load it only
// when the living feather is on screen.
const Feather2 = lazy(() => import('../feather2/Feather2.tsx'));

type Sheet = 'feather' | 'presets' | 'control' | 'mix' | 'play' | null;
type Renderer = 'living' | 'classic';
const RENDERER_KEY = 'wb.xpRenderer.v1';
const PLAY_KEY = 'wb.xpPlay.v1';
const PULSE_KEY = 'wb.xpPulse.v1';
const MASTER_KEY = 'wb.xpMaster.v1';
const PERMS_KEY = 'wb.xpPerms.v1';
const GUIDE_KEY = 'wb.xpGuide.dismissed.v1';
const PERMS_LABEL: Record<PhonePerms, { name: string; hint: string }> = {
  play: { name: 'Play only', hint: 'phones move the feather, nothing else' },
  fx: { name: 'Play + FX', hint: 'phones also sweep the FX pad' },
  full: { name: 'Everything', hint: 'phones also change scene, tempo and master volume' },
};
const SHEET_KEYS: Record<string, Exclude<Sheet, null>> = { '1': 'feather', '2': 'control', '3': 'play', '4': 'mix', '5': 'presets' };
/** Level of a simulated held finger — the phone pad's own hold level. */
const TEST_HOLD_LEVEL = 0.7;

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
  const [feather, setFeather] = useState(FEATHERS.find((f) => !f.procedural)!.id);
  const [audioReady, setAudioReady] = useState(false);
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioError, setAudioError] = useState('');
  const [masterGain, setMasterGain] = useState(() => loadJson(MASTER_KEY, (raw) => finite(raw, 0.7, 0, 1)));
  const [sheet, setSheet] = useState<Sheet>(null);
  const [guideOpen, setGuideOpen] = useState(() => !loadJson(GUIDE_KEY, (raw) => raw === true));
  const [guideEnabled, setGuideEnabled] = useState(guideOpen);
  const dockRef = useRef<HTMLElement>(null);
  const guideToggleRef = useRef<HTMLButtonElement>(null);
  const closePanel = () => {
    dockRef.current?.querySelector<HTMLButtonElement>('button.on')?.focus();
    setSheet(null);
  };
  const dismissGuide = () => {
    setGuideOpen(false); setGuideEnabled(false); setSheet(null);
    saveJson(GUIDE_KEY, true);
    guideToggleRef.current?.focus();
  };
  const openGuideStep = (step: ExperienceStep | null) => {
    setGuideOpen(false); setSheet(step);
    setGuideEnabled(step !== null);
    if (step === null) {
      saveJson(GUIDE_KEY, true);
      guideToggleRef.current?.focus();
    }
  };
  const rerender = useRigTick(); // mixer + rig rerender

  // ---- the living feather ------------------------------------------------
  // The studio's renderer replaces the classic particle projection. Each of
  // the five trigger channels drives one part of the feather with one
  // movement; the pump below writes the live level, the renderer envelopes it.
  const [renderer, setRenderer] = useState<Renderer>(() => loadJson(RENDERER_KEY, (raw) => (raw === 'classic' ? 'classic' : 'living')));
  useEffect(() => saveJson(RENDERER_KEY, renderer), [renderer]);
  // First run: mirror the classic rig (its motion shapes and reach), so the
  // living feather plays the way the installation was already tuned.
  const classicChannels = () => playChannelsFromClassic(SLOT_PART.map((id) => rig.sensors[id]), DEVICE_COUNT);
  const play = useMemo<FeatherPlay>(() => ({
    levels: Array(DEVICE_COUNT).fill(0),
    channels: loadJson(PLAY_KEY, (raw) => (raw === undefined ? classicChannels() : validatePlayChannels(raw, DEVICE_COUNT))),
    // levels are shaped below with the rig's attack/release, exactly like the
    // classic particles — hold sustains, release lets go at the rig's rate
    enveloped: true,
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [, setPlayTick] = useState(0);
  const [playChannel, setPlayChannel] = useState(0);
  // Until a channel is edited by hand, keep mirroring the rig: it loads after
  // this page seeds, and conductor presets replace it live.
  const followClassic = useRef(loadJson(PLAY_KEY, (raw) => raw === undefined));
  useEffect(() => {
    const sync = () => {
      if (!followClassic.current) return;
      play.channels.splice(0, play.channels.length, ...classicChannels());
      setPlayTick((t) => t + 1);
    };
    sync();
    return onRigChange(sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play]);
  // Test switch per channel: a simulated held finger (the phone pad's hold
  // level), so a movement can be checked without a phone or a key.
  const testHold = useRef<boolean[]>(Array(DEVICE_COUNT).fill(false));
  const [testTick, setTestTick] = useState(0);
  const toggleTest = (i: number) => {
    testHold.current[i] = !testHold.current[i];
    setTestTick((t) => t + 1);
  };
  const updateChannel = (i: number, patch: Partial<PlayChannel>) => {
    followClassic.current = false;
    Object.assign(play.channels[i], patch);
    saveJson(PLAY_KEY, play.channels);
    setPlayTick((t) => t + 1);
  };
  const matchClassic = () => {
    followClassic.current = false;
    play.channels.splice(0, play.channels.length, ...classicChannels());
    saveJson(PLAY_KEY, play.channels);
    setPlayTick((t) => t + 1);
  };

  const chooseFeather = (id: string) => {
    setFeather(id);
    engine.setFeather(id);
  };

  // ---- engine room (sim transport populates the sensor ring) --------------
  const [inputMode, setInputMode] = useState<'sim' | 'mqtt'>(() => loadJson('wb.xpInput.v1', (raw) => raw === 'mqtt' ? 'mqtt' : 'sim'));
  const [mqttUrl, setMqttUrl] = useState(() => ledService.config.url);
  const [brokerUrl, setBrokerUrl] = useState(mqttUrl);
  const [inputStatus, setInputStatus] = useState<TransportStatus>('idle');
  const [showLights, setShowLights] = useState(false);
  useEffect(() => {
    saveJson('wb.xpInput.v1', inputMode);
    const transport = inputMode === 'mqtt' ? new MqttTransport({ url: brokerUrl, led: ledService }) : new SimTransport({});
    const off = transport.onStatus(setInputStatus);
    transport.connect(engine);
    if (inputMode === 'mqtt') ledService.connect(brokerUrl);
    return () => {
      off(); transport.disconnect();
      if (inputMode === 'mqtt') ledService.disconnect();
    };
  }, [inputMode, brokerUrl, engine]);
  useEffect(() => {
    if (renderer !== 'classic') return;
    const timer = setInterval(() => ledService.push(engineLedInputs(engine)), 40);
    return () => clearInterval(timer);
  }, [engine, renderer]);
  useEffect(() => { engine.setFeather(feather); }, [engine, feather]);

  // Wire audio onto the engine bus. Without this the AudioEngine has no engine
  // reference, so init() never starts the drone bed and never emits audioReady
  // — which is what installs the conductor's loop samples. No attach, no sound.
  useEffect(() => {
    const detach = audio.attach(engine);
    const off = engine.on('audioReady', () => setAudioReady(true));
    return () => {
      detach();
      off();
      audio.dispose();
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
    saveJson(MASTER_KEY, masterGain);
  }, [audio, masterGain]);

  // ---- scene + tempo: the same two stores the phones write ----------------
  const [scene, setSceneState] = useState(engine.scene);
  useEffect(() => engine.on('scene', (e: { key: string }) => setSceneState(e.key)), [engine]);
  const bpm = rig.global.bpm;
  const chooseBpm = (v: number) => {
    if (!Number.isFinite(v)) return;
    const next = Math.max(40, Math.min(220, Math.round(v)));
    if (next === rig.global.bpm) return;
    rig.global.bpm = next; // the ONE tempo store; audio follows it
    audio.setBpm(next);
    rerender();
  };

  // No drone here. The bed is a continuous pad that starts with the audio
  // engine and never stops — right for the console, wrong for a page whose
  // whole point is the sample loops. Muted before init(), so the bus is built
  // silent rather than fading down after you hear it.
  useEffect(() => {
    audio.setLayerMute('bed', true);
  }, [audio]);

  // The engine's GENERATIVE PULSE — a bell on presence, a pluck on each wind
  // crest, a drum on motion — ticks like a metronome under every gesture. On
  // this page the loops are the sound, so it is off unless switched on in Mix.
  const [pulse, setPulse] = useState(() => loadJson(PULSE_KEY, (raw) => raw === true));
  useEffect(() => {
    engine.setPatterns(pulse);
    saveJson(PULSE_KEY, pulse);
  }, [engine, pulse]);

  // ---- phone controllers: one host per slot, slot i drives part i ---------
  const linksRef = useRef<HostHandle[]>([]);
  /** merged level per slot, written by the pump from the arbiter — meters read it */
  const motion = useRef<number[]>(Array(DEVICE_COUNT).fill(0));
  // Several phones can be on one part (a room takes many, groups overlap the
  // part rooms): the arbiter keeps each hand apart and merges loudest-wins.
  const arb = useMemo(() => new InputArbiter(DEVICE_COUNT), []);
  const fxApplied = useRef({ x: 0, y: 0, on: false });
  const applyFx = (f: { x: number; y: number; on: boolean }) => {
    const a = fxApplied.current;
    if (a.on === f.on && a.x === f.x && a.y === f.y) return;
    fxApplied.current = f;
    audio.setFx(f.x, f.y, f.on);
  };
  // Key / puff air per part (see the keyboard section below).
  const keyAir = useRef<number[]>(new Array(SLOT_PART.length).fill(0));
  const puff = (i: number, amount: number) => {
    const sens = rig.sensors[SLOT_PART[i]]?.sensitivity ?? 1;
    keyAir.current[i] = Math.min(1, keyAir.current[i] + amount * Math.min(1.5, sens));
  };
  // What phones may change. Visitors' phones on a show night should not reach
  // the master fader; the operator's own phone should.
  const [perms, setPerms] = useState<PhonePerms>(() => loadJson(PERMS_KEY, (raw) => oneOf(raw, PHONE_PERMS, 'full')));
  const permsRef = useRef(perms);
  permsRef.current = perms;
  const masterRef = useRef(masterGain);
  masterRef.current = masterGain;
  useEffect(() => {
    saveJson(PERMS_KEY, perms);
    // a pad held when FX was locked must not leave the filter parked
    if (perms === 'play') {
      arb.clearFx();
      applyFx({ x: 0, y: 0, on: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perms]);
  const [deviceInfo, setDeviceInfo] = useState<Array<{ deviceId: string; code: string } | null>>(Array(DEVICE_COUNT).fill(null));
  const [devicePeers, setDevicePeers] = useState<number[]>(Array(DEVICE_COUNT).fill(0));
  const [deviceStatus, setDeviceStatus] = useState<LinkStatus[]>(Array(DEVICE_COUNT).fill('idle'));

  const [groups, setGroups] = useState<GroupView[]>([]);
  const [groupSel, setGroupSel] = useState<Set<number>>(new Set());
  const groupHostsRef = useRef<Map<number, HostHandle>>(new Map());
  const groupDefsRef = useRef<Map<number, SavedGroup>>(new Map());
  const groupUid = useRef(0);
  const adsRef = useRef<ChannelAd[]>([]);

  // One control frame in → one or many parts driven. Devices pass [i]; groups
  // pass their whole slot list; `from` is the sending phone, so hands stay apart.
  const handleControl = (c: Control, slots: number[], from: string) => {
    if (!controlAllowed(permsRef.current, c.t)) return;
    switch (c.t) {
      case 'motion':
        arb.feed(from, slots, c.v, performance.now());
        break;
      case 'blow':
        // a one-shot puff, not a level: pump air in and let the part's Release
        // leak it out (as a level it used to hang for the 1.5 s stale window)
        for (const i of slots) puff(i, c.v * 0.8);
        break;
      case 'scene':
        engine.setScene(c.key);
        break;
      case 'bpm':
        chooseBpm(Number(c.v));
        break;
      case 'master':
        setMasterGain(Math.max(0, Math.min(1, c.v)));
        break;
      case 'fx':
        applyFx(arb.feedFx(from, c.x, c.y, c.on, performance.now()));
        break;
    }
  };

  // What a phone is told when it joins, and whenever any of it changes: the
  // channel directory plus the host's real scene / tempo / master / permissions.
  const stateMsg = (): HostMsg => ({ t: 'state', bpm: rig.global.bpm, master: masterRef.current, scene: engine.scene, perms: permsRef.current });
  const greet = (): HostMsg[] => [{ t: 'channels', list: adsRef.current }, stateMsg()];
  const broadcast = (m: HostMsg) => {
    linksRef.current.forEach((h) => h.broadcast(m));
    groupHostsRef.current.forEach((h) => h.broadcast(m));
  };
  // Debounced: a dragged fader changes 60×/s, phones need the value it lands on.
  useEffect(() => {
    const id = setTimeout(() => broadcast(stateMsg()), 150);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bpm, masterGain, scene, perms]);

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
      onControl: (c, from) => handleControl(c, slots, from),
      onDrop: (from) => arb.drop(from),
      hello: greet,
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
        onControl: (c, from) => handleControl(c, [i], from),
        onDrop: (from) => arb.drop(from),
        hello: greet,
      }),
    );
    setDeviceInfo(linksRef.current.map((h) => ({ deviceId: h.deviceId, code: h.code })));
    // groups saved by an earlier session come back with the SAME codes
    loadSavedGroups().forEach((g) => spawnGroup(g.slots, g));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(
    () => () => {
      arb.clear();
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
    broadcast({ t: 'channels', list });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceInfo, devicePeers, groups]);

  // ---- keyboard: each key press puffs air into its part ------------------
  //
  // Same balloon behaviour as the conductor's Pulse: a press pumps air IN and
  // presses STACK, then the air leaks back out at that part's Release. Keys are
  // per-channel (q w e r t), so the page is playable without a phone. 1–5 open
  // the sheets and Esc closes them, so the page runs without a mouse too.

  // Console-debuggable, same as the operator page.
  useEffect(() => {
    (window as unknown as { xp?: object }).xp = { audio, engine, rig, motion, keyAir, play, arb };
  }, [audio, engine, play, arb]);
  useEffect(() => {
    const onDown = (ev: KeyboardEvent) => {
      if (ev.repeat || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (ev.key === 'Escape') { setGuideOpen(false); return closePanel(); }
      // don't fire while someone is working a fader or a number box
      const tag = (ev.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const sheetKey = SHEET_KEYS[ev.key];
      if (sheetKey) { setGuideOpen(false); return setSheet((cur) => (cur === sheetKey ? null : sheetKey)); }
      const i = SENSOR_CHANNELS.findIndex((c) => c.key === ev.key.toLowerCase());
      if (i < 0) return;
      ev.preventDefault();
      puff(i, 0.4);
    };
    window.addEventListener('keydown', onDown);
    return () => window.removeEventListener('keydown', onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const present = new Set<string>();
    const loop = () => {
      const t = performance.now();
      const dt = Math.min(0.25, (t - last) / 1000);
      last = t;
      // frames of the classic per-frame envelope (rate per 60 Hz frame) that
      // fit in this tick, so both renderers feel the same at any tick rate
      const frames = dt * 60;
      // a pad whose phone vanished mid-hold goes stale here; the bus follows
      if (fxApplied.current.on) applyFx(arb.fxState(t));
      for (let i = 0; i < SLOT_PART.length; i++) {
        const id = SLOT_PART[i];
        const sens = rig.sensors[id]?.sensitivity ?? 1;
        // key air leaks out at this part's Release, exactly like a pulse
        const rel = rig.sensors[id]?.release ?? 0.08;
        if (keyAir.current[i] > 0) {
          keyAir.current[i] = Math.max(0, keyAir.current[i] - dt * (0.2 + rel * 5));
        }
        // phone motion, key air and the test switch all drive the part — loudest wins
        const hands = (motion.current[i] = arb.level(i, t));
        const v = Math.min(1, Math.max(hands * sens, keyAir.current[i], testHold.current[i] ? TEST_HOLD_LEVEL * sens : 0));
        // Presence goes to the engine on the EDGE only: every call runs a full
        // ingest + encounter publish, and the held wind (re-emitted by the
        // transport at 20 Hz) already keeps the node fresh.
        const here = v > 0.05;
        if (here !== present.has(id)) {
          engine.ingestPresence(id, here, 'touch');
          if (here) present.add(id);
          else present.delete(id);
        }
        if (v > 0.001) {
          engine.ingestWind(id, v, 'touch');
          driven.add(id);
        } else if (driven.has(id)) {
          engine.ingestWind(id, 0, 'touch');
          driven.delete(id);
        }
        // Read the merged engine input: a real sensor and a phone can play
        // the same part, and either release leaves the other source intact.
        const node = engine.getNode(id);
        const level = node?.online ? Math.min(1, Math.max(node.wind, node.motion, node.present ? 0.7 : 0)) : 0;
        const s = rig.sensors[id];
        const env = s?.modules.release;
        const rate = level > play.levels[i] ? (env ? s.attack : rig.global.attack) : env ? s.release : rig.global.release;
        play.levels[i] += (level - play.levels[i]) * (1 - Math.pow(1 - Math.min(1, rate), frames));
      }
    };
    const timer = setInterval(loop, 33);
    return () => {
      clearInterval(timer);
      play.levels.fill(0);
      testHold.current.fill(false);
      engine.clearInputSource('touch');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, play, arb]);

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

  // ---- feather looks saved in the studio (/feather2, same device) ---------
  const [studioPresets, setStudioPresets] = useState<FeatherPreset[]>(loadFeatherPresets);
  const [studioPreset, setStudioPreset] = useState<FeatherPreset | null>(null);
  useEffect(() => onFeatherPresetsChange(() => setStudioPresets(loadFeatherPresets())), []);
  useEffect(() => {
    if (sheet === 'presets') setStudioPresets(loadFeatherPresets());
  }, [sheet]);
  const pickStudioPreset = (p: FeatherPreset) => {
    setRenderer('living');
    if (p.feather) chooseFeather(p.feather);
    setStudioPreset(p);
  };

  const startAudio = async () => {
    if (audioBusy) return;
    setAudioBusy(true);
    setAudioError('');
    try {
      audio.setMasterGain(masterGain);
      await audio.start();
      setAudioReady(true);
    } catch (err) {
      setAudioError(err instanceof Error ? err.message : 'Sound could not start. Tap Begin to try again.');
    } finally { setAudioBusy(false); }
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

  const toggle = (s: Exclude<Sheet, null>) => { setGuideOpen(false); setSheet((cur) => (cur === s ? null : s)); };
  const panelBar = <ExperiencePanelBar label={sheet ? sheet[0].toUpperCase() + sheet.slice(1) : ''} onClose={closePanel} onSkip={guideEnabled ? dismissGuide : undefined} />;
  const stepHint = <ExperienceStepHint sheet={sheet} showDirections={guideEnabled} onNext={openGuideStep} audioReady={audioReady} audioBusy={audioBusy} onStartAudio={() => void startAudio()} />;

  return (
    <div className="xp">
      {renderer === 'living' ? (
        <Suspense fallback={null}>
          <Feather2 embedded featherId={feather} play={play} preset={studioPreset} runtime={{ engine, audio }} />
        </Suspense>
      ) : (
        <Projection engine={engine} audio={audio} featherId={feather} paused={false} />
      )}

      {/* wordmark */}
      <header className="xp-mark">
        <h1>
          Wing Beat
          <small>experience</small>
        </h1>
        <div className="xp-mark-actions">
          <button ref={guideToggleRef} className="xp-guide-toggle" aria-expanded={guideOpen} aria-controls="xp-getting-started" onClick={() => { setSheet(null); setGuideEnabled(true); setGuideOpen((open) => !open); }}>How to play</button>
          <a className="xp-back" href="/" title="back to the landing page" aria-label="Back to landing page">✕</a>
        </div>
      </header>

      {guideOpen && sheet === null && <ExperienceGuide onPick={openGuideStep} onDismiss={dismissGuide} />}

      {/* start audio — the one browser-mandated gesture, made a moment */}
      {!audioReady && !sheet && (
        <button className="xp-start" onClick={() => void startAudio()} disabled={audioBusy}>
          <span className="xp-start-ring" />
          {audioBusy ? 'Starting…' : 'Begin'}
          <small>{audioBusy ? 'opening sound' : 'tap for sound'}</small>
        </button>
      )}
      {audioError && <div className="xp-audio-error" role="alert">{audioError}</div>}

      {/* sheets */}
      {sheet === 'feather' && (
        <section className="xp-sheet" data-accent="feather">
          {panelBar}
          {stepHint}
          <h2>
            Feather <em>{featherLabel}</em>
          </h2>
          <div className="xp-feathers">
            {FEATHERS.map((f) => (
              <button
                key={f.id}
                className={`xp-feather ${feather === f.id ? 'active' : ''}`}
                onClick={() => chooseFeather(f.id)}
                disabled={renderer === 'living' && !!f.procedural}
                title={renderer === 'living' && f.procedural ? 'the living feather needs a photograph' : f.label}
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
          {panelBar}
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

          <h3 className="xp-subhead">
            Feather looks <em>saved in the studio</em>
          </h3>
          {studioPresets.length === 0 && <div className="xp-note">no looks saved yet — shape a feather in /feather2 and save a preset there</div>}
          <div className="xp-presets">
            {studioPresets.map((p) => (
              <button key={p.id} className={`xp-preset ${studioPreset?.id === p.id ? 'active' : ''}`} onClick={() => pickStudioPreset(p)} title={p.scene.view ? 'look, masks, movement and camera' : 'look, masks and movement'}>
                <b>{p.name}</b>
                <span>{p.label}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {sheet === 'control' && (
        <section className="xp-sheet" data-accent="control">
          {panelBar}
          {stepHint}
          <h2>
            Control <em>scan to join · or press the key</em>
          </h2>
          <div className="xp-installation">
            <div className="xp-groupchips" role="radiogroup" aria-label="Installation input">
              <button role="radio" aria-checked={inputMode === 'sim'} className={`xp-chip ${inputMode === 'sim' ? 'active' : ''}`} onClick={() => setInputMode('sim')}>Phones + keys</button>
              <button role="radio" aria-checked={inputMode === 'mqtt'} className={`xp-chip ${inputMode === 'mqtt' ? 'active' : ''}`} onClick={() => { setBrokerUrl(mqttUrl); setInputMode('mqtt'); }}>Hardware + phones</button>
              <span role="status">Input {inputStatus}</span>
            </div>
            <label>Broker address <input aria-label="Broker address" value={mqttUrl} onChange={(e) => setMqttUrl(e.target.value)} placeholder="wss://your-broker" /></label>
            <button className="xp-chip" onClick={() => setBrokerUrl(mqttUrl)}>Apply address</button>
            <button className="xp-chip" aria-expanded={showLights} aria-controls="xp-lights" onClick={() => setShowLights((v) => !v)}>{showLights ? 'Hide lights ×' : 'Lights'}</button>
            {showLights && <div id="xp-lights"><LedPanel /></div>}
          </div>
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
            <div className="xp-note">Phones may — {PERMS_LABEL[perms].hint}.</div>
            <div className="xp-groupchips" role="radiogroup" aria-label="What phones may change">
              {PHONE_PERMS.map((p) => (
                <button key={p} role="radio" aria-checked={perms === p} className={`xp-chip ${perms === p ? 'active' : ''}`} onClick={() => setPerms(p)}>
                  {PERMS_LABEL[p].name}
                </button>
              ))}
            </div>
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
          {panelBar}
          {stepHint}
          <h2>
            Mix <em>sample playback levels</em>
          </h2>

          <AudioOutputPanel audio={audio} />
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

          <div className="xp-pulse">
            <button className={`xp-mute ${pulse ? 'on' : ''}`} title={pulse ? 'switch the generative pulse off' : 'switch the generative pulse on'} onClick={() => setPulse((v) => !v)}>
              {pulse ? '●' : '·'}
            </button>
            <span className="xp-fader-name">
              Generative pulse
              <i>{pulse ? 'bell · pluck · drum on gestures' : 'off — loops only'}</i>
            </span>
          </div>

          <div className="xp-mixrow">
            <span className="xp-mute-spacer" />
            <span className="xp-fader-name">
              Tempo
              <i>loops follow it</i>
            </span>
            <input className="xp-fader" type="range" min={40} max={220} step={1} value={bpm} onChange={(e) => chooseBpm(Number(e.target.value))} />
            <span className="xp-fader-val">{bpm}</span>
          </div>

          <div className="xp-scenes" role="radiogroup" aria-label="Scene">
            {SCENE_KEYS.map((k) => (
              <button key={k} role="radio" aria-checked={scene === k} className={`xp-chip ${scene === k ? 'active' : ''}`} title="LED tint, and the scale the generative pulse plays" onClick={() => engine.setScene(k)}>
                {SCENES[k].label}
              </button>
            ))}
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

      {sheet === 'play' && (() => {
        const ch = play.channels[playChannel];
        const part = PLAY_PARTS.find((p) => p.id === ch.part) ?? PLAY_PARTS[0];
        return (
          <section className="xp-sheet" data-accent="play" data-test-tick={testTick}>
            {panelBar}
            {stepHint}
            <h2>
              Play <em>a trigger moves one part</em>
            </h2>
            <div className="xp-play-channels">
              {play.channels.map((c, i) => (
                <PlayChannelChip
                  key={i}
                  label={SENSOR_CHANNELS[i]?.label ?? `Channel ${i + 1}`}
                  partKey={SENSOR_CHANNELS[i]?.key ?? ''}
                  effect={PLAY_EFFECTS.find((e) => e.mode === c.mode)?.name ?? 'Still'}
                  part={PLAY_PARTS.find((p) => p.id === c.part)?.label ?? c.part}
                  on={i === playChannel}
                  index={i}
                  levels={play}
                  onPick={() => setPlayChannel(i)}
                  testing={testHold.current[i]}
                  onTest={() => toggleTest(i)}
                />
              ))}
            </div>
            <div className="xp-play-heading">
              <h3>{SENSOR_CHANNELS[playChannel]?.label ?? `Channel ${playChannel + 1}`} → {part.label}</h3>
              <p>{part.hint}. Send from a phone joined to this channel, or press {(SENSOR_CHANNELS[playChannel]?.key ?? '').toUpperCase()}.</p>
            </div>
            <div className="xp-play-label">Part of the feather</div>
            <div className="xp-play-pills" aria-label="Feather part">
              {PLAY_PARTS.map((p) => (
                <button key={p.id} aria-pressed={ch.part === p.id} onClick={() => updateChannel(playChannel, { part: p.id })}>
                  {p.label}
                </button>
              ))}
            </div>
            <div className="xp-play-label">Movement</div>
            <div className="xp-play-pills" aria-label="Movement">
              {PLAY_EFFECTS.map((e) => (
                <button key={e.name} aria-pressed={ch.mode === e.mode} onClick={() => updateChannel(playChannel, { mode: e.mode, speed: e.speed })}>
                  {e.name}
                </button>
              ))}
            </div>
            <label className="xp-play-slider">
              <span>Strength<output>{Math.round((ch.strength / 2) * 100)}%</output></span>
              <input type="range" min={0} max={2} step={0.01} value={ch.strength} onChange={(e) => updateChannel(playChannel, { strength: Number(e.target.value) })} />
            </label>
            <label className="xp-play-slider">
              <span>Speed<output>{Math.round((ch.speed / 3) * 100)}%</output></span>
              <input type="range" min={0} max={3} step={0.01} value={ch.speed} onChange={(e) => updateChannel(playChannel, { speed: Number(e.target.value) })} />
            </label>
            <div className="xp-note">
              Hold to play: a held finger keeps the movement on, letting go releases it at this sensor’s attack / release from the console, the same envelope the classic particles use.
            </div>
            <div className="xp-play-label">Renderer</div>
            <div className="xp-play-renderer">
              <button aria-pressed={renderer === 'living'} onClick={() => setRenderer('living')}>Living feather</button>
              <button aria-pressed={renderer === 'classic'} onClick={() => setRenderer('classic')}>Classic particles</button>
            </div>
            <button className="xp-play-match" onClick={matchClassic} title="swirl → Swirl · rise / scatter → Fly · wave → Wave · flutter / fall → Breathe · pulse → Pulse; reach → strength">
              Match the classic movements
            </button>
            <div className="xp-note">
              {renderer === 'living'
                ? 'The feather, its masks and its resting movement come from the studio (/feather2). Still hands a part back to the studio’s own life.'
                : 'Classic particles ignore these movements; switch to the living feather to play them.'}
            </div>
          </section>
        );
      })()}

      {/* dock */}
      <nav ref={dockRef} className="xp-dock" aria-label="Experience controls">
        <button className={sheet === 'feather' ? 'on' : ''} data-accent="feather" onClick={() => toggle('feather')}>
          <span className="xp-dock-step" aria-hidden="true">1</span>Feather
        </button>
        <button className={sheet === 'control' ? 'on' : ''} data-accent="control" onClick={() => toggle('control')}>
          <span className="xp-dock-step" aria-hidden="true">2</span>Control
          {joined > 0 && <i className="xp-dock-badge">{joined}</i>}
        </button>
        <button className={sheet === 'play' ? 'on' : ''} data-accent="play" onClick={() => toggle('play')}>
          <span className="xp-dock-step" aria-hidden="true">3</span>Play
        </button>
        <button className={sheet === 'mix' ? 'on' : ''} data-accent="mix" onClick={() => toggle('mix')}>
          <span className="xp-dock-step" aria-hidden="true">4</span>Mix
        </button>
        <button className={sheet === 'presets' ? 'on' : ''} data-accent="presets" onClick={() => toggle('presets')}>
          Presets
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
          <span>{peers > 1 ? `${peers} phones` : 'live'}</span>
        </div>
      ) : qr ? (
        <img className="xp-dev-qr" src={qr} alt={`join ${label}`} />
      ) : (
        <div className="xp-dev-wait">{status === 'error' ? 'error' : '…'}</div>
      )}
      {info && !connected && <div className="xp-dev-code">{info.code}</div>}
      {info && <a className="xp-chip" href={url.replace('/controller?', '/cam?')} target="_blank" rel="noreferrer">Camera</a>}
      {(status === 'error' || status === 'connecting') && <div role="status" className="xp-note">{status === 'error' ? 'Connection interrupted — retrying' : 'Connecting…'}</div>}
    </div>
  );
}

// One trigger channel in the Play sheet: what it drives, and a live level bar
// read from the shared play levels at ~12 Hz (no per-frame React churn).
function PlayChannelChip({ label, partKey, effect, part, on, index, levels, onPick, testing, onTest }: {
  label: string;
  partKey: string;
  effect: string;
  part: string;
  on: boolean;
  index: number;
  levels: FeatherPlay;
  onPick: () => void;
  testing: boolean;
  onTest: () => void;
}) {
  const bar = useRef<HTMLElement>(null);
  useEffect(() => {
    const id = setInterval(() => {
      if (bar.current) bar.current.style.transform = `scaleX(${Math.max(0, Math.min(1, levels.levels[index] ?? 0))})`;
    }, 80);
    return () => clearInterval(id);
  }, [levels, index]);
  return (
    <div className={`xp-play-channel ${on ? 'on' : ''} ${testing ? 'testing' : ''}`}>
      <button className="xp-play-pick" aria-pressed={on} onClick={onPick}>
        <b>{label}</b>
        <small>{effect === 'Still' ? 'still' : `${effect} · ${part}`}</small>
        {partKey && <kbd>{partKey.toUpperCase()}</kbd>}
      </button>
      <button className="xp-play-test" role="switch" aria-checked={testing} title={testing ? 'release the simulated finger' : 'hold a simulated finger on this channel'} onClick={onTest}>
        <span /> test
      </button>
      <i ref={bar} />
    </div>
  );
}
