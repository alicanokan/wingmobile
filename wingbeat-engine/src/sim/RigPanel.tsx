// ============================================================================
//  Rig panel — modular control surface for the particle feather.
//    Presets · Image analysis (auto layers) · Advanced (color-range / area
//    layers) · Routing matrix (sensor → any layers) · per-sensor module racks.
// ============================================================================

import { useRef, useState } from 'react';
import { SENSOR_CHANNELS } from './channels.ts';
import {
  rig,
  defaultSensorRig,
  combinedLayers,
  layerSound,
  layerGen,
  setLayerGen,
  layerRelease,
  setLayerRelease,
  notifyLayersChange,
  MODULE_TYPES,
  MODULE_LABELS,
  MOTION_TYPES,
  MOTION_LABELS,
  AUDIO_BANDS,
  AUDIO_BAND_LABELS,
  type MotionType,
  type AudioBand,
  type ModuleType,
  type SensorRig,
  type LayerDef,
} from './rig.ts';
import { listPresets, savePreset, recallPreset, deletePreset, exportPreset, importPreset, saveLast } from './presets.ts';
import type { AudioEngine } from '../engine/AudioEngine.ts';
import type { EngineSnapshot } from './useEngine.ts';

function hex(rgb: [number, number, number]) {
  const h = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return `#${h(rgb[0])}${h(rgb[1])}${h(rgb[2])}`;
}
function unhex(s: string): [number, number, number] {
  return [parseInt(s.slice(1, 3), 16) / 255, parseInt(s.slice(3, 5), 16) / 255, parseInt(s.slice(5, 7), 16) / 255];
}
const rgbStr = (c: number[]) => `rgb(${(c[0] * 255) | 0},${(c[1] * 255) | 0},${(c[2] * 255) | 0})`;
function layerSwatch(L: LayerDef): string {
  if (L.rgb) return rgbStr(L.rgb);
  return 'repeating-linear-gradient(45deg,#555,#555 2px,#888 2px,#888 4px)'; // area
}

function Slider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <div className="wb-set-row">
      <label>{label}</label>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
      <span className="wb-motion-val">{value.toFixed(step < 0.01 ? 3 : step < 1 ? 2 : 0)}</span>
    </div>
  );
}

export function RigPanel({ snapshot, audio, onClose }: { snapshot: EngineSnapshot; audio: AudioEngine; onClose: () => void }) {
  const feather = snapshot.feather;
  const palette = snapshot.featherPalette;
  const counts = snapshot.featherLayerCounts;
  const total = Math.max(1, counts.reduce((a, b) => a + b, 0));
  const layers = combinedLayers(palette);
  const [, setTick] = useState(0);
  const rr = () => setTick((v) => v + 1);
  const relayout = () => { notifyLayersChange(); rr(); };
  const [presetName, setPresetName] = useState(rig.name);
  const [presets, setPresets] = useState<string[]>(() => listPresets());
  const fileRef = useRef<HTMLInputElement | null>(null);
  const layerFileRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const loopFileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const refresh = () => setPresets(listPresets());
  const sensorRig = (id: string): SensorRig => rig.sensors[id] ?? (rig.sensors[id] = defaultSensorRig(id));

  return (
    <div className="wb-rig">
      <div className="wb-settings-head">
        <span>Feather · Rig — {feather}</span>
        <button className="wb-btn" style={{ padding: '2px 8px' }} onClick={onClose}>✕</button>
      </div>

      {/* PRESETS — portable: a preset saved here can be recalled on ANY feather */}
      <div className="wb-settings-section">Presets · profiles (work on any feather)</div>
      <div className="wb-set-row">
        <select value="" onChange={(e) => { if (e.target.value && recallPreset(e.target.value)) { setPresetName(e.target.value); saveLast(feather); relayout(); } }}>
          <option value="">recall profile…</option>
          {presets.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div className="wb-set-row">
        <input className="wb-input" style={{ width: 110 }} value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="profile name" />
        <button className="wb-btn" style={{ padding: '4px 8px' }} onClick={() => { const n = presetName.trim() || 'preset'; savePreset(n); saveLast(feather); refresh(); }}>save</button>
        <button className="wb-btn" style={{ padding: '4px 8px' }} onClick={() => { deletePreset(presetName); refresh(); }}>del</button>
      </div>
      <div className="wb-set-row">
        <button className="wb-btn" style={{ padding: '4px 8px' }} onClick={() => exportPreset(presetName || 'preset')}>export json</button>
        <button className="wb-btn" style={{ padding: '4px 8px' }} onClick={() => fileRef.current?.click()}>import</button>
        <input ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) importPreset(f).then(() => { setPresetName(rig.name); refresh(); relayout(); }).catch((err) => alert(err?.message || 'Could not import that file.')); }} />
      </div>

      {/* IMAGE ANALYSIS */}
      <div className="wb-settings-section">Image analysis</div>
      {palette.length === 0 ? (
        <div className="wb-settings-note">Pick a photographic feather to analyze its layers.</div>
      ) : (
        <>
          <Slider label="auto layers" value={rig.autoK} min={2} max={6} step={1} onChange={(v) => { rig.autoK = v; relayout(); }} />
          <div className="wb-layers">
            {palette.slice(0, rig.autoK).map((c, i) => (
              <div className="wb-layer" key={i}>
                <span className="wb-swatch" style={{ background: rgbStr(c) }} />
                <span>L{i}</span>
                <span className="wb-layer-count">{(((counts[i] ?? 0) / total) * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ADVANCED — custom layers */}
      <div className="wb-settings-section">Advanced · custom layers</div>
      <div className="wb-set-row">
        <button className="wb-btn" style={{ padding: '4px 8px' }} onClick={() => { rig.customLayers.push({ kind: 'color', label: `C${rig.customLayers.length}`, rgb: [1, 0.5, 0.1], tol: 0.22 }); relayout(); }}>+ color range</button>
        <button className="wb-btn" style={{ padding: '4px 8px' }} onClick={() => { rig.customLayers.push({ kind: 'area', label: `A${rig.customLayers.length}`, yMin: 0, yMax: 0.3 }); relayout(); }}>+ area</button>
      </div>
      {rig.customLayers.map((L, idx) => (
        <div className="wb-custom-layer" key={idx}>
          <div className="wb-set-row">
            <span className="wb-swatch" style={{ background: layerSwatch(L) }} />
            <label style={{ width: 60 }}>{L.kind === 'color' ? 'color' : 'area'}</label>
            <span className="wb-motion-val" style={{ flex: 1, textAlign: 'left', color: '#999' }}>L{rig.autoK + idx}</span>
            <button className="wb-btn" style={{ padding: '2px 7px' }} onClick={() => { rig.customLayers.splice(idx, 1); relayout(); }}>✕</button>
          </div>
          {L.kind === 'color' && (
            <>
              <div className="wb-set-row">
                <label>pick</label>
                <input type="color" value={hex(L.rgb ?? [1, 0.5, 0.1])} onChange={(e) => { L.rgb = unhex(e.target.value); relayout(); }} />
              </div>
              <Slider label="tolerance" value={L.tol ?? 0.22} min={0.03} max={0.6} step={0.01} onChange={(v) => { L.tol = v; relayout(); }} />
            </>
          )}
          {L.kind === 'area' && (
            <>
              <Slider label="from (tail)" value={L.yMin ?? 0} min={0} max={1} step={0.01} onChange={(v) => { L.yMin = v; relayout(); }} />
              <Slider label="to (tip)" value={L.yMax ?? 1} min={0} max={1} step={0.01} onChange={(v) => { L.yMax = v; relayout(); }} />
            </>
          )}
        </div>
      ))}

      {/* LAYER SOUNDS */}
      {layers.length > 0 && (
        <>
          <div className="wb-settings-section">Layer sounds</div>
          {layers.map((L, i) => {
            const snd = layerSound(i);
            return (
              <div className="wb-set-row" key={i}>
                <span className="wb-swatch" style={{ background: rgbStr(L.rgb ?? [0.5, 0.5, 0.5]) }} />
                <label style={{ width: 28 }}>L{i}</label>
                <input
                  ref={(el) => { layerFileRefs.current[i] = el; }}
                  type="file" accept="audio/*" style={{ display: 'none' }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) audio.loadLayerSample(i, f).then(() => { snd.mode = 'sample'; snd.sampleName = f.name; rr(); }).catch((err) => alert(err?.message || 'load failed')); }}
                />
                <button className="wb-btn" style={{ padding: '3px 6px' }} title="load sample" onClick={() => layerFileRefs.current[i]?.click()}>load</button>
                <button className="wb-btn" style={{ padding: '3px 6px' }} title="generate pattern" onClick={() => { snd.mode = 'pattern'; snd.seed = Math.floor(performance.now() % 100000) / 100000; rr(); }}>gen</button>
                <button className="wb-btn accent" style={{ padding: '3px 7px' }} title="preview" onClick={() => audio.previewLayer(i, snd.mode, snd.seed ?? 0).catch(() => {})}>▶</button>
                <span className="wb-sample-name" title={snd.sampleName}>
                  {snd.mode === 'sample' ? snd.sampleName : snd.mode === 'pattern' ? 'pattern' : 'synth'}
                </span>
                {snd.mode !== 'synth' && (
                  <button className="wb-btn" style={{ padding: '3px 6px' }} title="back to synth" onClick={() => { snd.mode = 'synth'; audio.clearLayerSample(i); rr(); }}>×</button>
                )}
                <span title="ATTACK: how fast this layer's charge climbs calamus→barbs" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 3 }}>
                  <label style={{ opacity: 0.7 }}>atk</label>
                  <input type="range" min={0.002} max={0.2} step={0.001} value={layerGen(i)} style={{ width: 52 }}
                    onChange={(e) => { setLayerGen(i, parseFloat(e.target.value)); rr(); }} />
                </span>
                <span title="RELEASE: how fast this layer's charge fades after" style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                  <label style={{ opacity: 0.7 }}>rel</label>
                  <input type="range" min={0.002} max={0.2} step={0.001} value={layerRelease(i)} style={{ width: 52 }}
                    onChange={(e) => { setLayerRelease(i, parseFloat(e.target.value)); rr(); }} />
                </span>
              </div>
            );
          })}
        </>
      )}

      {/* GLOBAL */}
      <div className="wb-settings-section">Global motion</div>
      <Slider label="Motion (0 = still image)" value={rig.global.motion} min={0} max={1.5} step={0.01} onChange={(v) => { rig.global.motion = v; rr(); }} />
      <Slider label="Relief (3D depth)" value={rig.global.relief} min={0} max={2.5} step={0.01} onChange={(v) => { rig.global.relief = v; rr(); }} />
      <Slider label="Wing-beat (swing)" value={rig.global.wingBeat} min={0} max={2} step={0.01} onChange={(v) => { rig.global.wingBeat = v; rr(); }} />
      <Slider label="Idle sway" value={rig.global.sway} min={0} max={1.5} step={0.01} onChange={(v) => { rig.global.sway = v; rr(); }} />
      <Slider label="Ambient drift" value={rig.global.ambient} min={0} max={1} step={0.01} onChange={(v) => { rig.global.ambient = v; rr(); }} />
      <Slider label="Spread (all-5)" value={rig.global.disperse} min={0} max={3} step={0.01} onChange={(v) => { rig.global.disperse = v; rr(); }} />
      <Slider label="Audio react" value={rig.global.audioReact} min={0} max={2} step={0.01} onChange={(v) => { rig.global.audioReact = v; rr(); }} />
      <Slider label="Audio → color" value={rig.global.audioColor} min={0} max={1.5} step={0.01} onChange={(v) => { rig.global.audioColor = v; rr(); }} />
      <div className="wb-set-row">
        <label>Auto-audio</label>
        <button className={`wb-btn ${rig.global.autoAudio ? 'accent' : ''}`} style={{ padding: '3px 10px' }}
          title="loops play on their own and each one drives/colors its routed layer (no triggering needed)"
          onClick={(e) => { rig.global.autoAudio = !rig.global.autoAudio; e.currentTarget.blur(); rr(); }}>
          {rig.global.autoAudio ? 'ON' : 'OFF'}
        </button>
        <span style={{ opacity: 0.6 }}>loops drive their layers</span>
      </div>
      <Slider label="Idle fall (s)" value={rig.global.idleFall} min={1} max={30} step={1} onChange={(v) => { rig.global.idleFall = v; rr(); }} />
      <Slider label="Layer hold" value={rig.global.hold} min={0} max={1} step={0.01} onChange={(v) => { rig.global.hold = v; rr(); }} />
      <div className="wb-set-row">
        <label>Pulse color</label>
        <input type="color" value={hex(rig.global.pulseColor)} onChange={(e) => { rig.global.pulseColor = unhex(e.target.value); rr(); }} />
        <span style={{ opacity: 0.6 }}>beat wave swept up each layer</span>
      </div>
      <Slider label="Attack" value={rig.global.attack} min={0.002} max={0.2} step={0.001} onChange={(v) => { rig.global.attack = v; rr(); }} />
      <Slider label="Release" value={rig.global.release} min={0.002} max={0.2} step={0.001} onChange={(v) => { rig.global.release = v; rr(); }} />
      <Slider label="Float time (s)" value={rig.global.floatTime} min={0} max={5} step={0.1} onChange={(v) => { rig.global.floatTime = v; rr(); }} />
      <Slider label="Gravity-sand" value={rig.global.gravity} min={0} max={1.5} step={0.01} onChange={(v) => { rig.global.gravity = v; rr(); }} />
      <Slider label="Rachis lock" value={rig.global.stability} min={0} max={1} step={0.01} onChange={(v) => { rig.global.stability = v; rr(); }} />
      <Slider label="Particle size" value={rig.global.size} min={10} max={120} step={1} onChange={(v) => { rig.global.size = v; rr(); }} />
      <Slider label="Particle amount" value={rig.global.amount} min={0} max={1} step={0.02} onChange={(v) => { rig.global.amount = v; relayout(); }} />
      <Slider label="Loop BPM" value={rig.global.bpm} min={60} max={180} step={1} onChange={(v) => { rig.global.bpm = v; audio.setBpm(v); rr(); }} />

      {/* ROUTING MATRIX */}
      <div className="wb-settings-section">Matrix · route sensors → layers</div>
      <table className="wb-matrix">
        <thead>
          <tr>
            <th></th>
            {layers.map((L, i) => (
              <th key={i}>
                {L.rgb ? (
                  <input
                    type="color"
                    style={{ width: 22, height: 16, padding: 0, border: '1px solid #2c2c38', background: 'none', cursor: 'pointer', borderRadius: 3 }}
                    title={`${L.label} — colour source (click to change which colour this layer captures)`}
                    value={hex(L.rgb as [number, number, number])}
                    onChange={(e) => {
                      const c = unhex(e.target.value);
                      if (i < rig.autoK) rig.autoColors[i] = c;
                      else if (L.kind === 'color') L.rgb = c;
                      relayout();
                    }}
                  />
                ) : (
                  <span className="wb-swatch sm" style={{ background: layerSwatch(L) }} title={L.label} />
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SENSOR_CHANNELS.map((ch) => {
            const s = sensorRig(ch.sensor);
            return (
              <tr key={ch.sensor}>
                <td className="wb-matrix-name">{ch.label}</td>
                {layers.map((_, li) => (
                  <td key={li}>
                    <input type="checkbox" checked={s.layers.includes(li)} onChange={(e) => { s.layers = e.target.checked ? [...s.layers, li] : s.layers.filter((x) => x !== li); rr(); }} />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* PER-SENSOR MODULE RACKS */}
      {SENSOR_CHANNELS.map((ch) => {
        const s = sensorRig(ch.sensor);
        const wind = snapshot.nodes.find((n) => n.id === ch.sensor)?.wind ?? 0;
        return (
          <div className="wb-rig-sensor" key={ch.sensor}>
            <div className="wb-rig-sensor-head">
              <span>{ch.label} <span className="wb-key">[{ch.key.toUpperCase()}]</span></span>
              <span className="wb-mod-chips">
                {MODULE_TYPES.map((m) => (
                  <button key={m} className={`wb-chip sm ${s.modules[m] ? 'active' : ''}`} onClick={(e) => { s.modules[m] = !s.modules[m]; e.currentTarget.blur(); rr(); }} title={s.modules[m] ? `remove ${MODULE_LABELS[m]}` : `add ${MODULE_LABELS[m]}`}>
                    {s.modules[m] ? '−' : '+'} {MODULE_LABELS[m]}
                  </button>
                ))}
              </span>
            </div>
            {s.modules.monitor && (
              <div className="wb-meter-row">
                <span className="wb-mod-label">monitor</span>
                <div className="wb-meter"><div className="wb-meter-fill" style={{ width: `${Math.min(100, wind * 100)}%` }} /></div>
              </div>
            )}
            {s.modules.movement && (
              <>
                <div className="wb-set-row">
                  <label>motion</label>
                  <select value={s.motionType} onChange={(e) => { s.motionType = e.target.value as MotionType; rr(); }}>
                    {MOTION_TYPES.map((m) => <option key={m} value={m}>{MOTION_LABELS[m]}</option>)}
                  </select>
                </div>
                <div className="wb-set-row">
                  <label title="which EQ band of this sensor's loop drives its motion">react to</label>
                  <select value={s.audioBand ?? 'full'} onChange={(e) => { s.audioBand = e.target.value as AudioBand; rr(); }}>
                    {AUDIO_BANDS.map((b) => <option key={b} value={b}>{AUDIO_BAND_LABELS[b]}</option>)}
                  </select>
                </div>
                <Slider label="reach" value={s.reach} min={0} max={2} step={0.01} onChange={(v) => { s.reach = v; rr(); }} />
                <Slider label="amount" value={s.swirl} min={0} max={1.5} step={0.01} onChange={(v) => { s.swirl = v; rr(); }} />
                <Slider label="vertical" value={s.lift} min={0} max={1.5} step={0.01} onChange={(v) => { s.lift = v; rr(); }} />
                <Slider label="max dist" value={s.maxDist} min={0.1} max={3} step={0.01} onChange={(v) => { s.maxDist = v; rr(); }} />
              </>
            )}
            {s.modules.release && (
              <>
                <Slider label="attack" value={s.attack} min={0.002} max={0.2} step={0.001} onChange={(v) => { s.attack = v; rr(); }} />
                <Slider label="release" value={s.release} min={0.002} max={0.2} step={0.001} onChange={(v) => { s.release = v; rr(); }} />
              </>
            )}
            {s.modules.color && (
              <div className="wb-set-row">
                <label>recolor →</label>
                <input type="color" value={hex(s.overrideRGB)} onChange={(e) => { s.overrideRGB = unhex(e.target.value); s.colorOverride = true; rr(); }} />
                <span style={{ opacity: 0.6 }}>tints this layer when triggered</span>
              </div>
            )}
            {/* synced loop sample — launches on bar when the sensor is active */}
            <div className="wb-set-row">
              <label>loop ♺</label>
              <input
                ref={(el) => { loopFileRefs.current[ch.sensor] = el; }}
                type="file" accept="audio/*" style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) audio.loadLoopSample(ch.sensor, f).then(() => { s.loopSample = f.name; rr(); }).catch((err) => alert(err?.message || 'load failed')); }}
              />
              <button className="wb-btn" style={{ padding: '3px 7px' }} title="load a loop sample" onClick={() => loopFileRefs.current[ch.sensor]?.click()}>
                {s.loopSample ? 'replace' : 'load loop'}
              </button>
              <span className="wb-sample-name" title={s.loopSample}>{s.loopSample || '—'}</span>
              {s.loopSample && (
                <button className="wb-btn" style={{ padding: '3px 6px' }} title="remove loop" onClick={() => { audio.clearLoop(ch.sensor); s.loopSample = undefined; rr(); }}>×</button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
