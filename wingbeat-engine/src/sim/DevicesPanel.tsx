// ============================================================================
//  Controllers panel — pair up to DEVICE_COUNT phones, each its own room.
//
//  Every device gets a unique Device ID + Code and a matching source (D1..D5).
//  Each card shows a live level slider (its incoming motion) so you can confirm
//  data is arriving before routing D1..D5 onto sensors in the Routing matrix.
// ============================================================================

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useTheme, qrColors } from './theme.ts';
import type { LinkStatus } from '../net/link.ts';
import type { SourceKind } from './inputs.ts';
import { Knob } from './Knob.tsx';

interface DeviceInfo {
  deviceId: string;
  code: string;
}

interface Props {
  devices: Array<DeviceInfo | null>;
  statuses: LinkStatus[];
  peers: number[];
  levels: Partial<Record<SourceKind, number>>;
  log: string[];
  onClose: () => void;
  /** Per-device noise floor 0..1 (below this, incoming level reads as 0). */
  thresholds?: number[];
  onThresholdChange?: (index: number, v: number) => void;
}

function DeviceCard({ index, info, status, peers, level, threshold, onThresholdChange }: { index: number; info: DeviceInfo | null; status: LinkStatus; peers: number; level: number; threshold: number; onThresholdChange?: (index: number, v: number) => void }) {
  const [qr, setQr] = useState('');
  const [theme] = useTheme();
  // QR open by default on desktop; collapsed on phones to keep the panel compact.
  const [show, setShow] = useState(() => typeof window === 'undefined' || window.innerWidth > 820);
  const url = info ? `${location.origin}/controller?d=${info.deviceId}&c=${info.code}` : '';

  useEffect(() => {
    if (!url || !show) return;
    QRCode.toDataURL(url, { margin: 1, width: 180, color: qrColors(theme) })
      .then(setQr)
      .catch(() => setQr(''));
  }, [url, show, theme]);

  const connected = peers > 0;
  const state = connected ? `${peers} phone${peers > 1 ? 's' : ''}` : status === 'error' ? 'error' : status === 'connecting' || status === 'idle' ? 'starting…' : 'free';

  return (
    <div className="wb-dev">
      <div className="wb-dev-head">
        <span className="wb-dev-name">
          <span className={`wb-dot ${connected ? 'connected' : status === 'error' ? 'error' : 'connecting'}`} style={{ marginRight: 6 }} />
          Device {index + 1}
          <span className="wb-dev-src">D{index + 1}</span>
        </span>
        <span className="wb-dev-state">{state}</span>
      </div>

      {info && (
        <div className="wb-dev-codes">
          <span className="wb-dev-code">
            ID <b>{info.deviceId}</b>
          </span>
          <span className="wb-dev-code">
            Code <b>{info.code}</b>
          </span>
          <button className="wb-btn" style={{ padding: '2px 8px', marginLeft: 'auto' }} onClick={() => setShow((s) => !s)}>
            {show ? 'Hide QR' : 'QR'}
          </button>
        </div>
      )}

      <div className="wb-level">
        <div className="wb-level-fill" style={{ width: `${Math.round(level * 100)}%`, background: 'linear-gradient(90deg,#7c3aed,#c4a8ff)' }} />
        <span className="wb-level-val">{level.toFixed(2)}</span>
      </div>

      {onThresholdChange && (
        <div className="wb-knob-row" style={{ marginTop: 4 }}>
          <Knob
            label="Thresh"
            value={threshold}
            min={0}
            max={0.9}
            step={0.02}
            reset={0}
            onChange={(v) => onThresholdChange(index, v)}
            format={(v) => v.toFixed(2)}
            size={36}
          />
        </div>
      )}

      {show && qr && <img className="wb-dev-qr" src={qr} alt={`pair device ${index + 1}`} />}
      {show && url && <div className="wb-phone-url">{url}</div>}
    </div>
  );
}

/**
 * Always-on compact meter strip (mobile) — overlays the top of the feather so
 * you can watch each connected device's live level while the feather reacts.
 * Tapping it opens the full Controllers panel. Hidden on desktop via CSS.
 */
export function DeviceHud({ peers, levels, onOpen }: { peers: number[]; levels: Partial<Record<SourceKind, number>>; onOpen: () => void }) {
  return (
    <div className="wb-hud" onClick={onOpen} title="tap to open controllers">
      {peers.map((n, i) => {
        const connected = n > 0;
        const lvl = levels[`dev${i + 1}` as SourceKind] ?? 0;
        return (
          <div className={`wb-hud-cell ${connected ? 'on' : 'off'}`} key={i}>
            <span className="wb-hud-label">D{i + 1}</span>
            <div className="wb-hud-bar">
              <div className="wb-hud-fill" style={{ width: `${Math.round(lvl * 100)}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function DevicesPanel({ devices, statuses, peers, levels, log, onClose, thresholds, onThresholdChange }: Props) {
  const n = devices.length;
  const onLocalhost = typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
  return (
    <div className="wb-motion wb-devices">
      <div className="wb-settings-head">
        <span>Phone · Controllers</span>
        <button className="wb-btn" style={{ padding: '2px 8px' }} onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="wb-settings-note">
        Pair up to {n} phones — each gets its own <b>Device ID + Code</b> and its own source <b>D1–D{n}</b>. Watch each one's live level below, then route
        <b> D1–D{n}</b> onto sensors in the Routing matrix. <b>Thresh</b> ignores jitter below that level (a phone lying still).
      </div>

      {onLocalhost && (
        <div className="wb-settings-note warn">
          You're on <b>localhost</b> — a phone on the QR can't reach that. Open the console on your <b>Network URL</b> (the LAN IP Vite prints, e.g. http://192.168.x.x:5199) so the QR points somewhere phones can actually connect.
        </div>
      )}

      {devices.map((info, i) => (
        <DeviceCard
          key={i}
          index={i}
          info={info}
          status={statuses[i] ?? 'idle'}
          peers={peers[i] ?? 0}
          level={levels[`dev${i + 1}` as SourceKind] ?? 0}
          threshold={thresholds?.[i] ?? 0}
          onThresholdChange={onThresholdChange}
        />
      ))}

      <details className="wb-log-box">
        <summary>Debug log ({log.length})</summary>
        <button className="wb-btn" style={{ padding: '2px 8px', marginBottom: 6 }} onClick={() => navigator.clipboard?.writeText(log.join('\n')).catch(() => {})}>
          Copy log
        </button>
        <div className="wb-log">{log.length ? log.map((l, i) => <div key={i}>{l}</div>) : <div style={{ opacity: 0.5 }}>no events yet</div>}</div>
      </details>
    </div>
  );
}
