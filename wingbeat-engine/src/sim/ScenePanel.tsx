// ============================================================================
//  Scene panel — the per-feather scene: culture, tempo, its 5 samples, layers.
//
//    Scene    which culture pack this feather plays (palette tint + scale).
//    Tempo    the BPM its loops are authored at (drives the loop transport).
//    Samples  one loop per feather PART (Tip / Rachis / Color A/B / Tail) — the
//             feather's 5 sounds, themed to its origin.
//    Layers   the analyzed colour layers (L0…), with per-layer sound mode.
// ============================================================================

import { useRef, useState } from 'react';
import { SCENES } from '../engine/scenes.ts';
import { SENSOR_CHANNELS } from './channels.ts';
import { rig, layerSound, notifyLayersChange, type LayerSoundMode } from './rig.ts';
import { Knob } from './Knob.tsx';
import { sceneForFeather, setFeatherScene } from './featherScenes.ts';
import type { WingbeatEngine } from '../engine/WingbeatEngine.ts';
import type { AudioEngine } from '../engine/AudioEngine.ts';
import type { EngineSnapshot } from './useEngine.ts';

const rgbStr = (c: number[]) => `rgb(${(c[0] * 255) | 0},${(c[1] * 255) | 0},${(c[2] * 255) | 0})`;
const SOUND_MODES: LayerSoundMode[] = ['synth', 'sample', 'pattern'];

interface Props {
  snapshot: EngineSnapshot;
  engine: WingbeatEngine;
  audio: AudioEngine;
  onClose: () => void;
}

export function ScenePanel({ snapshot, engine, audio, onClose }: Props) {
  const feather = snapshot.feather;
  const palette = snapshot.featherPalette;
  const counts = snapshot.featherLayerCounts;
  const total = Math.max(1, counts.reduce((a, b) => a + b, 0));
  const sceneKey = sceneForFeather(feather);

  const [, setTick] = useState(0);
  const rr = () => setTick((v) => v + 1);
  const loopRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const pickScene = (key: string) => {
    setFeatherScene(feather, key);
    engine.setScene(key);
    rr();
  };

  return (
    <div className="wb-scene">
      <div className="wb-settings-head">
        <span>Scene · {SCENES[sceneKey]?.label ?? feather}</span>
        <button className="wb-btn" style={{ padding: '2px 8px' }} onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="wb-settings-note">
        This feather’s scene. Each feather plays a different culture pack — its tempo, palette, and 5 part samples follow its origin.
      </div>

      {/* SCENE — which culture this feather belongs to */}
      <div className="wb-settings-section">Scene · culture</div>
      <div className="wb-rail-group" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {Object.values(SCENES).map((s) => (
          <button
            key={s.key}
            className={`wb-chip ${sceneKey === s.key ? 'active' : ''}`}
            onClick={() => pickScene(s.key)}
            title={s.origin}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* TEMPO */}
      <div className="wb-settings-section">Tempo</div>
      <div className="wb-knob-row" style={{ justifyContent: 'flex-start' }}>
        <Knob
          label="BPM"
          value={rig.global.bpm}
          min={40}
          max={200}
          step={1}
          reset={SCENES[sceneKey]?.bpm ?? 120}
          onChange={(v) => {
            rig.global.bpm = Math.round(v);
            audio.setBpm(rig.global.bpm);
            rr();
          }}
          format={(v) => `${Math.round(v)}`}
        />
        <div className="wb-scene-hint">
          loops play at this tempo · scene default {SCENES[sceneKey]?.bpm ?? 120}
        </div>
      </div>

      {/* SAMPLES — one loop per part */}
      <div className="wb-settings-section">Samples · {SENSOR_CHANNELS.length} parts</div>
      {SENSOR_CHANNELS.map((ch) => {
        const s = rig.sensors[ch.sensor];
        const name = s?.loopSample;
        return (
          <div className="wb-set-row" key={ch.sensor}>
            <label style={{ width: 62 }}>{ch.label}</label>
            <input
              ref={(el) => {
                loopRefs.current[ch.sensor] = el;
              }}
              type="file"
              accept="audio/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f && s)
                  audio
                    .loadLoopSample(ch.sensor, f)
                    .then(() => {
                      s.loopSample = f.name;
                      rr();
                    })
                    .catch((err) => alert(err?.message || 'load failed'));
              }}
            />
            <button
              className="wb-btn"
              style={{ padding: '3px 8px' }}
              onClick={() => loopRefs.current[ch.sensor]?.click()}
            >
              {name ? 'replace' : 'load'}
            </button>
            <span className="wb-sample-name" title={name}>
              {name || '—'}
            </span>
            {name && s && (
              <button
                className="wb-btn"
                style={{ padding: '3px 6px' }}
                title="remove"
                onClick={() => {
                  audio.clearLoop(ch.sensor);
                  s.loopSample = undefined;
                  rr();
                }}
              >
                ×
              </button>
            )}
          </div>
        );
      })}

      {/* LAYERS */}
      <div className="wb-settings-section">Layers</div>
      {palette.length === 0 ? (
        <div className="wb-settings-note">Pick a photographic feather to analyze its colour layers.</div>
      ) : (
        <>
          <div className="wb-set-row">
            <label>count</label>
            <input
              type="range"
              min={2}
              max={6}
              step={1}
              value={rig.autoK}
              onChange={(e) => {
                rig.autoK = parseInt(e.target.value, 10);
                notifyLayersChange();
                rr();
              }}
            />
            <span className="wb-motion-val">{rig.autoK}</span>
          </div>
          {palette.slice(0, rig.autoK).map((c, i) => {
            const snd = layerSound(i);
            return (
              <div className="wb-set-row" key={i}>
                <span className="wb-swatch" style={{ background: rgbStr(c) }} />
                <label style={{ width: 28 }}>L{i}</label>
                <span className="wb-layer-count" style={{ width: 34 }}>
                  {(((counts[i] ?? 0) / total) * 100).toFixed(0)}%
                </span>
                <select
                  value={snd.mode}
                  onChange={(e) => {
                    snd.mode = e.target.value as LayerSoundMode;
                    rr();
                  }}
                >
                  {SOUND_MODES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
