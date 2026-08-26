// ============================================================================
//  /controller — phone-facing remote. Pairs to a running console (over WebRTC,
//  see net/link.ts) and drives it: a motion pad (or the phone's accelerometer)
//  feeds the "Net" source, plus scene, tempo and master-volume controls.
//
//  Reaches the console either by scanning the console's QR (Device ID + Code
//  arrive as ?d= & ?c= and it connects automatically) or by typing the Device
//  ID + Code shown on the console by hand.
//
//  One phone can drive SEVERAL channels at once: the ＋ button lists the
//  console's free channels (the console announces them over the data channel)
//  and each added channel gets its own strip in the multi-channel view. The
//  big pad / camera / accelerometer drive ALL connected channels together;
//  a strip drives only its own.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import './ui.css';
import { SCENES, SCENE_KEYS } from '../engine/scenes.ts';
import { CameraSource } from './camera.ts';
import { connectHost, type ChannelAd, type ClientHandle, type Control, type LinkStatus } from '../net/link.ts';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** One console room this phone is driving. */
interface Chan {
  key: number;
  d: string;
  c: string;
  label: string;
  status: LinkStatus;
}

export default function Controller() {
  const params = new URLSearchParams(location.search);
  const [deviceId, setDeviceId] = useState((params.get('d') ?? '').toUpperCase());
  const [code, setCode] = useState((params.get('c') ?? '').toUpperCase());
  const [log, setLog] = useState<string[]>([]);
  const sentRef = useRef(0);
  const addLog = useCallback((msg: string) => setLog((l) => [...l.slice(-120), msg]), []);

  // ---- channels: this phone can drive several console rooms at once --------
  const [chans, setChans] = useState<Chan[]>([]);
  const chansRef = useRef<Chan[]>([]);
  chansRef.current = chans;
  const handlesRef = useRef(new Map<number, ClientHandle>());
  const chanUid = useRef(0);
  /** the console's channel directory, announced over the data channel */
  const [available, setAvailable] = useState<ChannelAd[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [addD, setAddD] = useState('');
  const [addC, setAddC] = useState('');

  const addChannel = useCallback(
    (d: string, c: string, label?: string) => {
      const D = d.trim().toUpperCase();
      const C = c.trim().toUpperCase();
      if (!D || !C) return;
      if (chansRef.current.some((x) => x.d === D && x.c === C)) {
        addLog(`already on ${D}-${C}`);
        return;
      }
      const key = ++chanUid.current;
      addLog(`connect ${D}-${C}`);
      const h = connectHost(D, C, {
        onStatus: (st) => {
          setChans((cs) => cs.map((x) => (x.key === key ? { ...x, status: st } : x)));
          addLog(`[${D}] status: ${st}`);
        },
        onMsg: (m) => setAvailable(m.list),
        onLog: (msg) => addLog(`[${D}] ${msg}`),
      });
      handlesRef.current.set(key, h);
      setChans((cs) => [...cs, { key, d: D, c: C, label: label ?? D, status: 'connecting' }]);
    },
    [addLog],
  );

  const removeChannel = useCallback((key: number) => {
    handlesRef.current.get(key)?.destroy();
    handlesRef.current.delete(key);
    setChans((cs) => cs.filter((x) => x.key !== key));
  }, []);

  const connect = useCallback(
    (d: string, c: string) => {
      // fresh primary: drop everything and start over
      handlesRef.current.forEach((h) => h.destroy());
      handlesRef.current.clear();
      setChans([]);
      setAvailable([]);
      addChannel(d, c);
    },
    [addChannel],
  );

  // The console knows every channel's proper name — adopt it once announced.
  useEffect(() => {
    if (!available.length) return;
    setChans((cs) =>
      cs.map((x) => {
        const ad = available.find((a) => a.d === x.d && a.c === x.c);
        return ad && ad.label !== x.label ? { ...x, label: ad.label } : x;
      }),
    );
  }, [available]);

  /** every connected channel — the big pad / camera / accelerometer */
  const send = useCallback((c: Control) => {
    for (const h of handlesRef.current.values()) h.send(c);
    if (c.t === 'motion') sentRef.current++;
  }, []);
  /** one channel — its strip in the multi-channel view */
  const sendTo = useCallback((key: number, c: Control) => {
    handlesRef.current.get(key)?.send(c);
    if (c.t === 'motion') sentRef.current++;
  }, []);
  /** the first connected channel only — for global verbs that act on the
   *  whole page anyway (the FX pad at 30 fps through 3 channels would just
   *  triple the traffic) */
  const sendPrimary = useCallback((c: Control) => {
    const first = chansRef.current[0];
    if (first) handlesRef.current.get(first.key)?.send(c);
  }, []);

  // Periodically report how many motion frames have been sent — so the log shows
  // whether data is actually leaving the phone.
  useEffect(() => {
    const t = setInterval(() => {
      if (sentRef.current > 0) {
        addLog(`sent ${sentRef.current} motion frames`);
        sentRef.current = 0;
      }
    }, 2000);
    return () => clearInterval(t);
  }, [addLog]);

  // Auto-connect when the QR prefilled both fields.
  useEffect(() => {
    if (deviceId && code) connect(deviceId, code);
    const handles = handlesRef.current;
    return () => {
      handles.forEach((h) => h.destroy());
      handles.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const status: LinkStatus = chans[0]?.status ?? 'idle';
  const connected = status === 'peer';
  const liveCount = chans.filter((x) => x.status === 'peer').length;
  const freeAds = available.filter((a) => a.peers === 0 && !chans.some((x) => x.d === a.d && x.c === a.c));

  // --- Motion pad: HOLD to play, swipe for extra energy. ----------------------
  //     A held finger sustains a steady level (the loops keep playing — no
  //     movement required, so parking on the matrix center holds the music
  //     dry); swiping pushes above it. The SAME surface is the FX matrix:
  //     finger POSITION picks the effect (TL delay · TR reverb · BL high-pass
  //     · BR low-pass, center = dry, distance = amount) — one hand plays both
  //     layers at once. A steady ticker sends while held, because a still
  //     finger produces no pointer events at all.
  const HOLD_LEVEL = 0.7;
  const padState = useRef({ active: false, x: 0, y: 0, t: 0, speed: 0, fx: { x: 0, y: 0 } });
  const padTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [padLevel, setPadLevel] = useState(0);
  const [fxPos, setFxPos] = useState<{ x: number; y: number } | null>(null);

  const emitMotion = (v: number) => {
    setPadLevel(v);
    send({ t: 'motion', v });
  };

  const fxFrom = (e: React.PointerEvent): { x: number; y: number } => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(-1, Math.min(1, ((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1)),
      y: Math.max(-1, Math.min(1, 1 - ((e.clientY - r.top) / Math.max(1, r.height)) * 2)),
    };
  };

  const padTick = () => {
    const s = padState.current;
    if (!s.active) return;
    // swipe energy leaks away (~0.25 s), the hold floor stays
    s.speed *= Math.exp(-0.066 / 0.25);
    emitMotion(clamp01(Math.max(HOLD_LEVEL, s.speed)));
    setFxPos({ ...s.fx });
    sendPrimary({ t: 'fx', x: s.fx.x, y: s.fx.y, on: true });
  };

  const onPadDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const now = performance.now();
    padState.current = { active: true, x: e.clientX, y: e.clientY, t: now, speed: 0, fx: fxFrom(e) };
    if (padTimer.current) clearInterval(padTimer.current);
    padTimer.current = setInterval(padTick, 66);
    padTick();
  };
  const onPadMove = (e: React.PointerEvent) => {
    const s = padState.current;
    if (!s.active) return;
    const now = performance.now();
    const dt = Math.max(1, now - s.t);
    const inst = (Math.hypot(e.clientX - s.x, e.clientY - s.y) / dt) * 0.9; // px/ms → 0..1-ish
    s.speed = Math.max(s.speed, clamp01(inst)); // instant attack, the ticker releases
    s.x = e.clientX;
    s.y = e.clientY;
    s.t = now;
    s.fx = fxFrom(e);
  };
  const onPadUp = () => {
    padState.current.active = false;
    if (padTimer.current) clearInterval(padTimer.current);
    padTimer.current = null;
    emitMotion(0);
    setFxPos(null);
    sendPrimary({ t: 'fx', x: 0, y: 0, on: false });
  };

  // never leave a stuck note if the page unmounts mid-hold
  useEffect(
    () => () => {
      if (padTimer.current) clearInterval(padTimer.current);
    },
    [],
  );

  const [tilt, setTilt] = useState(false); // accelerometer on
  const [tiltThreshold, setTiltThreshold] = useState(1); // m/s^2 of shake ignored as noise
  const tiltThresholdRef = useRef(tiltThreshold);
  tiltThresholdRef.current = tiltThreshold;

  // --- Camera (optional): on-device motion detection → motion. Runs the SAME
  //     detector as the console's camera theremin, on the phone, and streams
  //     only the motion number over the link (the video never leaves the phone).
  const [camOn, setCamOn] = useState(false);
  const [camErr, setCamErr] = useState<string | null>(null);
  const camRef = useRef<CameraSource | null>(null);
  const camCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const camRaf = useRef(0);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(camRaf.current);
    camRef.current?.stop();
    camRef.current = null;
    setCamOn(false);
    emitMotion(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startCamera = () => {
    setTilt(false); // camera and accelerometer both drive motion — pick one
    setCamErr(null);
    addLog('camera starting…');
    const cam = new CameraSource();
    camRef.current = cam;
    cam
      .start()
      .then(() => {
        addLog('camera on');
        setCamOn(true);
        if (camCanvasRef.current) {
          camCanvasRef.current.width = cam.size.w;
          camCanvasRef.current.height = cam.size.h;
          cam.attachPreview(camCanvasRef.current);
        }
        let frame = 0;
        const loop = () => {
          camRaf.current = requestAnimationFrame(loop);
          const r = cam.read();
          if ((frame & 1) === 0) send({ t: 'motion', v: r.motion }); // ~30fps to console
          if ((frame & 7) === 0) setPadLevel(r.motion); // cheaper visual update
          frame++;
        };
        camRaf.current = requestAnimationFrame(loop);
      })
      .catch((e) => {
        addLog(`camera error: ${(e as Error)?.message ?? e}`);
        setCamErr('Camera unavailable — allow camera access, or the page needs https.');
        camRef.current = null;
      });
  };

  // Release the camera on unmount.
  useEffect(() => () => {
    cancelAnimationFrame(camRaf.current);
    camRef.current?.stop();
  }, []);

  // --- Accelerometer (optional): shake magnitude → motion. --------------------
  const enableTilt = async () => {
    stopCamera(); // camera and accelerometer both drive motion — pick one
    type DM = typeof DeviceMotionEvent & { requestPermission?: () => Promise<string> };
    const DME = DeviceMotionEvent as unknown as DM;
    try {
      if (typeof DME?.requestPermission === 'function') {
        const res = await DME.requestPermission();
        if (res !== 'granted') return;
      }
    } catch {
      return;
    }
    setTilt(true);
  };
  useEffect(() => {
    if (!tilt) return;
    let last = 0;
    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a) return;
      const mag = Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0);
      // gate gravity, then a user-adjustable deadzone before scaling to 0..1
      const thr = tiltThresholdRef.current;
      const v = clamp01((Math.abs(mag - 9.8) - thr) / Math.max(1, 15 - thr));
      const now = performance.now();
      if (now - last < 40) return;
      last = now;
      emitMotion(v);
    };
    window.addEventListener('devicemotion', onMotion);
    return () => window.removeEventListener('devicemotion', onMotion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tilt]);

  const [bpm, setBpm] = useState(120);
  const [master, setMaster] = useState(0.7);
  const [scene, setScene] = useState('');

  const copyLog = () => {
    const text = `Wing Beat controller log\nUA: ${navigator.userAgent}\nurl: ${location.href}\n\n${log.join('\n')}`;
    navigator.clipboard?.writeText(text).catch(() => {});
  };

  // Debug log — shown in both states so a failed connection can still be copied.
  const logPanel = (
    <details className="wb-log-box" style={{ maxWidth: 420, margin: '16px auto 0' }}>
      <summary>Debug log ({log.length})</summary>
      <button className="wb-btn accent" style={{ margin: '6px 0' }} onClick={copyLog}>
        Copy log to clipboard
      </button>
      <div className="wb-log">{log.length ? log.map((l, i) => <div key={i}>{l}</div>) : <div style={{ opacity: 0.5 }}>no events yet</div>}</div>
    </details>
  );

  // --- Not paired yet: manual entry screen. -----------------------------------
  if (!connected) {
    return (
      <div className="wb-cam-sender">
        <div className="wb-cam-title">
          Wing Beat <small>controller</small>
        </div>
        <div className="wb-settings-note" style={{ maxWidth: 420, margin: '0 auto 12px' }}>
          Enter the <b>Device ID</b> and <b>Code</b> shown on the console — or scan its QR.
        </div>
        <div className="wb-ctl-form">
          <label className="wb-label">Device ID</label>
          <input className="wb-input wb-ctl-input" value={deviceId} maxLength={8} autoCapitalize="characters" placeholder="ABCD" onChange={(e) => setDeviceId(e.target.value.toUpperCase())} />
          <label className="wb-label">Code</label>
          <input className="wb-input wb-ctl-input" value={code} maxLength={8} autoCapitalize="characters" placeholder="WXYZ" onChange={(e) => setCode(e.target.value.toUpperCase())} />
          <button className="wb-btn accent" style={{ marginTop: 10 }} onClick={() => connect(deviceId, code)}>
            Connect
          </button>
        </div>
        <div className="wb-cam-status" style={{ marginTop: 16 }}>
          <span className={`wb-dot ${status === 'error' ? 'error' : status === 'connecting' ? 'connecting' : ''}`} />
          {status === 'connecting' ? 'connecting…' : status === 'error' ? "couldn't reach that console — check the codes" : status === 'ready' ? 'link dropped — reconnecting' : 'not connected'}
        </div>
        {logPanel}
      </div>
    );
  }

  // --- Paired: the controller surface. ----------------------------------------
  return (
    <div className="wb-ctl">
      <div className="wb-ctl-head">
        <span className="wb-cam-title" style={{ margin: 0 }}>
          Wing Beat <small>controller</small>
        </span>
        <span className="wb-cam-status" style={{ margin: 0 }}>
          <span className="wb-dot connected" /> {chans.length > 1 ? `${liveCount}/${chans.length} channels` : 'connected'}
        </span>
        <button className="wb-btn wb-ctl-add" title="control another channel" onClick={() => setShowAdd((v) => !v)}>
          ＋
        </button>
      </div>

      {showAdd && (
        <div className="wb-ctl-section wb-ctl-addbox">
          <div className="wb-label">Add a channel</div>
          {freeAds.length > 0 ? (
            <div className="wb-ctl-freechans">
              {freeAds.map((a) => (
                <button
                  key={`${a.d}-${a.c}`}
                  className="wb-btn"
                  onClick={() => {
                    addChannel(a.d, a.c, a.label);
                    setShowAdd(false);
                  }}
                >
                  ＋ {a.label}
                  {a.kind === 'group' ? ' · group' : ''}
                </button>
              ))}
            </div>
          ) : (
            <div className="wb-settings-note" style={{ margin: 0 }}>
              no free channels announced yet — every channel is taken, or enter codes by hand:
            </div>
          )}
          <div className="wb-ctl-row">
            <input className="wb-input" placeholder="DEVICE" value={addD} maxLength={8} autoCapitalize="characters" onChange={(e) => setAddD(e.target.value.toUpperCase())} />
            <input className="wb-input" placeholder="CODE" value={addC} maxLength={8} autoCapitalize="characters" onChange={(e) => setAddC(e.target.value.toUpperCase())} />
            <button
              className="wb-btn accent"
              onClick={() => {
                addChannel(addD, addC);
                setAddD('');
                setAddC('');
                setShowAdd(false);
              }}
            >
              Add
            </button>
          </div>
        </div>
      )}

      {chans.length > 1 && (
        <div className="wb-ctl-section">
          <div className="wb-ctl-slider-head">
            <span className="wb-label">Channels — hold a strip to blow on it</span>
            <span className="wb-motion-val">{chans.length}</span>
          </div>
          <div className="wb-ctl-strips">
            {chans.map((ch) => (
              <ChannelStrip
                key={ch.key}
                label={ch.label}
                status={ch.status}
                onLevel={(v) => sendTo(ch.key, { t: 'motion', v })}
                onRemove={() => removeChannel(ch.key)}
              />
            ))}
          </div>
        </div>
      )}

      <div
        className="wb-ctl-pad"
        style={{ ['--lvl' as string]: padLevel }}
        onPointerDown={camOn ? undefined : onPadDown}
        onPointerMove={camOn ? undefined : onPadMove}
        onPointerUp={camOn ? undefined : onPadUp}
        onPointerCancel={camOn ? undefined : onPadUp}
      >
        <canvas ref={camCanvasRef} className="wb-ctl-cam" style={{ display: camOn ? 'block' : 'none' }} />
        {!camOn && (
          <>
            <span className="wb-ctl-fx-corner tl">delay</span>
            <span className="wb-ctl-fx-corner tr">reverb</span>
            <span className="wb-ctl-fx-corner bl">high-pass</span>
            <span className="wb-ctl-fx-corner br">low-pass</span>
            <span className="wb-ctl-fx-cross" />
            {fxPos && (
              <span
                className="wb-ctl-fx-dot"
                style={{ left: `${((fxPos.x + 1) / 2) * 100}%`, top: `${((1 - fxPos.y) / 2) * 100}%` }}
              />
            )}
          </>
        )}
        <span className="wb-ctl-pad-label">
          {camOn
            ? 'camera — wave in front of the phone'
            : tilt
              ? 'shake the phone'
              : chans.length > 1
                ? 'hold to play (all channels) · corners = fx · swipe = extra'
                : 'hold to play · corners = fx · swipe = extra'}
        </span>
        <div className="wb-level" style={{ maxWidth: 260 }}>
          <div className="wb-level-fill" style={{ width: `${Math.round(padLevel * 100)}%`, background: 'linear-gradient(90deg,#7c3aed,#c4a8ff)' }} />
        </div>
      </div>

      {camErr && (
        <div className="wb-settings-note" style={{ color: '#e0556b', borderColor: '#3a2024', background: '#160f12' }}>
          {camErr}
        </div>
      )}

      <div className="wb-ctl-row">
        <button className={`wb-btn ${tilt ? 'active' : ''}`} onClick={enableTilt} disabled={tilt}>
          {tilt ? '✓ motion sensor' : 'Motion sensor'}
        </button>
        <button className={`wb-btn ${camOn ? 'active' : ''}`} onClick={camOn ? stopCamera : startCamera}>
          {camOn ? '✓ camera on' : 'Use camera'}
        </button>
      </div>

      {tilt && (
        <div className="wb-ctl-section">
          <div className="wb-ctl-slider-head">
            <span className="wb-label">Shake threshold</span>
            <span className="wb-motion-val">{tiltThreshold.toFixed(1)}</span>
          </div>
          <input
            className="wb-ctl-slider"
            type="range"
            min={0}
            max={8}
            step={0.5}
            value={tiltThreshold}
            onChange={(e) => setTiltThreshold(Number(e.target.value))}
          />
        </div>
      )}

      <div className="wb-ctl-section">
        <div className="wb-label">Scene</div>
        <div className="wb-ctl-scenes">
          {SCENE_KEYS.map((k) => (
            <button
              key={k}
              className={`wb-btn ${scene === k ? 'active' : ''}`}
              onClick={() => {
                setScene(k);
                send({ t: 'scene', key: k });
              }}
            >
              {SCENES[k].label}
            </button>
          ))}
        </div>
      </div>

      <div className="wb-ctl-section">
        <div className="wb-ctl-slider-head">
          <span className="wb-label">Tempo</span>
          <span className="wb-motion-val">{bpm} bpm</span>
        </div>
        <input
          className="wb-ctl-slider"
          type="range"
          min={40}
          max={200}
          value={bpm}
          onChange={(e) => {
            const v = Number(e.target.value);
            setBpm(v);
            send({ t: 'bpm', v });
          }}
        />
      </div>

      <div className="wb-ctl-section">
        <div className="wb-ctl-slider-head">
          <span className="wb-label">Master volume</span>
          <span className="wb-motion-val">{Math.round(master * 100)}%</span>
        </div>
        <input
          className="wb-ctl-slider"
          type="range"
          min={0}
          max={100}
          value={Math.round(master * 100)}
          onChange={(e) => {
            const v = Number(e.target.value) / 100;
            setMaster(v);
            send({ t: 'master', v });
          }}
        />
      </div>

      {logPanel}
    </div>
  );
}

// A vertical touch fader for one channel: finger height = wind level, release
// = 0. Each strip has its own pointer capture, so several fingers can play
// several channels at once.
function ChannelStrip({
  label,
  status,
  onLevel,
  onRemove,
}: {
  label: string;
  status: LinkStatus;
  onLevel: (v: number) => void;
  onRemove?: () => void;
}) {
  const [lvl, setLvl] = useState(0);
  const last = useRef(0);
  const set = (v: number) => {
    setLvl(v);
    onLevel(v);
  };
  const fromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return clamp01(1 - (e.clientY - r.top) / Math.max(1, r.height));
  };
  return (
    <div
      className={`wb-ctl-strip ${status === 'peer' ? 'live' : ''}`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        set(fromEvent(e));
      }}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture?.(e.pointerId)) return;
        const now = performance.now();
        if (now - last.current < 33) return; // ~30 fps to the console
        last.current = now;
        set(fromEvent(e));
      }}
      onPointerUp={() => set(0)}
      onPointerCancel={() => set(0)}
    >
      <div className="wb-ctl-strip-fill" style={{ height: `${Math.round(lvl * 100)}%` }} />
      <span className="wb-ctl-strip-label">{label}</span>
      <span className={`wb-dot ${status === 'peer' ? 'connected' : status === 'error' ? 'error' : 'connecting'}`} />
      {onRemove && (
        <button className="wb-ctl-strip-x" title="remove channel" onPointerDown={(e) => e.stopPropagation()} onClick={onRemove}>
          ✕
        </button>
      )}
    </div>
  );
}
