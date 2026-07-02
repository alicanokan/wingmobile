// ============================================================================
//  Wing Beat — Simulation app (operator console).
//
//  Wires the engine, the audio, and a transport together, and shows the two
//  linked views: the operator MAP (left) and the projected FEATHER (right).
//  The transport switch is the bridge — "Simulation" runs everything in the
//  browser; "Hardware" points the same brain at the MQTT broker so the real
//  ESP8266 feathers drive it.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './ui.css';
import { WingbeatEngine } from '../engine/WingbeatEngine.ts';
import { AudioEngine } from '../engine/AudioEngine.ts';
import { SCENES } from '../engine/scenes.ts';
import { SimTransport } from '../transports/SimTransport.ts';
import { MqttTransport } from '../transports/MqttTransport.ts';
import type { Transport, TransportStatus } from '../transports/Transport.ts';
import { useEngineSnapshot } from './useEngine.ts';
import { OperatorMap } from './OperatorMap.tsx';
import { Projection } from './Projection.tsx';
import { FEATHERS, DEFAULT_FEATHER } from './feathers.ts';
import { rig, snapshotPreset, onLayersChange } from './rig.ts';
import { saveLast } from './presets.ts';
import { createBroadcaster, presenceWatch } from './sync.ts';
import { ScenePanel } from './ScenePanel.tsx';
import { sceneForFeather, setFeatherScene } from './featherScenes.ts';
import { DevicesPanel, DeviceHud } from './DevicesPanel.tsx';
import { Landing, type EntryMode } from './Landing.tsx';
import { MobileMenu } from './MobileMenu.tsx';
import { startHost, type HostHandle, type LinkStatus } from '../net/link.ts';
import { SettingsPanel } from './SettingsPanel.tsx';
import { RigPanel } from './RigPanel.tsx';
import { MicSource } from './mic.ts';
import { CameraSource } from './camera.ts';
import { CameraPanel } from './CameraPanel.tsx';
import { MicPanel } from './MicPanel.tsx';
import { KeyboardPanel } from './KeyboardPanel.tsx';
import { Knob } from './Knob.tsx';
import { InputMatrix } from './InputMatrix.tsx';
import {
  loadRouting,
  saveRouting,
  SLOTS,
  PARTS,
  DEVICE_COUNT,
  isDeviceKey,
  deviceIndex,
  type SourceKind,
} from './inputs.ts';
import { DEVICE_TIER } from './rig.ts';

type Mode = 'sim' | 'mqtt';

export default function App() {
  // Engine + audio are created once and outlive transport swaps.
  const engine = useMemo(() => new WingbeatEngine(), []);
  const audio = useMemo(() => new AudioEngine(), []);

  const [mode, setMode] = useState<Mode>('sim');
  const [mqttUrl, setMqttUrl] = useState('ws://localhost:9001');
  const [transport, setTransport] = useState<Transport | null>(null);
  const [status, setStatus] = useState<TransportStatus>('idle');

  const [audioReady, setAudioReady] = useState(false);
  const [autoDemo, setAutoDemo] = useState(false);
  const [masterGain, setMasterGain] = useState(0.7);
  const [windSens, setWindSens] = useState(1.0);
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [fullscreenProjection, setFullscreenProjection] = useState(false);
  const [lowPowerMode, setLowPowerMode] = useState(DEVICE_TIER === 'ultra-low' || DEVICE_TIER === 'low');
  const [feather, setFeatherState] = useState(DEFAULT_FEATHER);
  const [showCollection, setShowCollection] = useState(true);
  const [mobileShowCollection, setMobileShowCollection] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showRig, setShowRig] = useState(false);
  const [showMatrix, setShowMatrix] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [showScene, setShowScene] = useState(false);
  // Room map is heavy and cramped on phones — start hidden there so the feather
  // fills the screen. `navOpen` drives the mobile rail drawer.
  const [showRoomMap, setShowRoomMap] = useState(() => typeof window === 'undefined' || window.innerWidth > 820);
  const [navOpen, setNavOpen] = useState(false);
  const [showPair, setShowPair] = useState(false);
  // Landing entry mode (null = show the landing screen, every visit).
  const [entryMode, setEntryMode] = useState<EntryMode | null>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [mobileFirstTime, setMobileFirstTime] = useState(() => !localStorage.getItem('wb.mobile.setup'));
  const [swipeCount, setSwipeCount] = useState(0);
  const swipeRef = useRef({ lastX: 0, lastY: 0, direction: null as 'left' | 'right' | null, count: 0, timestamp: 0 });

  // Up to DEVICE_COUNT independent phone controllers, each its own room (Device
  // ID + Code) and its own routable source dev1..dev5. Live motion per device is
  // kept in a ref (read once/frame by the router); status/codes/peers/log drive
  // the Controllers panel.
  const linksRef = useRef<HostHandle[]>([]);
  const deviceMotion = useRef<number[]>(Array(DEVICE_COUNT).fill(0));
  const deviceStale = useRef<Array<ReturnType<typeof setTimeout> | undefined>>(Array(DEVICE_COUNT).fill(undefined));
  const [deviceInfo, setDeviceInfo] = useState<Array<{ deviceId: string; code: string } | null>>(Array(DEVICE_COUNT).fill(null));
  const [deviceStatus, setDeviceStatus] = useState<LinkStatus[]>(Array(DEVICE_COUNT).fill('idle'));
  const [devicePeers, setDevicePeers] = useState<number[]>(Array(DEVICE_COUNT).fill(0));
  const [linkLog, setLinkLog] = useState<string[]>([]);
  const anyDeviceConnected = devicePeers.some((n) => n > 0);
  const deviceActive = useMemo(() => {
    const m: Partial<Record<SourceKind, boolean>> = {};
    devicePeers.forEach((n, i) => (m[`dev${i + 1}` as SourceKind] = n > 0));
    return m;
  }, [devicePeers]);

  // On phones, opening a panel (which becomes a full-screen overlay) should tuck
  // the rail drawer away so the panel is visible.
  const anyPanelOpen = showMatrix || showKeys || showPair || showScene || micOn || camOn || showRig || showSettings;
  useEffect(() => {
    if (anyPanelOpen && typeof window !== 'undefined' && window.innerWidth <= 820) setNavOpen(false);
  }, [anyPanelOpen]);
  // True while a /feather display window is open → pause the console's own
  // projection so the GPU only renders one particle cloud.
  const [featherOpen, setFeatherOpen] = useState(false);

  // Input routing — source→slot, slot→part(s), slot→key, persisted (see inputs.ts).
  const [{ sources, parts, keys, keyAmount, keyRelease }, setRouting] = useState(() => loadRouting());
  const setKeyAmount = (v: number) =>
    setRouting((r) => {
      const next = { ...r, keyAmount: v };
      saveRouting(next);
      return next;
    });
  const setKeyRelease = (v: number) =>
    setRouting((r) => {
      const next = { ...r, keyRelease: v };
      saveRouting(next);
      return next;
    });
  const setSource = (slot: string, source: SourceKind) =>
    setRouting((r) => {
      const next = { ...r, sources: { ...r.sources, [slot]: source } };
      saveRouting(next);
      return next;
    });
  const togglePart = (slot: string, part: string) =>
    setRouting((r) => {
      const cur = r.parts[slot] ?? [];
      const linked = cur.includes(part) ? cur.filter((p) => p !== part) : [...cur, part];
      const next = { ...r, parts: { ...r.parts, [slot]: linked } };
      saveRouting(next);
      return next;
    });
  const setKey = (slot: string, letter: string) =>
    setRouting((r) => {
      const k = letter.toLowerCase();
      const nextKeys = { ...r.keys };
      // a letter can only drive one slot — clear it from whoever else had it
      for (const id of Object.keys(nextKeys)) if (nextKeys[id] === k) delete nextKeys[id];
      nextKeys[slot] = k;
      const next = { ...r, keys: nextKeys };
      saveRouting(next);
      return next;
    });
  // Hard-stop the camera: close the panel AND unpatch any sensor routed to it,
  // so the webcam actually releases (it stays on as long as anything needs it).
  const disableCamera = () =>
    setRouting((r) => {
      const sources = { ...r.sources };
      let changed = false;
      for (const id of Object.keys(sources))
        if (sources[id] === 'camera') {
          sources[id] = 'off';
          changed = true;
        }
      setCamOn(false);
      if (!changed) return r;
      const next = { ...r, sources };
      saveRouting(next);
      return next;
    });

  // Helper to update one slot of a per-device state array.
  const setAt = <T,>(setter: React.Dispatch<React.SetStateAction<T[]>>, i: number, value: T) =>
    setter((arr) => {
      const next = arr.slice();
      next[i] = value;
      return next;
    });

  // Start DEVICE_COUNT independent controller hosts on mount — one room each, so
  // every phone/tab/window pairs with a UNIQUE Device ID + Code and lands on its
  // own source dev1..dev5. Motion feeds that device's value (read once/frame by
  // the router); scene/tempo/master are global engine controls any device drives.
  // Each session takes a FRESH room (a reused id collides with a still-open tab →
  // 'unavailable-id'); onIdentity reports the room actually claimed.
  const startHosts = useCallback(() => {
    if (linksRef.current.length) return;
    const feedDevice = (i: number, v: number) => {
      deviceMotion.current[i] = Math.max(0, Math.min(1, v));
      const t = deviceStale.current;
      if (t[i]) clearTimeout(t[i]);
      t[i] = setTimeout(() => {
        deviceMotion.current[i] = 0;
      }, 1500);
    };
    linksRef.current = Array.from({ length: DEVICE_COUNT }, (_, i) => {
      const tag = `D${i + 1}`;
      return startHost({
        onStatus: (s) => setAt(setDeviceStatus, i, s),
        onIdentity: (deviceId, code) => setAt<{ deviceId: string; code: string } | null>(setDeviceInfo, i, { deviceId, code }),
        onPeers: (n) => setAt(setDevicePeers, i, n),
        onLog: (msg) => setLinkLog((l) => [...l.slice(-160), `${tag}: ${msg}`]),
        onControl: (c) => {
          switch (c.t) {
            case 'motion':
            case 'blow':
              feedDevice(i, c.v);
              break;
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
      });
    });
    // Seed the panel with each room's initial codes (onIdentity refines them).
    setDeviceInfo(linksRef.current.map((h) => ({ deviceId: h.deviceId, code: h.code })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, audio]);

  // Start all hosts on mount so the console is always pairable.
  useEffect(() => {
    startHosts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the current rig/look persisted so nothing resets on reload — routing
  // already auto-saves; this does the same for the rig. It only preserves what
  // you have (recalled per-feather on load); it never changes your parameters.
  // Deliberate changes still come only from saving/recalling a named preset.
  useEffect(() => {
    const save = () => {
      try {
        if (rig.feather) saveLast(rig.feather);
      } catch {
        /* storage unavailable */
      }
    };
    const id = setInterval(save, 4000);
    const onHide = () => {
      if (document.visibilityState === 'hidden') save();
    };
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      clearInterval(id);
      save();
      window.removeEventListener('pagehide', save);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, []);

  useEffect(
    () => () => {
      deviceStale.current.forEach((t) => t && clearTimeout(t));
      linksRef.current.forEach((h) => h.destroy());
      linksRef.current = []; // allow a remount (dev StrictMode) to re-create them
    },
    [],
  );

  // Live source meters for the matrix UI.
  const [levels, setLevels] = useState<Partial<Record<SourceKind, number>>>({});
  // Momentary keyboard levels per slot (set by the keydown/up handler).
  const keyLevels = useRef<Record<string, number>>({});
  // Enveloped key pulse per slot + live pulse params (read in the router loop).
  const keyEnv = useRef<Record<string, number>>({});
  const keyAmountRef = useRef(keyAmount);
  const keyReleaseRef = useRef(keyRelease);
  keyAmountRef.current = keyAmount;
  keyReleaseRef.current = keyRelease;
  // Live letter → slot reverse map, read by the keyboard handler (avoids
  // re-binding the listener — and resetting the F toggle — on every remap).
  const keyToSlotRef = useRef<Record<string, string>>({});
  keyToSlotRef.current = Object.fromEntries(Object.entries(keys).map(([slot, letter]) => [letter, slot]));

  const chooseFeather = (id: string) => {
    setFeatherState(id);
    engine.setFeather(id); // share through the engine so the whole brain knows
  };

  const nextFeather = () => {
    const currentIndex = FEATHERS.findIndex((f) => f.id === feather);
    const nextIndex = (currentIndex + 1) % FEATHERS.length;
    chooseFeather(FEATHERS[nextIndex].id);
  };

  const prevFeather = () => {
    const currentIndex = FEATHERS.findIndex((f) => f.id === feather);
    const prevIndex = (currentIndex - 1 + FEATHERS.length) % FEATHERS.length;
    chooseFeather(FEATHERS[prevIndex].id);
  };

  const snapshot = useEngineSnapshot(engine);

  // Shared input devices — one each, read by the central router (and tuned by
  // their panels). They start when routed to a sensor or opened for tuning.
  const mic = useMemo(() => new MicSource(), []);
  const cam = useMemo(() => new CameraSource(), []);

  const needMic = micOn || Object.values(sources).includes('mic');
  const needCam = camOn || Object.values(sources).includes('camera');

  // Expose the engine + audio for console scripting / debugging.
  useEffect(() => {
    (window as unknown as { wb: WingbeatEngine; wbAudio: AudioEngine }).wb = engine;
    (window as unknown as { wbAudio: AudioEngine }).wbAudio = audio;
  }, [engine, audio]);

  // Attach audio to the engine bus once.
  useEffect(() => {
    const detach = audio.attach(engine);
    const off = engine.on('audioReady', () => setAudioReady(true));
    return () => {
      detach();
      off();
    };
  }, [engine, audio]);

  // Per-layer sounds: when a sensor triggers, play the sounds of the layers it
  // routes to (a loaded sample or a generated pattern), on top of the base voice.
  useEffect(() => {
    const onTrig = (e: { id: string; note: string; velocity: number; pan: number }) => {
      const s = rig.sensors[e.id];
      if (!s) return;
      for (const li of s.layers) {
        const snd = rig.layerSounds[li];
        if (snd && snd.mode !== 'synth') audio.playLayer(li, snd.mode, snd.seed ?? 0, e.note, e.velocity, e.pan);
      }
    };
    const offs = [engine.on('melody', onTrig), engine.on('perc', onTrig), engine.on('accent', onTrig)];
    return () => offs.forEach((o) => o());
  }, [engine, audio]);

  // Per-sensor LOOPS: every loaded loop runs continuously (phase-aligned, so they
  // stay in sync); triggering a sensor FADES ITS LOOP UP (volume tracks the sensor
  // level) and going idle fades it back down — a live multichannel loop mixer.
  useEffect(() => {
    const onNode = (e: { id: string; state: { wind: number; present: boolean } }) => {
      if (!e.id.startsWith('sensor_') || !audio.hasLoop(e.id)) return;
      const lvl = Math.max(e.state.wind, e.state.present ? 0.9 : 0);
      audio.setLoopGain(e.id, lvl > 0.12 ? Math.min(1.2, 0.25 + lvl) : 0);
    };
    return engine.on('node', onNode);
  }, [engine, audio]);

  // (Re)create the transport whenever the mode (or URL) changes.
  useEffect(() => {
    const t: Transport =
      mode === 'sim' ? new SimTransport({ autoDemo }) : new MqttTransport({ url: mqttUrl });
    setTransport(t);
    const offStatus = t.onStatus(setStatus);
    t.connect(engine);
    return () => {
      offStatus();
      t.disconnect();
    };
    // autoDemo intentionally excluded — toggled live below, not via reconnect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, mode, mqttUrl]);

  // Live control wiring
  useEffect(() => {
    engine.setWindSensitivity(windSens);
  }, [engine, windSens]);
  useEffect(() => {
    audio.setMasterGain(masterGain);
  }, [audio, masterGain]);
  useEffect(() => {
    if (transport?.kind === 'sim') (transport as SimTransport).setAutoDemo(autoDemo);
  }, [transport, autoDemo]);

  // Start / stop the shared devices when they're needed (routed or opened).
  useEffect(() => {
    if (needMic && !mic.active) {
      mic.start().catch(() => {
        alert('Microphone access is required to route the mic.');
        setMicOn(false);
      });
    } else if (!needMic && mic.active) {
      mic.stop();
    }
  }, [needMic, mic]);

  useEffect(() => {
    if (needCam && !cam.active) {
      cam.start().catch(() => {
        alert('Camera access is required to route the camera.');
        setCamOn(false);
      });
    } else if (!needCam && cam.active) {
      cam.stop();
    }
  }, [needCam, cam]);

  // Central input router (sim only): once per frame, resolve every active
  // source → slot → part(s) and drive the engine. Parts no source touches are
  // left to the operator map. Devices are read exactly once per frame here.
  useEffect(() => {
    if (transport?.kind !== 'sim') return;
    const sim = transport as SimTransport;
    let raf = 0;
    let meterTick = 0;
    let lastT = 0;
    let keyPeak = 0; // live max key pulse, for the keyboard meter
    const driven = new Set<string>(); // parts we currently hold, to release on unpatch

    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const micLvl = mic.active ? mic.level() : 0;
      const camReading = cam.active ? cam.read() : null;
      const camLvl = camReading?.motion ?? 0;
      const dt = lastT ? Math.min(0.1, (t - lastT) / 1000) : 1 / 60;
      lastT = t;

      // Stage 1: each slot's current value from its source.
      // Stage 2: fan out to the parts it's linked to (max-combine on overlap).
      const partVal: Record<string, number> = {};
      keyPeak = 0;
      for (const slot of SLOTS) {
        const src = sources[slot.id];
        let v = 0;
        if (src === 'mic') v = mic.active ? micLvl : 0;
        else if (src === 'camera') v = cam.active ? camLvl : 0;
        else if (isDeviceKey(src)) v = deviceMotion.current[deviceIndex(src)] ?? 0;
        else if (src === 'key') {
          // pulse envelope: instant attack to AMOUNT, exp release over RELEASE.
          const target = (keyLevels.current[slot.id] ?? 0) * keyAmountRef.current;
          const prev = keyEnv.current[slot.id] ?? 0;
          let env: number;
          if (target >= prev) env = target;
          else {
            const tau = Math.max(0.02, keyReleaseRef.current);
            env = target + (prev - target) * Math.exp(-dt / tau);
          }
          keyEnv.current[slot.id] = env;
          if (env > keyPeak) keyPeak = env;
          v = env;
        }
        // 'esp' is handled by the hardware transport; 'off' is silent.
        if (v <= 0.001) continue;
        for (const pid of parts[slot.id] ?? []) {
          partVal[pid] = Math.max(partVal[pid] ?? 0, v);
        }
      }

      for (const p of PARTS) {
        const v = partVal[p.id] ?? 0;
        if (v > 0.001) {
          sim.holdWind(p.id, v);
          sim.setPresence(p.id, v > 0.05);
          driven.add(p.id);
        } else if (driven.has(p.id)) {
          sim.releaseWind(p.id);
          sim.setPresence(p.id, false);
          driven.delete(p.id);
        }
      }

      // Update the meters ~8×/s without re-rendering every frame.
      if ((meterTick++ & 7) === 0) {
        const lv: Partial<Record<SourceKind, number>> = { mic: micLvl, camera: cam.active ? cam.lastMotion : 0, key: keyPeak };
        for (let i = 0; i < DEVICE_COUNT; i++) lv[`dev${i + 1}` as SourceKind] = deviceMotion.current[i];
        setLevels(lv);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      driven.forEach((id) => {
        sim.releaseWind(id);
        sim.setPresence(id, false);
      });
    };
  }, [transport, sources, parts, mic, cam]);

  // Broadcast live state to any /feather display window (see sync.ts). Cheap to
  // run even with no window open (postMessage to nobody is a no-op).
  useEffect(() => {
    const b = createBroadcaster();
    let lastRig = '';
    let tick = 0;
    const id = setInterval(() => {
      const nodes = engine.getNodes().map((n) => ({ i: n.id, w: n.wind, p: n.present }));
      b.send({ kind: 'state', state: { nodes, scene: engine.scene, feather, palette: engine.featherPalette } });
      // rig only when it actually changes (ignore the updatedAt timestamp)
      if (tick++ % 6 === 0) {
        const snap = snapshotPreset();
        const key = JSON.stringify({ ...snap, updatedAt: 0 });
        if (key !== lastRig) {
          lastRig = key;
          b.send({ kind: 'rig', preset: snap });
        }
      }
    }, 40);
    return () => {
      clearInterval(id);
      b.close();
    };
  }, [engine, feather]);

  // Watch for a /feather display window so we can pause the console preview.
  useEffect(() => presenceWatch(setFeatherOpen), []);

  // Each feather carries its own scene — load it when the feather changes.
  useEffect(() => {
    engine.setScene(sceneForFeather(feather));
  }, [engine, feather]);

  // Gesture detection: swipe left/right to change feathers in fullscreen.
  useEffect(() => {
    if (!fullscreenProjection) return;

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      const s = swipeRef.current;

      // Detect significant horizontal movement (swipe)
      const deltaX = touch.clientX - s.lastX;
      const now = Date.now();

      if (Math.abs(deltaX) > 80) {
        // Significant swipe detected
        const newDirection = deltaX > 0 ? 'right' : 'left';

        // Reset if direction changed or too much time passed
        if (s.direction !== newDirection || now - s.timestamp > 800) {
          s.direction = newDirection;
          s.count = 1;
          s.timestamp = now;
          setSwipeCount(1);
        } else if (s.count === 1) {
          s.count = 2;
          setSwipeCount(2);
          // Two swipes in same direction - change feather
          if (newDirection === 'right') {
            prevFeather();
          } else {
            nextFeather();
          }
          s.count = 0; // Reset after action
          setTimeout(() => setSwipeCount(0), 400);
        }

        s.lastX = touch.clientX;
        s.lastY = touch.clientY;
      }
    };

    const handleTouchEnd = () => {
      // Reset direction on touch end
      swipeRef.current.direction = null;
    };

    window.addEventListener('touchmove', handleTouchMove);
    window.addEventListener('touchend', handleTouchEnd);

    return () => {
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [fullscreenProjection]);

  // Auto-route camera to first 4 sensors when a device connects on mobile.
  const prevDeviceConnectedRef = useRef(false);
  useEffect(() => {
    if (entryMode !== 'mobile') return;
    if (!prevDeviceConnectedRef.current && anyDeviceConnected) {
      // First device just connected — route camera to first 4 slots
      setRouting((r) => {
        const sources = { ...r.sources };
        for (let i = 0; i < 4; i++) {
          sources[`slot_${i + 1}`] = 'camera';
        }
        const next = { ...r, sources };
        saveRouting(next);
        setCamOn(true);
        return next;
      });
    }
    prevDeviceConnectedRef.current = anyDeviceConnected;
  }, [anyDeviceConnected, entryMode]);

  // Auto-route devices to sensors in fullscreen based on device count.
  useEffect(() => {
    if (entryMode !== 'fullscreen') return;
    if (!fullscreenProjection) return;

    const connectedCount = devicePeers.reduce((sum, p) => sum + (p > 0 ? 1 : 0), 0);

    setRouting((r) => {
      const sources = { ...r.sources };

      if (connectedCount === 0) {
        for (let i = 0; i < 4; i++) sources[`slot_${i + 1}`] = 'camera';
        sources['slot_5'] = 'off';
      } else if (connectedCount === 1) {
        for (let i = 0; i < 4; i++) sources[`slot_${i + 1}`] = 'camera';
        sources['slot_5'] = 'dev1';
      } else if (connectedCount === 2) {
        sources['slot_1'] = 'dev2';
        sources['slot_2'] = 'camera';
        sources['slot_3'] = 'camera';
        sources['slot_4'] = 'camera';
        sources['slot_5'] = 'dev1';
      } else if (connectedCount === 3) {
        sources['slot_1'] = 'dev2';
        sources['slot_2'] = 'dev3';
        sources['slot_3'] = 'camera';
        sources['slot_4'] = 'camera';
        sources['slot_5'] = 'dev1';
      } else if (connectedCount === 4) {
        sources['slot_1'] = 'dev2';
        sources['slot_2'] = 'dev3';
        sources['slot_3'] = 'dev4';
        sources['slot_4'] = 'camera';
        sources['slot_5'] = 'dev1';
      } else if (connectedCount >= 5) {
        sources['slot_1'] = 'dev5';
        sources['slot_2'] = 'dev3';
        sources['slot_3'] = 'dev4';
        sources['slot_4'] = 'off';
        sources['slot_5'] = 'dev1';
      }

      const next = { ...r, sources };
      saveRouting(next);
      if (connectedCount >= 0 && !camOn) setCamOn(true);
      return next;
    });
  }, [devicePeers, fullscreenProjection, entryMode]);

  // The rig (re)loads per feather inside the Projection; when it does (layer
  // rebuild), push that feather's authored tempo to the loop transport.
  useEffect(() => onLayersChange(() => audio.setBpm(rig.global.bpm)), [audio]);

  // Keyboard (sim): hold Q W E R T to blow on sensors 1–5, F (or Space) to take
  // the feather in hand.
  useEffect(() => {
    if (transport?.kind !== 'sim') return;
    const sim = transport as SimTransport;
    let featherOn = false; // 'f' is a toggle so hands are free to trigger sensors
    // Only block shortcuts while typing in a real text field — NOT when a button
    // happens to be focused (clicking the routing matrix leaves a button focused,
    // which must not swallow the Q–T trigger keys). preventDefault on Space/F
    // below keeps a focused button from being re-activated.
    const onControl = (t: EventTarget | null) => {
      const tag = (t as HTMLElement | null)?.tagName;
      return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
    };
    const down = (ev: KeyboardEvent) => {
      if (ev.repeat || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      // don't trigger sensors (or let Space/Enter re-activate a focused button)
      // while the user is working a panel control
      if (onControl(ev.target)) return;
      const k = ev.key.toLowerCase();
      if (k === 'f') {
        // TOGGLE the feather in hand → grows the 3D contour in (and stays)
        ev.preventDefault();
        featherOn = !featherOn;
        sim.holdWind('feather_01', featherOn ? 1 : 0);
        sim.setPresence('feather_01', featherOn);
        if (!featherOn) sim.releaseWind('feather_01');
        return;
      }
      if (k === ' ' || k === 'spacebar') {
        // momentary: hold to show the contour while pressed
        ev.preventDefault();
        sim.holdWind('feather_01', 1);
        sim.setPresence('feather_01', true);
        return;
      }
      // Keys feed their SLOT's level; the router fans it out to the linked
      // part(s) (only when that slot's source is "Key").
      const slot = keyToSlotRef.current[k];
      if (!slot) return;
      keyLevels.current[slot] = 1;
      // Latch the attack on the event itself so an instant tap still fires a
      // pulse (the once-per-frame router would otherwise miss a down+up that
      // both land between two frames); release then decays it.
      keyEnv.current[slot] = Math.max(keyEnv.current[slot] ?? 0, keyAmountRef.current);
    };
    const up = (ev: KeyboardEvent) => {
      if (onControl(ev.target)) return;
      const k = ev.key.toLowerCase();
      if (k === 'f') return; // toggle: ignore key release
      if (k === ' ' || k === 'spacebar') {
        if (!featherOn) {
          sim.releaseWind('feather_01');
          sim.setPresence('feather_01', false);
        }
        return;
      }
      const slot = keyToSlotRef.current[k];
      if (!slot) return;
      keyLevels.current[slot] = 0;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [transport]);

  const startAudio = async () => {
    if (audioReady) {
      setAudioReady(false);
      return;
    }
    await audio.init(masterGain);
    await audio.resume();
    setAudioReady(true);
  };

  const sim = transport?.kind === 'sim' ? (transport as SimTransport) : null;
  const featherLabel = FEATHERS.find((f) => f.id === feather)?.label ?? feather;

  // ---- Landing (shown every visit) --------------------------------------
  if (entryMode === null) {
    return <Landing onPick={setEntryMode} />;
  }

  // ---- Fullscreen: immersive feather only -------------------------------
  if (entryMode === 'fullscreen') {
    return (
      <div className="wb-fs">
        <button className="wb-btn wb-fs-exit" onClick={() => setEntryMode(null)}>
          ☰ menu
        </button>
        <Projection engine={engine} audio={audio} featherId={feather} paused={false} />
      </div>
    );
  }

  // ---- Mobile experience: compact feather + live meters + quick menu ----
  if (entryMode === 'mobile') {
    return (
      <div className="wb-mobileexp">
        <Projection engine={engine} audio={audio} featherId={feather} paused={false} />

        {!mobileMenu && !showPair && !camOn && <DeviceHud peers={devicePeers} levels={levels} onOpen={() => setShowPair(true)} />}

        <div className="wb-mx-top">
          <button className={`wb-mx-icon ${audioReady ? 'on' : ''}`} onClick={startAudio} title={audioReady ? 'stop audio' : 'start audio'}>
            {audioReady ? '♪' : '🔊'}
          </button>
          <button className="wb-mx-icon" onClick={() => setEntryMode(null)} title="back to menu">
            ☰
          </button>
          <button className={`wb-mx-icon ${camOn ? 'on' : ''}`} onClick={() => setCamOn((v) => !v)} title="toggle camera">
            📷
          </button>
          <button className={`wb-mx-icon ${mobileMenu ? 'on' : ''}`} onClick={() => setMobileMenu((v) => !v)} title="quick controls">
            ⋯
          </button>
        </div>

        {mobileFirstTime && (
          <div className="wb-modal-overlay">
            <div className="wb-modal-content">
              <div className="wb-modal-head">Welcome to Wing Beat Mobile</div>
              <div className="wb-modal-text">What would you like to enable?</div>
              <div className="wb-modal-buttons">
                <button className="wb-btn" onClick={() => { setCamOn(true); localStorage.setItem('wb.mobile.setup', '1'); setMobileFirstTime(false); }}>📷 Camera</button>
                <button className="wb-btn" onClick={() => { setMicOn(true); localStorage.setItem('wb.mobile.setup', '1'); setMobileFirstTime(false); }}>🎤 Microphone</button>
                <button className="wb-btn" onClick={() => { localStorage.setItem('wb.mobile.setup', '1'); setMobileFirstTime(false); }}>Skip</button>
              </div>
            </div>
          </div>
        )}

        {mobileMenu && <MobileMenu camOn={camOn} onCam={() => setCamOn((v) => !v)} sources={sources} onSource={setSource} onClose={() => setMobileMenu(false)} deviceTier={DEVICE_TIER} lowPowerMode={lowPowerMode} onLowPowerMode={setLowPowerMode} showCollection={mobileShowCollection} onShowCollection={setMobileShowCollection} />}

        {camOn && !showPair && !showScene && !showRig && !showSettings && (
          <div className="wb-camera-frame">
            <canvas
              key="camera-preview"
              style={{
                width: '100%',
                height: '100%',
                borderRadius: 4,
                border: '1px solid #3aa0f5',
                background: '#000',
                display: 'block',
                imageRendering: 'pixelated',
              }}
              ref={(el) => {
                if (el) cam.attachPreview(el);
              }}
            />
          </div>
        )}

        <div className="wb-panels">
          {showPair && (
            <DevicesPanel devices={deviceInfo} statuses={deviceStatus} peers={devicePeers} levels={levels} log={linkLog} onClose={() => setShowPair(false)} />
          )}
          {camOn && <CameraPanel cam={cam} onClose={() => setCamOn(false)} onDisable={disableCamera} compact={entryMode === 'mobile'} />}
        </div>

        {!mobileMenu && !showPair && !camOn && mobileShowCollection && (
          <div className="wb-collection wb-collection-exp">
            {FEATHERS.slice(0, 12).map((f) => (
              <button key={f.id} className={`wb-feather ${feather === f.id ? 'active' : ''}`} onClick={() => chooseFeather(f.id)} title={f.label}>
                {f.procedural ? <span className="wb-feather-proc">✦</span> : <img src={f.src.replace('/feathers/', '/feathers/thumbs/')} alt={f.label} loading="lazy" decoding="async" />}
              </button>
            ))}
            {FEATHERS.length > 12 && <span className="wb-collection-more">+{FEATHERS.length - 12}</span>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`wb-shell ${navOpen ? 'nav-open' : ''}`}>
      {/* MOBILE top bar — hamburger opens the rail as a drawer (hidden on desktop) */}
      <div className="wb-mobile-bar">
        <button className="wb-mobile-burger" onClick={() => setNavOpen((v) => !v)} aria-label="menu">
          {navOpen ? '✕' : '☰'}
        </button>
        <span className="wb-mobile-title">Wing Beat</span>
      </div>
      {navOpen && <div className="wb-nav-backdrop" onClick={() => setNavOpen(false)} />}

      {/* MOBILE always-on device meters over the feather (hidden on desktop) */}
      <DeviceHud peers={devicePeers} levels={levels} onOpen={() => setShowPair(true)} />

      {/* LEFT RAIL — packed engine controls, always visible */}
      <aside className="wb-rail wb-rail-left">
        <div className="wb-title">
          Wing Beat
          <small>engine console</small>
        </div>

        <div className="wb-rail-sec">Source</div>
        <div className="wb-rail-group">
          <button className={`wb-btn ${mode === 'sim' ? 'active' : ''}`} onClick={() => setMode('sim')}>
            Simulation
          </button>
          <button className={`wb-btn ${mode === 'mqtt' ? 'active' : ''}`} onClick={() => setMode('mqtt')}>
            Hardware
          </button>
          {mode === 'mqtt' && (
            <input
              className="wb-input"
              value={mqttUrl}
              onChange={(e) => setMqttUrl(e.target.value)}
              spellCheck={false}
              title="Mosquitto WebSocket listener"
            />
          )}
          <span className="wb-status">
            <span className={`wb-dot ${status}`} />
            {status}
          </span>
        </div>

        <div className="wb-rail-sec">Audio</div>
        <div className="wb-rail-group">
          <button className={`wb-btn accent ${audioReady ? 'active' : ''}`} onClick={startAudio} title={audioReady ? 'click to stop audio' : 'click to start audio'}>
            {audioReady ? '♪ Stop audio' : 'Start audio'}
          </button>
          <div className="wb-knob-row">
            <Knob
              label="Vol"
              value={masterGain}
              min={0}
              max={1}
              step={0.01}
              reset={0.7}
              onChange={setMasterGain}
              format={(v) => v.toFixed(2)}
            />
          </div>
          <button
            className={`wb-btn ${showSettings ? 'active' : ''}`}
            onClick={() => setShowSettings((v) => !v)}
            title="Settings & mixer"
          >
            ⚙ mixer
          </button>
        </div>

        {mode === 'sim' && (
          <>
            <div className="wb-rail-sec">Inputs</div>
            <div className="wb-rail-group">
              <button className={`wb-btn ${showMatrix ? 'active' : ''}`} onClick={() => setShowMatrix((v) => !v)}>
                ▦ Routing
              </button>
              <button className={`wb-btn ${showKeys ? 'active' : ''}`} onClick={() => setShowKeys((v) => !v)}>
                ⌨ Keys
              </button>
              <button className={`wb-btn wb-btn-ctrl ${showPair ? 'active' : ''}`} onClick={() => setShowPair((v) => !v)}>
                <span className={`wb-dot ${anyDeviceConnected ? 'connected' : ''}`} style={{ marginRight: 6 }} />⧉ Controllers
                {devicePeers.reduce((a, b) => a + b, 0) > 0 && ` · ${devicePeers.reduce((a, b) => a + b, 0)}`}
              </button>
              <button className={`wb-btn ${autoDemo ? 'active' : ''}`} onClick={() => setAutoDemo((v) => !v)}>
                Auto-demo
              </button>
              <button className={`wb-btn ${micOn ? 'active' : ''}`} onClick={() => setMicOn((v) => !v)}>
                {micOn ? 'Mic on' : 'Use mic'}
              </button>
              <button className={`wb-btn ${camOn ? 'active' : ''}`} onClick={() => setCamOn((v) => !v)}>
                {camOn ? 'Camera on' : 'Use camera'}
              </button>
              <div className="wb-knob-row">
                <Knob
                  label="Wind×"
                  value={windSens}
                  min={0.2}
                  max={4}
                  step={0.1}
                  reset={1}
                  onChange={setWindSens}
                  format={(v) => `${v.toFixed(1)}×`}
                />
              </div>
            </div>
          </>
        )}

        <div className="wb-rail-sec">Scene</div>
        <div className="wb-rail-group">
          {Object.values(SCENES).map((s) => (
            <button
              key={s.key}
              className={`wb-chip ${snapshot.scene === s.key ? 'active' : ''}`}
              onClick={() => {
                setFeatherScene(feather, s.key); // scene sticks to this feather
                engine.setScene(s.key);
              }}
              title={s.origin}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="wb-rail-sec">Projection</div>
        <div className="wb-rail-group">
          <button
            className={`wb-btn ${showCollection ? 'active' : ''}`}
            onClick={() => setShowCollection((v) => !v)}
          >
            ❖ Collection
          </button>
          <button className={`wb-btn ${showRoomMap ? 'active' : ''}`} onClick={() => setShowRoomMap((v) => !v)}>
            ⊞ Room map
          </button>
          <button className={`wb-btn ${showScene ? 'active' : ''}`} onClick={() => setShowScene((v) => !v)}>
            ✱ Scene
          </button>
          <button className={`wb-btn ${showRig ? 'active' : ''}`} onClick={() => setShowRig((v) => !v)}>
            ✦ Rig
          </button>
          <button className="wb-btn" onClick={() => setFullscreenProjection(true)}>
            ⛶ Fullscreen
          </button>
          <button
            className="wb-btn"
            onClick={() => window.open('/feather', 'wingbeat-feather', 'width=1280,height=800')}
            title="Open the feather on a second screen (display only)"
          >
            ↗ Feather window
          </button>
          <div className="wb-rail-feather">{featherLabel}</div>
        </div>
      </aside>

      {/* DOCKED PANELS — render between the left rail and the views so any
          combination (matrix + camera + rig + mixer) sits side by side. On
          mobile the wrapper becomes a full-screen overlay (see .wb-panels). */}
      <div className="wb-panels">
      {showMatrix && (
        <InputMatrix
          sources={sources}
          parts={parts}
          keys={keys}
          onSource={setSource}
          onTogglePart={togglePart}
          onKey={setKey}
          levels={levels}
          active={{ mic: mic.active, camera: cam.active, ...deviceActive }}
          hardware={mode === 'mqtt'}
          onClose={() => setShowMatrix(false)}
        />
      )}
      {showKeys && (
        <KeyboardPanel
          amount={keyAmount}
          release={keyRelease}
          level={levels.key ?? 0}
          onAmount={setKeyAmount}
          onRelease={setKeyRelease}
          onClose={() => setShowKeys(false)}
        />
      )}
      {showPair && (
        <DevicesPanel
          devices={deviceInfo}
          statuses={deviceStatus}
          peers={devicePeers}
          levels={levels}
          log={linkLog}
          onClose={() => setShowPair(false)}
        />
      )}
      {showScene && <ScenePanel snapshot={snapshot} engine={engine} audio={audio} onClose={() => setShowScene(false)} />}
      {micOn && <MicPanel mic={mic} onClose={() => setMicOn(false)} />}
      {camOn && <CameraPanel cam={cam} onClose={() => setCamOn(false)} onDisable={disableCamera} />}
      {showRig && <RigPanel snapshot={snapshot} audio={audio} onClose={() => setShowRig(false)} />}
      {showSettings && (
        <SettingsPanel
          audio={audio}
          engine={engine}
          audioReady={audioReady}
          masterGain={masterGain}
          onMaster={setMasterGain}
          onClose={() => setShowSettings(false)}
        />
      )}
      </div>

      {/* CENTER — two linked views */}
      <div className="wb-body">
        {showRoomMap && (
          <div className="wb-pane">
            <div className="wb-pane-label">operator · room map</div>
            <OperatorMap snapshot={snapshot} sim={sim} />
          </div>
        )}
        <div className="wb-pane">
          <div className="wb-pane-label">projection · feather</div>
          <Projection engine={engine} audio={audio} featherId={feather} paused={featherOpen} />
          {featherOpen && (
            <div className="wb-paused-badge">
              ▶ rendering on the /feather window
              <small>editor preview paused to save GPU</small>
            </div>
          )}

          {showCollection && (
            <div className="wb-collection">
              {FEATHERS.map((f) => (
                <button
                  key={f.id}
                  className={`wb-feather ${feather === f.id ? 'active' : ''}`}
                  onClick={() => chooseFeather(f.id)}
                  title={f.label}
                >
                  {f.procedural ? (
                    <span className="wb-feather-proc">✦</span>
                  ) : (
                    <img
                      src={f.src.replace('/feathers/', '/feathers/thumbs/')}
                      alt={f.label}
                      loading="lazy"
                      decoding="async"
                    />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {fullscreenProjection && (
        <div className="wb-fs">
          <div className="wb-fs-controls">
            <button className="wb-btn wb-fs-exit" onClick={() => setFullscreenProjection(false)}>
              ✕ exit
            </button>
            <button className={`wb-btn ${showPair ? 'active' : ''}`} onClick={() => setShowPair((v) => !v)}>
              +⧉ Add Devices
            </button>
          </div>
          {swipeCount > 0 && (
            <div className="wb-swipe-indicator">
              {swipeCount === 1 ? '← swipe again →' : '↻ changing feather...'}
            </div>
          )}
          {showPair && (
            <DevicesPanel devices={deviceInfo} statuses={deviceStatus} peers={devicePeers} levels={levels} log={linkLog} onClose={() => setShowPair(false)} />
          )}
          <Projection engine={engine} audio={audio} featherId={feather} paused={featherOpen} />
        </div>
      )}
    </div>
  );
}
