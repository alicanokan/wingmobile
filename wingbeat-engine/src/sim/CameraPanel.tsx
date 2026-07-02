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
}

export function CameraPanel({ cam, onClose, onDisable, compact }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [hud, setHud] = useState(0);
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
    const id = setInterval(() => setHud(cam.lastMotion), 100);
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
