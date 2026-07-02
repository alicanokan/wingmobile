// ============================================================================
//  Mic panel — live audio input level + envelope, for the shared MicSource.
//
//  The mic is owned by App and read once per frame by the central input router;
//  this panel mirrors the live input level and exposes the gain + release tail.
//  WHICH sensor the mic drives is set in the Inputs routing matrix.
// ============================================================================

import { useEffect, useState } from 'react';
import type { MicSource } from './mic.ts';
import { Knob } from './Knob.tsx';

interface Props {
  mic: MicSource;
  onClose: () => void;
}

export function MicPanel({ mic, onClose }: Props) {
  const [level, setLevel] = useState(0);
  const [gain, setGain] = useState(mic.gain);
  const [release, setRelease] = useState(mic.releaseTime);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState(mic.deviceId);

  useEffect(() => void (mic.gain = gain), [mic, gain]);
  useEffect(() => void (mic.releaseTime = release), [mic, release]);

  // Enumerate input devices (labels appear once mic permission is granted).
  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.enumerateDevices) return;
    const list = () =>
      md.enumerateDevices().then((d) => setDevices(d.filter((x) => x.kind === 'audioinput')));
    list();
    md.addEventListener?.('devicechange', list);
    return () => md.removeEventListener?.('devicechange', list);
  }, []);

  // Poll the last level for the meter (the router samples the mic each frame).
  useEffect(() => {
    const id = setInterval(() => setLevel(mic.lastLevel), 60);
    return () => clearInterval(id);
  }, [mic]);

  return (
    <div className="wb-motion">
      <div className="wb-settings-head">
        <span>Mic · Audio Input</span>
        <button className="wb-btn" style={{ padding: '2px 8px' }} onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="wb-settings-note">
        Live microphone level. Patch the mic onto a sensor point in the Inputs matrix; this panel sets input gain and the release tail.
      </div>

      {/* input device picker */}
      <div className="wb-set-row">
        <label style={{ width: 48 }}>Device</label>
        <select
          value={deviceId}
          onChange={(e) => {
            setDeviceId(e.target.value);
            mic.setDevice(e.target.value).catch(() => {});
          }}
        >
          <option value="">System default</option>
          {devices.map((d, i) => (
            <option key={d.deviceId || i} value={d.deviceId}>
              {d.label || `Microphone ${i + 1}`}
            </option>
          ))}
        </select>
      </div>

      {/* big level meter */}
      <div className="wb-level">
        <div className="wb-level-fill" style={{ width: `${Math.round(level * 100)}%` }} />
        <span className="wb-level-val">{level.toFixed(2)}</span>
      </div>

      <div className="wb-settings-section">Envelope · Sensitivity</div>
      <div className="wb-knob-row" style={{ justifyContent: 'flex-start', gap: 18 }}>
        <Knob label="Release" value={release} min={0} max={3} step={0.05} reset={0.4} onChange={setRelease} format={(v) => `${v.toFixed(2)}s`} />
        <Knob label="Gain" value={gain} min={0.2} max={6} step={0.1} reset={1} onChange={setGain} format={(v) => `${v.toFixed(1)}×`} />
      </div>
    </div>
  );
}
