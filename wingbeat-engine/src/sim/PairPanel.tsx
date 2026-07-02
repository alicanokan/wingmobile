// ============================================================================
//  Controller pairing panel — joins a phone as a remote controller.
//
//  Shows a QR (opens /controller with the Device ID + Code prefilled) plus the
//  Device ID and Code in large type so they can also be typed in by hand on the
//  controller page. The phone then drives the "Net" source, scene, tempo and
//  master volume over a direct WebRTC link (see net/link.ts).
// ============================================================================

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { LinkStatus } from '../net/link.ts';

interface Props {
  info: { deviceId: string; code: string } | null;
  status: LinkStatus;
  peers: number;
  log: string[];
  onClose: () => void;
}

const STATUS_LABEL: Record<LinkStatus, string> = {
  idle: 'starting…',
  connecting: 'opening room…',
  ready: 'waiting for phone',
  peer: 'controller connected',
  error: 'link error',
};

export function PairPanel({ info, status, peers, log, onClose }: Props) {
  const url = info ? `${location.origin}/controller?d=${info.deviceId}&c=${info.code}` : '';
  const [qr, setQr] = useState('');

  useEffect(() => {
    if (!url) return;
    QRCode.toDataURL(url, { margin: 1, width: 240, color: { dark: '#e8e8e8', light: '#0c0c12' } })
      .then(setQr)
      .catch(() => setQr(''));
  }, [url]);

  return (
    <div className="wb-motion">
      <div className="wb-settings-head">
        <span>Phone · Controller</span>
        <button className="wb-btn" style={{ padding: '2px 8px' }} onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="wb-settings-note">
        Scan on a phone to open the remote controller — or open <b>/controller</b> and type the Device ID + Code below. Motion is auto-routed to
        the <b>Net</b> source; scene, tempo and volume apply directly. Several phones can join the same code at once.
      </div>

      {qr && <img className="wb-phone-qr" src={qr} alt="scan to pair controller" />}

      {info && (
        <div className="wb-pair-codes">
          <div className="wb-pair-code">
            <span className="wb-pair-label">Device ID</span>
            <span className="wb-pair-value">{info.deviceId}</span>
          </div>
          <div className="wb-pair-code">
            <span className="wb-pair-label">Code</span>
            <span className="wb-pair-value">{info.code}</span>
          </div>
        </div>
      )}

      <div className="wb-phone-url">{url}</div>

      <div className="wb-meter-row" style={{ marginTop: 12 }}>
        <span className="wb-mod-label">
          <span className={`wb-dot ${status === 'peer' ? 'connected' : status === 'error' ? 'error' : status === 'ready' ? 'connecting' : ''}`} style={{ marginRight: 6 }} />
          {peers > 0 ? `${peers} controller${peers > 1 ? 's' : ''} connected` : STATUS_LABEL[status]}
        </span>
      </div>

      <details className="wb-log-box">
        <summary>Debug log ({log.length})</summary>
        <button
          className="wb-btn"
          style={{ padding: '2px 8px', marginBottom: 6 }}
          onClick={() => navigator.clipboard?.writeText(log.join('\n')).catch(() => {})}
        >
          Copy log
        </button>
        <div className="wb-log">{log.length ? log.map((l, i) => <div key={i}>{l}</div>) : <div style={{ opacity: 0.5 }}>no events yet</div>}</div>
      </details>
    </div>
  );
}
