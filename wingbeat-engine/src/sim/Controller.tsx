// ============================================================================
//  /controller — phone-facing remote. Pairs to a running console (over WebRTC,
//  see net/link.ts) and drives it: a motion pad (or the phone's accelerometer)
//  feeds the "Net" source, plus scene, tempo and master-volume controls.
//
//  Reaches the console either by scanning the console's QR (Device ID + Code
//  arrive as ?d= & ?c= and it connects automatically) or by typing the Device
//  ID + Code shown on the console by hand.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import './ui.css';
import { SCENES, SCENE_KEYS } from '../engine/scenes.ts';
import { CameraSource } from './camera.ts';
import { connectHost, type ClientHandle, type Control, type LinkStatus } from '../net/link.ts';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export default function Controller() {
  const params = new URLSearchParams(location.search);
  const [deviceId, setDeviceId] = useState((params.get('d') ?? '').toUpperCase());
  const [code, setCode] = useState((params.get('c') ?? '').toUpperCase());
  const [status, setStatus] = useState<LinkStatus>('idle');
  const [log, setLog] = useState<string[]>([]);
  const sentRef = useRef(0);
  const addLog = useCallback((msg: string) => setLog((l) => [...l.slice(-120), msg]), []);

  const linkRef = useRef<ClientHandle | null>(null);
  const send = useCallback(
    (c: Control) => {
      linkRef.current?.send(c);
      if (c.t === 'motion') sentRef.current++;
    },
    [],
  );

  const connect = useCallback(
    (d: string, c: string) => {
      if (!d || !c) return;
      linkRef.current?.destroy();
      setStatus('connecting');
      addLog(`connect ${d}-${c}`);
      linkRef.current = connectHost(d, c, { onStatus: (s) => { setStatus(s); addLog(`status: ${s}`); }, onLog: addLog });
    },
    [addLog],
  );

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
    return () => linkRef.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connected = status === 'peer';

  // --- Motion pad: drag speed → 0..1 motion, sent ~30fps, 0 on release. -------
  const padState = useRef({ active: false, x: 0, y: 0, t: 0, last: 0 });
  const [padLevel, setPadLevel] = useState(0);

  const emitMotion = (v: number) => {
    setPadLevel(v);
    send({ t: 'motion', v });
  };

  const onPadDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const now = performance.now();
    padState.current = { active: true, x: e.clientX, y: e.clientY, t: now, last: now };
    emitMotion(0.15);
  };
  const onPadMove = (e: React.PointerEvent) => {
    const s = padState.current;
    if (!s.active) return;
    const now = performance.now();
    const dt = Math.max(1, now - s.t);
    const dist = Math.hypot(e.clientX - s.x, e.clientY - s.y);
    const speed = dist / dt; // px per ms
    s.x = e.clientX;
    s.y = e.clientY;
    s.t = now;
    if (now - s.last < 33) return; // throttle ~30fps
    s.last = now;
    emitMotion(clamp01(speed * 0.9));
  };
  const onPadUp = () => {
    padState.current.active = false;
    emitMotion(0);
  };

  const [tilt, setTilt] = useState(false); // accelerometer on

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
      const v = clamp01((Math.abs(mag - 9.8) - 1) / 14); // gate gravity, scale
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
          <span className="wb-dot connected" /> connected
        </span>
      </div>

      <div
        className="wb-ctl-pad"
        style={{ ['--lvl' as string]: padLevel }}
        onPointerDown={camOn ? undefined : onPadDown}
        onPointerMove={camOn ? undefined : onPadMove}
        onPointerUp={camOn ? undefined : onPadUp}
        onPointerCancel={camOn ? undefined : onPadUp}
      >
        <canvas ref={camCanvasRef} className="wb-ctl-cam" style={{ display: camOn ? 'block' : 'none' }} />
        <span className="wb-ctl-pad-label">{camOn ? 'camera — wave in front of the phone' : tilt ? 'shake the phone' : 'swipe / wave here'}</span>
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
