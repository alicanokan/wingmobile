// ============================================================================
//  /cam — phone-facing sender. Runs the SAME motion detection as the console's
//  camera theremin, locally on the phone, and streams only the result to the
//  console over the LAN relay. The video never leaves the device.
//
//  Note: browsers only grant camera access in a secure context — https or
//  localhost. Over plain http on a LAN IP the camera is blocked, so this page
//  warns and points at the fix.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import './ui.css';
import { CameraSource } from './camera.ts';
import { camRelayUrl } from './camNet.ts';

type Status = 'idle' | 'connecting' | 'live' | 'error';

export default function CamSender() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const camRef = useRef<CameraSource | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const rafRef = useRef(0);

  const [status, setStatus] = useState<Status>('idle');
  const [motion, setMotion] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const secure = typeof window !== 'undefined' && window.isSecureContext;

  const start = () => {
    setErr(null);
    const cam = new CameraSource();
    camRef.current = cam;
    cam
      .start()
      .then(() => {
        if (canvasRef.current) {
          canvasRef.current.width = cam.size.w;
          canvasRef.current.height = cam.size.h;
          cam.attachPreview(canvasRef.current);
        }
        const ws = new WebSocket(camRelayUrl());
        wsRef.current = ws;
        setStatus('connecting');
        ws.onopen = () => setStatus('live');
        ws.onclose = () => setStatus((s) => (s === 'error' ? s : 'idle'));
        ws.onerror = () => setStatus('error');

        let frame = 0;
        const loop = () => {
          rafRef.current = requestAnimationFrame(loop);
          const r = cam.read();
          if (ws.readyState === WebSocket.OPEN && (frame & 1) === 0) {
            ws.send(JSON.stringify({ t: 'cam', motion: r.motion, x: r.x, y: r.y }));
          }
          if ((frame & 7) === 0) setMotion(r.motion);
          frame++;
        };
        rafRef.current = requestAnimationFrame(loop);
      })
      .catch(() => {
        setErr('Camera access denied or unavailable.');
        setStatus('error');
      });
  };

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      camRef.current?.stop();
      wsRef.current?.close();
    },
    [],
  );

  return (
    <div className="wb-cam-sender">
      <div className="wb-cam-title">
        Wing Beat <small>phone camera</small>
      </div>

      {!secure && (
        <div className="wb-settings-note" style={{ color: '#e0b060', borderColor: '#3a2f16', background: '#161206' }}>
          Camera needs a secure page. Open this over <b>https</b> (or localhost). On a LAN IP the browser blocks the webcam.
        </div>
      )}
      {err && (
        <div className="wb-settings-note" style={{ color: '#e0556b', borderColor: '#3a2024', background: '#160f12' }}>
          {err}
        </div>
      )}

      <canvas ref={canvasRef} className="wb-cam-preview" />

      <div className="wb-cam-status">
        <span className={`wb-dot ${status === 'live' ? 'connected' : status === 'error' ? 'error' : status === 'connecting' ? 'connecting' : ''}`} />
        {status === 'live' ? 'sending to console' : status === 'connecting' ? 'connecting…' : status === 'error' ? 'error' : 'not started'}
      </div>

      <div className="wb-level" style={{ maxWidth: 420, margin: '10px auto' }}>
        <div className="wb-level-fill" style={{ width: `${Math.round(motion * 100)}%`, background: 'linear-gradient(90deg,#7c3aed,#c4a8ff)' }} />
        <span className="wb-level-val">{motion.toFixed(2)}</span>
      </div>

      {status === 'idle' || status === 'error' ? (
        <button className="wb-btn accent wb-cam-start" onClick={start}>
          ▶ Start camera
        </button>
      ) : (
        <div className="wb-cam-hint">Wave at the camera · keep this page open</div>
      )}
    </div>
  );
}
