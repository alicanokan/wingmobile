// ============================================================================
//  Phone camera panel — QR to join a phone as a networked camera.
//
//  Scan the QR on a phone on the same WiFi → it opens /cam, runs the motion
//  detection locally, and streams the result here as the "Net" source (route it
//  to a sensor in the Inputs matrix). Only motion numbers cross the network.
// ============================================================================

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface Props {
  alive: boolean;
  level: number;
  onClose: () => void;
}

export function PhonePanel({ alive, level, onClose }: Props) {
  const url = `${location.origin}/cam`;
  const [qr, setQr] = useState('');
  const onLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const insecure = !onLocalhost && location.protocol !== 'https:';

  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 240, color: { dark: '#e8e8e8', light: '#0c0c12' } })
      .then(setQr)
      .catch(() => setQr(''));
  }, [url]);

  return (
    <div className="wb-motion">
      <div className="wb-settings-head">
        <span>Phone · Camera</span>
        <button className="wb-btn" style={{ padding: '2px 8px' }} onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="wb-settings-note">
        Scan on a phone on the same WiFi. It runs the motion detection on-device and streams only the result — route the <b>Net</b> source to a sensor in the matrix.
      </div>

      {qr && <img className="wb-phone-qr" src={qr} alt="scan to join" />}
      <div className="wb-phone-url">{url}</div>

      {onLocalhost && (
        <div className="wb-settings-note" style={{ color: '#e0b060', borderColor: '#3a2f16', background: '#161206' }}>
          You're on <b>localhost</b> — a phone can't reach that. Open the console on your <b>Network URL</b> (the LAN IP Vite prints) so the QR points at this machine.
        </div>
      )}
      {insecure && (
        <div className="wb-settings-note" style={{ color: '#e0b060', borderColor: '#3a2f16', background: '#161206' }}>
          Phone cameras need a secure page — serve over <b>https</b> so the phone can open its webcam.
        </div>
      )}

      <div className="wb-meter-row" style={{ marginTop: 12 }}>
        <span className="wb-mod-label">
          <span className={`wb-dot ${alive ? 'connected' : ''}`} style={{ marginRight: 6 }} />
          net
        </span>
        <div className="wb-meter">
          <div className="wb-meter-fill" style={{ width: `${Math.round(level * 100)}%` }} />
        </div>
        <span className="wb-motion-val">{alive ? level.toFixed(2) : '—'}</span>
      </div>
    </div>
  );
}
