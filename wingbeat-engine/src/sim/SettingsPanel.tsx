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

import { useRef, useState , useEffect} from 'react';
import { useRigTick } from './useRig.ts';
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
import { midiOut } from '../midi/MidiOut.ts';
import { getNetConfig, setNetConfig, isUsingFreeInfra } from '../net/link.ts';

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
  const rerender = useRigTick();
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  useEffect(() => midiOut.onChange(rerender), [rerender]);
  const net = getNetConfig();
  const free = isUsingFreeInfra(net);
  const setNet = (patch: Parameters<typeof setNetConfig>[0]) => { setNetConfig(patch); rerender(); };

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

      <div className="wb-settings-section">MIDI out — drive external gear</div>
      <div className="wb-settings-note">
        melody → ch 1 · percussion → ch 10 · accent → ch 2 · room wind → CC 1 · each sensor → CC 20+ · scene → program change.
        {!midiOut.supported && ' This browser has no Web MIDI (use Chrome / Edge).'}
      </div>
      <div className="wb-set-row">
        <label>Enable</label>
        <input type="checkbox" checked={midiOut.state.enabled} disabled={!midiOut.supported} onChange={(e) => midiOut.setEnabled(e.target.checked)} />
        <span className="wb-motion-val">
          {midiOut.status === 'ready' ? (midiOut.active ? 'sending' : 'no output chosen') : midiOut.status}
        </span>
      </div>
      <div className="wb-set-row">
        <label>Output</label>
        <select value={midiOut.state.outputId} disabled={!midiOut.outputs.length} onChange={(e) => midiOut.selectOutput(e.target.value)}>
          {midiOut.outputs.length ? midiOut.outputs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>) : <option value="">— none found —</option>}
        </select>
        {midiOut.supported && midiOut.status !== 'ready' && (
          <button className="wb-btn" style={{ padding: '3px 8px' }} onClick={() => void midiOut.request()}>scan</button>
        )}
      </div>

      <div className="wb-settings-section">Network — phones (venue kit)</div>
      <div className="wb-settings-note">
        {free.signalling ? '⚠ Signalling via the free PeerJS cloud' : `Signalling via ${net.peerHost}:${net.peerPort}`}
        {' · '}
        {free.turn ? '⚠ TURN via the public openrelay' : 'TURN: own server'}
        {' — phones must be built with the same values (docs/VENUE_KIT.md).'}
      </div>
      <div className="wb-set-row">
        <label>PeerJS host</label>
        <input className="wb-input" value={net.peerHost} placeholder="empty = free cloud" onChange={(e) => setNet({ peerHost: e.target.value })} />
        <input className="wb-input" style={{ width: 70 }} type="number" value={net.peerPort} onChange={(e) => setNet({ peerPort: Number(e.target.value) })} />
      </div>
      <div className="wb-set-row">
        <label>Path / key</label>
        <input className="wb-input" style={{ width: 90 }} value={net.peerPath} onChange={(e) => setNet({ peerPath: e.target.value })} />
        <input className="wb-input" style={{ width: 110 }} value={net.peerKey} onChange={(e) => setNet({ peerKey: e.target.value })} />
        <label style={{ marginLeft: 8 }}>
          <input type="checkbox" checked={net.peerSecure} onChange={(e) => setNet({ peerSecure: e.target.checked })} /> https
        </label>
      </div>
      <div className="wb-set-row">
        <label>TURN urls</label>
        <input className="wb-input" value={net.turnUrls.join(',')} placeholder="turn:host:3478,turn:host:443?transport=tcp" onChange={(e) => setNet({ turnUrls: e.target.value.split(',').map((u) => u.trim()).filter(Boolean) })} />
      </div>
      <div className="wb-set-row">
        <label>TURN user / cred</label>
        <input className="wb-input" style={{ width: 110 }} value={net.turnUser} onChange={(e) => setNet({ turnUser: e.target.value })} />
        <input className="wb-input" style={{ width: 130 }} type="password" value={net.turnCred} onChange={(e) => setNet({ turnCred: e.target.value })} />
        <button className="wb-btn" style={{ padding: '3px 8px' }} title="back to env / free defaults" onClick={() => setNet(null)}>reset</button>
      </div>
      <div className="wb-settings-note">Changes apply to new phone connections (reload the console to re-register rooms).</div>
    </div>
  );
}
