// ============================================================================
//  Settings + Mixer panel.
//
//  Mixer:    per-layer volume + mute (so the constant drone can be silenced),
//            plus master volume.
//  Voices:   swap the drone oscillator, the wind's noise colour, reverb amount.
//  Samples:  load your own audio file to REPLACE a layer's trigger sound
//            (melody / percussion / accent). Clear to return to the synth.
//
//  Works before "Start audio" too — values are stored and applied on start.
// ============================================================================

import { useRef, useState } from 'react';
import {
  AudioEngine,
  LAYER_LABELS,
  type LayerName,
  type SampleLayer,
  type BedOsc,
  type NoiseColor,
} from '../engine/AudioEngine.ts';
import { SENSOR_CHANNELS } from './channels.ts';
import { rig } from './rig.ts';
import type { WingbeatEngine } from '../engine/WingbeatEngine.ts';

const LAYERS: LayerName[] = ['bed', 'wind', 'melody', 'perc', 'accent'];
const SAMPLE_LAYERS: SampleLayer[] = ['melody', 'perc', 'accent'];
const OSC: BedOsc[] = ['sine', 'triangle', 'sawtooth', 'square', 'fatsawtooth', 'amsine'];
const NOISE: NoiseColor[] = ['white', 'pink', 'brown'];

interface Props {
  audio: AudioEngine;
  engine: WingbeatEngine;
  audioReady: boolean;
  masterGain: number;
  onMaster: (g: number) => void;
  onClose: () => void;
}

export function SettingsPanel({ audio, engine, audioReady, masterGain, onMaster, onClose }: Props) {
  const [, setTick] = useState(0);
  const rerender = () => setTick((v) => v + 1);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  return (
    <div className="wb-settings">
      <div className="wb-settings-head">
        <span>Audio · Settings &amp; Mixer</span>
        <button className="wb-btn" style={{ padding: '2px 8px' }} onClick={onClose}>
          ✕
        </button>
      </div>

      {!audioReady && (
        <div className="wb-settings-note">Press “Start audio” to hear changes — settings are saved meanwhile.</div>
      )}

      {/* AUTO PATTERNS — the generative melody/perc/accent triggers (the pulsing) */}
      <div className="wb-set-row">
        <label>Auto patterns</label>
        <button
          className={`wb-btn ${engine.patternsOn ? 'accent' : ''}`}
          style={{ padding: '3px 10px' }}
          title="generative melody / percussion / accent triggers — turn OFF to stop the pulsing and drive the piece from sensors + loops only"
          onClick={() => {
            engine.setPatterns(!engine.patternsOn);
            rerender();
          }}
        >
          {engine.patternsOn ? 'ON' : 'OFF'}
        </button>
        <span className="wb-sample-name muted">{engine.patternsOn ? 'generative pulse on' : 'sensors + loops only'}</span>
      </div>

      {/* MIXER */}
      <div className="wb-settings-section">Mixer</div>
      <div className="wb-mix-row">
        <span className="wb-mix-name">Master</span>
        <span className="wb-mix-mute" />
        <input type="range" min={0} max={1} step={0.01} value={masterGain} onChange={(e) => onMaster(parseFloat(e.target.value))} />
      </div>
      {LAYERS.map((name) => {
        const s = audio.mixer[name];
        return (
          <div className="wb-mix-row" key={name}>
            <span className="wb-mix-name">{LAYER_LABELS[name]}</span>
            <button
              className={`wb-mix-mute ${s.mute ? 'on' : ''}`}
              title={s.mute ? 'unmute' : 'mute'}
              onClick={() => {
                audio.setLayerMute(name, !s.mute);
                rerender();
              }}
            >
              {s.mute ? 'M' : '·'}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={s.gain}
              onChange={(e) => {
                audio.setLayerGain(name, parseFloat(e.target.value));
                rerender();
              }}
            />
          </div>
        );
      })}

      {/* VOICES */}
      <div className="wb-settings-section">Voices</div>
      <div className="wb-set-row">
        <label>Drone wave</label>
        <select
          value={audio.bedOsc}
          onChange={(e) => {
            audio.setBedOsc(e.target.value as BedOsc);
            rerender();
          }}
        >
          {OSC.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
      <div className="wb-set-row">
        <label>Wind noise</label>
        <select
          value={audio.noiseColor}
          onChange={(e) => {
            audio.setNoiseColor(e.target.value as NoiseColor);
            rerender();
          }}
        >
          {NOISE.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
      <div className="wb-set-row">
        <label>Reverb</label>
        <input
          type="range"
          min={0}
          max={0.9}
          step={0.01}
          value={audio.reverbWet}
          onChange={(e) => {
            audio.setReverbWet(parseFloat(e.target.value));
            rerender();
          }}
        />
      </div>

      {/* SAMPLES */}
      <div className="wb-settings-section">Samples — replace a layer’s sound</div>
      {SAMPLE_LAYERS.map((layer) => {
        const s = audio.mixer[layer];
        return (
          <div className="wb-set-row" key={layer}>
            <label>{LAYER_LABELS[layer]}</label>
            <div className="wb-sample-ctl">
              <input
                ref={(el) => {
                  fileRefs.current[layer] = el;
                }}
                type="file"
                accept="audio/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f)
                    audio
                      .loadSample(layer, f)
                      .then(rerender)
                      .catch((err) => alert(err?.message || 'Could not load that audio file.'));
                }}
              />
              <button className="wb-btn" style={{ padding: '3px 8px' }} onClick={() => fileRefs.current[layer]?.click()}>
                {s.sample ? 'replace' : 'load'}
              </button>
              {s.sample ? (
                <>
                  <button
                    className="wb-btn accent"
                    style={{ padding: '3px 8px' }}
                    title="preview sample"
                    onClick={() => audio.previewSample(layer).catch(() => {})}
                  >
                    ▶
                  </button>
                  <span className="wb-sample-name" title={s.sample}>
                    {s.sample}
                  </span>
                  <button
                    className="wb-btn"
                    style={{ padding: '3px 8px' }}
                    title="back to synth"
                    onClick={() => {
                      audio.clearSample(layer);
                      rerender();
                    }}
                  >
                    synth
                  </button>
                </>
              ) : (
                <span className="wb-sample-name muted">synth</span>
              )}
            </div>
          </div>
        );
      })}

      {/* SENSOR LOOPS — multichannel loop player (one synced loop per sensor) */}
      <div className="wb-settings-section">Sensor loops — one synced loop per sensor</div>
      <div className="wb-settings-note">
        Each loop plays in sync; triggering a sensor fades its loop up, and that loop’s sound drives its layer’s motion.
      </div>
      {SENSOR_CHANNELS.map((ch) => {
        const s = rig.sensors[ch.sensor];
        const name = s?.loopSample;
        const key = `loop_${ch.sensor}`;
        return (
          <div className="wb-set-row" key={ch.sensor}>
            <label>{ch.label}</label>
            <div className="wb-sample-ctl">
              <input
                ref={(el) => {
                  fileRefs.current[key] = el;
                }}
                type="file"
                accept="audio/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f)
                    audio
                      .loadLoopSample(ch.sensor, f)
                      .then(() => {
                        if (s) s.loopSample = f.name;
                        rerender();
                      })
                      .catch((err) => alert(err?.message || 'Could not load that loop.'));
                }}
              />
              <button className="wb-btn" style={{ padding: '3px 8px' }} onClick={() => fileRefs.current[key]?.click()}>
                {name ? 'replace' : 'load loop'}
              </button>
              {name ? (
                <>
                  <span className="wb-sample-name" title={name}>
                    {name}
                  </span>
                  <button
                    className="wb-btn"
                    style={{ padding: '3px 8px' }}
                    title="remove loop"
                    onClick={() => {
                      audio.clearLoop(ch.sensor);
                      if (s) s.loopSample = undefined;
                      rerender();
                    }}
                  >
                    ✕
                  </button>
                </>
              ) : (
                <span className="wb-sample-name muted">—</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
