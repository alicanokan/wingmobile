// ============================================================================
//  MobileMenu — the compact top-right control popover for the mobile experience.
//  Minimal rig + router: camera on/off, a compact source→sensor matrix (route
//  the camera or any device D1–D5 onto the 5 sensors), particle size, and the
//  master release time. Edits rig.global live (the projection reads it every
//  frame; the App autosave persists it).
// ============================================================================

import { useState } from 'react';
import { rig } from './rig.ts';
import { SLOTS, type SourceKind, type SourceMap } from './inputs.ts';

const SRC_CHOICES: { key: SourceKind; label: string }[] = [
  { key: 'off', label: '—' },
  { key: 'camera', label: 'Cam' },
  { key: 'dev1', label: 'D1' },
  { key: 'dev2', label: 'D2' },
  { key: 'dev3', label: 'D3' },
  { key: 'dev4', label: 'D4' },
  { key: 'dev5', label: 'D5' },
];

interface Props {
  camOn: boolean;
  onCam: () => void;
  sources: SourceMap;
  onSource: (slot: string, s: SourceKind) => void;
  onClose: () => void;
  deviceTier?: 'ultra-low' | 'low' | 'mid' | 'high';
  lowPowerMode?: boolean;
  onLowPowerMode?: (v: boolean) => void;
  showCollection?: boolean;
  onShowCollection?: (v: boolean) => void;
}

export function MobileMenu({ camOn, onCam, sources, onSource, onClose, deviceTier, lowPowerMode, onLowPowerMode, showCollection, onShowCollection }: Props) {
  const [size, setSize] = useState(rig.global.size);
  const [rel, setRel] = useState(rig.global.release);

  const deviceLabel =
    deviceTier === 'ultra-low' ? 'Older device (optimized)' :
    deviceTier === 'low' ? 'Low power device' :
    deviceTier === 'mid' ? 'Modern mobile' :
    'Desktop';

  return (
    <div className="wb-mx">
      <div className="wb-mx-head">
        <span>Quick controls</span>
        <button className="wb-btn" style={{ padding: '2px 8px' }} onClick={onClose}>
          ✕
        </button>
      </div>

      {deviceTier && (
        <div className="wb-mx-sec">Device: {deviceLabel}</div>
      )}

      <button className={`wb-btn ${camOn ? 'active' : ''}`} style={{ width: '100%' }} onClick={onCam}>
        {camOn ? '● Camera on' : 'Camera off'}
      </button>

      {lowPowerMode !== undefined && (
        <button className={`wb-btn ${lowPowerMode ? 'active' : ''}`} style={{ width: '100%' }} onClick={() => onLowPowerMode?.(!lowPowerMode)}>
          {lowPowerMode ? '⚡ Power saving on' : 'Power saving off'}
        </button>
      )}

      {showCollection !== undefined && (
        <button className={`wb-btn ${showCollection ? 'active' : ''}`} style={{ width: '100%' }} onClick={() => onShowCollection?.(!showCollection)}>
          {showCollection ? '❖ Collection visible' : 'Collection hidden'}
        </button>
      )}

      <div className="wb-mx-sec">Route → sensors</div>
      <div className="wb-mx-matrix">
        {SLOTS.map((slot, i) => (
          <div className="wb-mx-row" key={slot.id}>
            <span className="wb-mx-rowlabel">S{i + 1}</span>
            {SRC_CHOICES.map((c) => (
              <button
                key={c.key}
                className={`wb-mx-cell ${sources[slot.id] === c.key ? 'sel' : ''}`}
                onClick={() => onSource(slot.id, c.key)}
              >
                {c.label}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="wb-mx-sec">Particle size · {Math.round(size)}</div>
      <input
        type="range"
        className="wb-ctl-slider"
        min={8}
        max={120}
        step={1}
        value={size}
        onChange={(e) => {
          const v = Number(e.target.value);
          setSize(v);
          rig.global.size = v;
        }}
      />

      <div className="wb-mx-sec">Master release · {rel.toFixed(2)}s</div>
      <input
        type="range"
        className="wb-ctl-slider"
        min={0.02}
        max={2}
        step={0.01}
        value={rel}
        onChange={(e) => {
          const v = Number(e.target.value);
          setRel(v);
          rig.global.release = v;
        }}
      />
    </div>
  );
}
