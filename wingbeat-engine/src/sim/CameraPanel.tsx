// ============================================================================
//  Camera theremin panel — tuning + preview for the shared CameraSource.
//
//  The camera is owned by App and read once per frame by the central input
//  router; this panel only mirrors the motion-mask preview and exposes the
//  detection / envelope knobs. WHICH sensor the camera drives is set in the
//  Inputs routing matrix, not here.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import type { CameraSource } from './camera.ts';
import { Knob } from './Knob.tsx';

interface Props {
  cam: CameraSource;
  onClose: () => void;
  onDisable: () => void;
  compact?: boolean;
  /** Split the frame into one strip per camera-routed slot. */
  zones?: boolean;
  onZones?: (on: boolean) => void;
  /** What each strip plays, left → right (shown on its meter). */
  zoneLabels?: string[];
}

export function CameraPanel({ cam, onClose, onDisable, compact, zones, onZones, zoneLabels }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [hud, setHud] = useState(0);
  const [zoneHud, setZoneHud] = useState<number[]>([]);
  // per-strip trigger thresholds (persisted in the camera calibration)
  const [gates, setGates] = useState<number[]>(() => Array.from({ length: 8 }, (_, z) => cam.zoneGate(z)));
  const setGate = (z: number, v: number) => {
    cam.setZoneGate(z, v);
    setGates((g) => g.map((x, i) => (i === z ? cam.zoneGate(z) : x)));
  };
  const [contrast, setContrast] = useState(cam.contrast);
  const [threshold, setThreshold] = useState(cam.threshold);
  const [sensitivity, setSensitivity] = useState(cam.sensitivity);
  const [release, setRelease] = useState(cam.releaseTime);

  // Mirror the knobs into the live camera instance.
  useEffect(() => void (cam.contrast = contrast), [cam, contrast]);
  useEffect(() => void (cam.threshold = threshold), [cam, threshold]);
  useEffect(() => void (cam.sensitivity = sensitivity), [cam, sensitivity]);
  useEffect(() => void (cam.releaseTime = release), [cam, release]);

  // Attach the preview canvas; poll the last reading for the HUD (the router
  // advances the frames, so we only READ here — never call cam.read()).
  useEffect(() => {
    canvasRef.current!.width = cam.size.w;
    canvasRef.current!.height = cam.size.h;
    cam.attachPreview(canvasRef.current);
    const id = setInterval(() => {
      setHud(cam.lastMotion);
      setZoneHud(cam.zoneCount > 1 ? cam.lastZones : []);
    }, 100);
    return () => {
      clearInterval(id);
      cam.attachPreview(null);
    };
  }, [cam]);

  return (
    <div className={`wb-motion ${compact ? 'compact' : ''}`}>
      <div className="wb-settings-head">
        <span>Camera · Motion Theremin</span>
        <button className="wb-btn" style={{ padding: '2px 8px' }} onClick={onClose}>
          ✕
        </button>
      </div>

      {!compact && (
        <div className="wb-settings-note">
          White pixels are detected movement. Patch the camera onto a sensor point in the Inputs matrix; this panel tunes detection and the release tail.
        </div>
      )}

      <button className="wb-btn" style={{ width: '100%', marginBottom: 4 }} onClick={onDisable} title="Stop the webcam and clear camera routing">
        ⏻ Turn off camera
      </button>

      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          borderRadius: 6,
          border: '1px solid #23232e',
          background: '#000',
          display: 'block',
          imageRendering: 'pixelated', // buffer is already mirrored in camera.ts
        }}
      />

      <div className="wb-meter-row" style={{ marginTop: 12 }}>
        <span className="wb-mod-label">motion</span>
        <div className="wb-meter">
          <div className="wb-meter-fill" style={{ width: `${Math.round(hud * 100)}%` }} />
        </div>
        <span className="wb-motion-val">{hud.toFixed(2)}</span>
      </div>

      {onZones && (
        <label className="wb-settings-note" style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', marginTop: 8 }} title="Each camera-routed sensor hears only its own strip of the frame, left to right in sensor order">
          <input type="checkbox" checked={!!zones} onChange={(e) => onZones(e.target.checked)} />
          Split into zones — one strip per camera sensor
        </label>
      )}
      {zoneHud.length > 0 && (
        <div className="wb-settings-note" style={{ marginTop: 6 }}>
          A strip plays while its bar is past the white line. If one triggers by itself, raise its threshold.
        </div>
      )}
      {zoneHud.map((z, i) => {
        const gate = gates[i] ?? 0.3;
        const open = z > gate;
        return (
          <div key={i} style={{ marginTop: 6 }}>
            <div className="wb-meter-row">
              <span className="wb-mod-label" style={{ color: open ? '#e9c46a' : undefined }} title={['left', 'centre', 'right'][i] ?? `strip ${i + 1}`}>
                {zoneLabels?.[i] ?? `zone ${i + 1}`}
              </span>
              <div className="wb-meter" style={{ position: 'relative' }}>
                <div className="wb-meter-fill" style={{ width: `${Math.round(z * 100)}%`, background: open ? '#e9c46a' : undefined }} />
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${Math.round(gate * 100)}%`, width: 2, background: '#fff' }} title="trigger threshold" />
              </div>
              <span className="wb-motion-val">{z.toFixed(2)}</span>
            </div>
            <label className="wb-meter-row" style={{ fontSize: 11 }}>
              <span className="wb-mod-label">threshold</span>
              <input type="range" min={0} max={0.9} step={0.01} value={gate} onChange={(e) => setGate(i, Number(e.target.value))} style={{ flex: 1 }} aria-label={`trigger threshold, ${zoneLabels?.[i] ?? `zone ${i + 1}`}`} />
              <span className="wb-motion-val">{Math.round(gate * 100)}%</span>
            </label>
          </div>
        );
      })}

      <div className="wb-settings-section">Detection</div>
      <div className="wb-knob-row">
        <Knob label="Release" value={release} min={0} max={3} step={0.05} reset={0.4} onChange={setRelease} format={(v) => `${v.toFixed(2)}s`} />
        <Knob label="Contrast" value={contrast} min={1} max={4} step={0.1} reset={1.8} onChange={setContrast} format={(v) => v.toFixed(1)} />
        <Knob label="Thresh" value={threshold} min={6} max={80} step={1} reset={24} onChange={(v) => setThreshold(Math.round(v))} format={(v) => `${Math.round(v)}`} />
        <Knob label="Gain" value={sensitivity} min={1} max={30} step={1} reset={8} onChange={(v) => setSensitivity(Math.round(v))} format={(v) => `${Math.round(v)}×`} />
      </div>
    </div>
  );
}
