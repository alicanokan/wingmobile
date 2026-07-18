// ============================================================================
//  /feather — display-only projection for a second screen.
//
//  Runs its own engine + (silent) audio and mirrors the console over the sync
//  channel: it applies the broadcast wind/presence/scene/palette and loads the
//  rig snapshot when it changes. Open it in a separate window and go fullscreen
//  while the console stays on your main screen. No controls — just the feather.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import './ui.css';
import { WingbeatEngine } from '../engine/WingbeatEngine.ts';
import { AudioEngine } from '../engine/AudioEngine.ts';
import { LAYOUT } from '../engine/spatial.ts';
import { Projection } from './Projection.tsx';
import { DEFAULT_FEATHER } from './feathers.ts';
import { loadIntoRig, notifyLayersChange } from './rig.ts';
import { createReceiver, presenceSend } from './sync.ts';
import { useConductorSync } from '../net/liveSync.ts';

export default function FeatherView() {
  const engine = useMemo(() => new WingbeatEngine(), []);
  const audio = useMemo(() => new AudioEngine(), []); // silent here — visuals only
  const [feather, setFeather] = useState(DEFAULT_FEATHER);
  const [waiting, setWaiting] = useState(true);
  const [isFull, setIsFull] = useState(false);
  const layerKey = useRef(''); // last applied layer config, to gate rebuilds

  // Conductor pushes reach remote displays too (a console on the same machine
  // mirrors the same state over the sync channel anyway — they agree).
  useConductorSync({ engine, audio, onFeather: setFeather });

  // Tell the console we're open (so it pauses its own projection). Ping while
  // alive; say goodbye on close so the console resumes promptly.
  useEffect(() => {
    const p = presenceSend();
    p.alive();
    const id = setInterval(() => p.alive(), 1000);
    const bye = () => p.bye();
    window.addEventListener('pagehide', bye);
    return () => {
      clearInterval(id);
      window.removeEventListener('pagehide', bye);
      p.bye();
      p.close();
    };
  }, []);

  // Track fullscreen state for the button label.
  useEffect(() => {
    const onFs = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  };

  // Populate the room so the engine has nodes to receive wind on.
  useEffect(() => {
    for (const node of LAYOUT.nodes) {
      engine.ingestStatus(node.id, { online: true, role: node.role, fw: 'sim', rssi: -40 });
    }
  }, [engine]);

  // Apply console broadcasts.
  useEffect(() => {
    return createReceiver((m) => {
      if (m.kind === 'state') {
        setWaiting(false);
        const s = m.state;
        if (s.scene && s.scene !== engine.scene) engine.setScene(s.scene, 0);
        for (const n of s.nodes) {
          engine.ingestWind(n.i, n.w);
          engine.ingestPresence(n.i, n.p);
        }
        if (s.palette?.length) engine.setFeatherPalette(s.palette);
        setFeather((f) => (f !== s.feather ? s.feather : f));
      } else if (m.kind === 'rig') {
        loadIntoRig(m.preset);
        // only rebuild the particle cloud when the LAYER config actually changes
        const key = JSON.stringify({ k: m.preset.autoK, c: m.preset.customLayers, a: m.preset.autoColors });
        if (key !== layerKey.current) {
          layerKey.current = key;
          notifyLayersChange();
        }
      }
    });
  }, [engine]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#050507' }}>
      <Projection engine={engine} audio={audio} featherId={feather} />
      <button className="wb-feather-fs" onClick={toggleFullscreen} title="Toggle fullscreen">
        {isFull ? '✕ exit fullscreen' : '⛶ fullscreen'}
      </button>
      {waiting && (
        <div
          style={{
            position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#5a5a6a', font: '300 12px/1.6 ui-sans-serif, system-ui', letterSpacing: '0.24em',
            textTransform: 'uppercase', pointerEvents: 'none',
          }}
        >
          waiting for console · keep the Wing Beat console open
        </div>
      )}
    </div>
  );
}
