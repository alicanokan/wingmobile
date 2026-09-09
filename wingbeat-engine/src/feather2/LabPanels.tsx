import { LIFE_MODES, type LayerLife } from './layerLife';
import { useMemo } from 'react';
import type { Anatomy } from './anatomy.ts';
import { describeAnatomy } from './analysisReport.ts';
import { ELEMENTS, type ElementId } from '../led/elements.ts';
import type { MasterEffectConfig } from './masterEffects.ts';

export type LayerKind = 'colors' | 'parts' | 'patterns';
export type LayerTarget = 'brightness' | 'size' | 'movement' | 'depth';
export type LayerRoutes = Record<ElementId, Partial<Record<LayerTarget, number>>>;
export type LayerControl = LayerLife & {
  id: string;
  groupId: string;
  name: string;
  kind: LayerKind;
  index: number;
  brightness: number;
  size: number;
  movement: number;
  depth: number;
  visible: boolean;
  audioEnabled: boolean;
  routes: LayerRoutes;
  assignedZoneId?: string;
};
export type LayerGroup = LayerLife & {
  id: string;
  name: string;
  brightness: number;
  size: number;
  movement: number;
  depth: number;
  visible: boolean;
  audioEnabled: boolean;
  expanded: boolean;
  effect: MasterEffectConfig;
  routes: LayerRoutes;
};
export type LayerControls = { source: string; selectedId: string; layers: LayerControl[]; groups: LayerGroup[] };

export function LabIcon({ name, size = 18 }: { name: 'feather' | 'upload' | 'expand' | 'reset' | 'wind' | 'orbit' | 'audio' | 'mic' | 'play' | 'pause' | 'close'; size?: number }) {
  const paths: Record<typeof name, string> = {
    feather: 'M20 3c-8-2-14 3-14 10v5m0-5 7-7M6 18l-3 3m3-3c7 0 13-6 14-15M9 10h7M6 14h7',
    upload: 'M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5',
    expand: 'M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5',
    reset: 'M3 10a9 9 0 1 1 2 8M3 4v6h6',
    wind: 'M3 8h12a3 3 0 1 0-3-3M3 12h16a2 2 0 1 1-2 2M3 16h7a3 3 0 1 1-3 3',
    orbit: 'M21 12a9 9 0 1 1-3-7M21 3v6h-6M12 9v6m-3-3h6',
    audio: 'M9 18V5l11-2v12M9 8l11-2M9 18a3 2 0 1 1-3-2c2 0 3 1 3 2m11-3a3 2 0 1 1-3-2c2 0 3 1 3 2',
    mic: 'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5m-3 6v1a6 6 0 0 0 12 0v-1m-6 7v4m-3 0h6',
    play: 'm8 4 12 8-12 8V4', pause: 'M8 4v16M16 4v16',
    close: 'm6 6 12 12M6 18 18 6',
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

const PART_LABELS = ['Calamus', 'Rachis', 'Firm vane', 'Down', 'Markings'];
const PART_COLORS = ['#a3916c', '#e8c56a', '#7baff0', '#73d4a2', '#ec93c3'];
export function AnalysisPanel({ anatomy, elapsed }: { anatomy: Anatomy; elapsed: number }) {
  const report = useMemo(() => describeAnatomy(anatomy), [anatomy]);
  const maxWidth = Math.max(0.05, ...report.profile.flatMap((bin) => [bin.left, bin.right]));
  const profilePath = report.profile.map((bin, i) => `${150 - bin.left / maxWidth * 112},${145 - i * 4}`).join(' ') + ' ' +
    [...report.profile].reverse().map((bin, i) => `${150 + bin.right / maxWidth * 112},${21 + i * 4}`).join(' ');
  return <>
    <div className="f2-section-heading"><h2>Structure estimate</h2><span>{(elapsed / 1000).toFixed(2)} s</span></div>
    <div className="f2-classification"><strong>{anatomy.kind}</strong><span>Based on shape and texture</span></div>
    <div className="f2-stats">
      <div><strong>{anatomy.count.toLocaleString()}</strong><span>sampled points</span></div>
      <div><strong>{anatomy.zones.length}</strong><span>pattern zones</span></div>
    </div>
    <div className="f2-section-heading"><h2>Anatomy distribution</h2></div>
    <div className="f2-composition" aria-label="Anatomy distribution">{report.parts.map((count, i) => <span key={i} style={{ width: `${count / anatomy.count * 100}%`, background: PART_COLORS[i] }} />)}</div>
    <div className="f2-part-list">{report.parts.map((count, i) => <div key={i}><i style={{ background: PART_COLORS[i] }} /><span>{PART_LABELS[i]}</span><b>{(count / anatomy.count * 100).toFixed(1)}%</b></div>)}</div>
    <div className="f2-section-heading"><h2>Vane profile</h2><span>base → tip</span></div>
    <svg className="f2-profile" viewBox="0 0 300 164" role="img" aria-label="Measured feather width along the shaft">
      {[38, 74, 110, 146].map((y) => <line key={y} x1="22" x2="278" y1={y} y2={y} stroke="#263032" strokeDasharray="2 5" />)}
      <polygon points={profilePath} fill="#b5e6c416" stroke="#b5e6c4" strokeWidth="1.2" />
      <line x1="150" x2="150" y1="16" y2="150" stroke="#788b80" strokeDasharray="3 4" />
    </svg>
    <div className="f2-statline"><span>Left / right vane</span><strong>{Math.round(report.left * 100)} / {Math.round(report.right * 100)}%</strong></div>
    <div className="f2-statline"><span>Barb direction clarity</span><strong>{Math.round(report.clarity * 100)}%</strong></div>
    <div className="f2-statline"><span>Downy vane</span><strong>{Math.round(anatomy.plumFrac * 100)}%</strong></div>
    <div className="f2-section-heading"><h2>Extracted palette</h2></div>
    <div className="f2-palette">{anatomy.palette.map((rgb, i) => {
      const hex = '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
      return <div key={i} title={`${hex} · ${(report.palette[i] / anatomy.count * 100).toFixed(1)}% of points`}><i style={{ background: hex }} /><span>{Math.round(report.palette[i] / anatomy.count * 100)}%</span></div>;
    })}</div>
    <p className="f2-note">Measurements come from the photo. Lighting, background and image sharpness affect the estimate; the scan does not identify a species.</p>
  </>;
}

const LAYER_TARGETS: Array<{ id: LayerTarget; short: string; label: string }> = [
  { id: 'brightness', short: 'BRT', label: 'Brightness' },
  { id: 'size', short: 'SIZ', label: 'Particle size' },
  { id: 'movement', short: 'MOV', label: 'Movement' },
  { id: 'depth', short: 'DEP', label: 'Separation' },
];

export function emptyLayerRoutes(): LayerRoutes {
  return Object.fromEntries(ELEMENTS.map((element) => [element.id, {}])) as LayerRoutes;
}

export function LayerMixer({ anatomy, controls, zones, onSelect, onAdd, onAddGroup, onAutoSeparate, onRemove, onChange, onMoveLayer, onSolo, onRoute }: {
  anatomy: Anatomy;
  controls: LayerControls;
  zones: Array<{ id: string; name: string }>;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onAddGroup: () => void;
  onAutoSeparate: () => void;
  onRemove: (id: string) => void;
  onChange: (id: string, field: string, value: string | number | boolean) => void;
  onMoveLayer: (id: string, groupId: string) => void;
  onSolo: (id: string) => void;
  onRoute: (id: string, element: ElementId, target: LayerTarget, clear: boolean) => void;
}) {
  const swatches = anatomy.palette.map((rgb) => `rgb(${rgb.map((v) => Math.round(v * 255)).join(',')})`);
  const selectedLayer = controls.layers.find((layer) => layer.id === controls.selectedId);
  const selectedGroup = controls.groups.find((group) => group.id === controls.selectedId);
  const selected = selectedLayer ?? selectedGroup ?? controls.groups[0] ?? controls.layers[0];
  const colorFor = (layer: LayerControl) => layer.kind === 'colors'
    ? swatches[layer.index] ?? '#a9c7b4'
    : layer.kind === 'parts'
      ? PART_COLORS[layer.index] ?? '#a9c7b4'
      : `hsl(${(layer.index * 47) % 360} 55% 68%)`;
  const sourceOptions = [
    ...PART_LABELS.map((label, index) => ({ value: `parts:${index}`, label: `Body · ${label}` })),
    ...anatomy.palette.map((_, index) => ({ value: `colors:${index}`, label: `Colour · ${String.fromCharCode(65 + index)}` })),
    ...anatomy.zones.slice(0, 12).map((_, index) => ({ value: `patterns:${index}`, label: `Pattern · ${String(index + 1).padStart(2, '0')}` })),
  ];
  return <div className="f2-layer-editor">
    <div className="f2-layer-toolbar">
      <div><strong>Master layers</strong><span>{controls.groups.length} groups · {controls.layers.length} masks</span></div>
      <div className="f2-layer-actions"><button onClick={onAutoSeparate} title="Rebuild colour, anatomy and pattern masks into analysis groups">Auto 8</button><button className="f2-layer-add" onClick={onAddGroup} aria-label="Create a master">＋ Master</button></div>
    </div>
    <div className="f2-layer-stack" role="listbox" aria-label="Image layers">
      {[...controls.groups].reverse().map((group) => <div className={`f2-master-layer ${group.visible ? '' : 'is-hidden'}`} key={group.id}>
        <div role="option" tabIndex={0} aria-selected={group.id === selected?.id} className={`f2-master-row ${group.id === selected?.id ? 'selected' : ''}`} onClick={() => onSelect(group.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(group.id); } }}>
          <button className="f2-layer-eye" aria-label={`${group.name} visibility`} aria-pressed={group.visible} onClick={(event) => { event.stopPropagation(); onChange(group.id, 'visible', !group.visible); }}>●</button>
          <button className="f2-layer-disclosure" aria-label={`${group.expanded ? 'Collapse' : 'Expand'} ${group.name}`} onClick={(event) => { event.stopPropagation(); onChange(group.id, 'expanded', !group.expanded); }}>{group.expanded ? '⌄' : '›'}</button>
          <span><b>{group.name}</b><small>MASTER · {controls.layers.filter((layer) => layer.groupId === group.id).length} MASKS</small></span>
          <button className="f2-layer-solo" onClick={(event) => { event.stopPropagation(); onSolo(group.id); }}>SOLO</button>
        </div>
        {group.expanded && <div className="f2-master-children">{[...controls.layers].reverse().filter((layer) => layer.groupId === group.id).map((layer) => <div
          role="option"
          tabIndex={0}
          aria-selected={layer.id === selected?.id}
          className={`f2-layer-item ${layer.id === selected?.id ? 'selected' : ''} ${layer.visible ? '' : 'is-hidden'}`}
          key={layer.id}
          onClick={() => onSelect(layer.id)}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(layer.id); } }}
        >
          <button className="f2-layer-eye" aria-label={`${layer.name} visibility`} aria-pressed={layer.visible} onClick={(event) => { event.stopPropagation(); onChange(layer.id, 'visible', !layer.visible); }}>●</button>
          <i className="f2-layer-chip" style={{ background: colorFor(layer) }} />
          <span><b>{layer.name}</b><small>{layer.kind.slice(0, -1)} {layer.index + 1}</small></span>
          <button className="f2-layer-solo" onClick={(event) => { event.stopPropagation(); onSolo(layer.id); }}>SOLO</button>
        </div>)}</div>}
      </div>)}
    </div>
    <button className="f2-add-mask" onClick={onAdd}>＋ Add image mask to selected master</button>
    {selected && <div className="f2-layer-properties">
      <div className="f2-layer-properties-head">
        <span>{selectedGroup ? 'Master layer properties' : 'Image mask properties'}</span>
        <button onClick={() => onRemove(selected.id)} disabled={selectedGroup ? controls.groups.length <= 1 : controls.layers.length <= 1}>Delete</button>
      </div>
      <label className="f2-layer-field"><span>Name</span><input value={selected.name} onChange={(event) => onChange(selected.id, 'name', event.target.value)} /></label>
      {selectedLayer && <><label className="f2-layer-field"><span>Master</span><select value={selectedLayer.groupId} onChange={(event) => onMoveLayer(selectedLayer.id, event.target.value)}>
        {controls.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
      </select></label>
      <label className="f2-layer-field"><span>Source mask</span><select value={`${selectedLayer.kind}:${selectedLayer.index}`} onChange={(event) => onChange(selectedLayer.id, 'kind', event.target.value)}>
        {sourceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select></label>
      <label className="f2-layer-field"><span>Behaviour zone</span><select value={selectedLayer.assignedZoneId ?? ''} onChange={(event) => onChange(selectedLayer.id, 'assignedZoneId', event.target.value)}>
        <option value="">Follow master routing</option>
        {zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
      </select></label></>}
      {selectedGroup && <p className="f2-note">This group is an analysis bucket. Auto detect or click cells in the Zones tab, then save happens on this device.</p>}
      <div className="f2-life-panel">
        <h3>Always-on behaviour</h3>
        <label className="f2-layer-field"><span>Movement</span><select aria-label="Always-on movement" value={selected.lifeMode ?? (selectedLayer ? -1 : 1)} onChange={event => onChange(selected.id, 'lifeMode', Number(event.target.value))}>
          {selectedLayer && <option value={-1}>Follow master</option>}
          {LIFE_MODES.map((label, index) => <option key={label} value={index}>{label}</option>)}
        </select></label>
        {(!selectedLayer || (selected.lifeMode ?? -1) >= 0) && <div className="f2-layer-sliders">{([
          ['lifeAmount', 'Motion amount', 0.12, 2], ['lifeSpeed', 'Speed', 0.45, 3],
          ['lifeGlow', 'Glow rhythm', 0, 2], ['lifeHue', 'Colour travel', 0, 1],
        ] as const).map(([key, label, fallback, max]) => <label key={key}><span>{label}<output>{(selected[key] ?? fallback).toFixed(2)}</output></span><input aria-label={label} type="range" min="0" max={max} step="0.01" value={selected[key] ?? fallback} onChange={event => onChange(selected.id, key, Number(event.target.value))} /></label>)}</div>}
        <p className="f2-note">Runs without audio. Masks can follow their master or use their own behaviour. Rachis and calamus stay aligned. Set Wave on the rachis to bend both together; each keeps its own glow and colour rhythm.</p>
      </div>
      <div className="f2-layer-sliders">
        {LAYER_TARGETS.map((target) => {
          const value = selected[target.id];
          return <label key={target.id}><span>{target.label}<output>{value.toFixed(2)}</output></span><input type="range" min={target.id === 'size' ? .25 : 0} max={target.id === 'movement' || target.id === 'depth' ? 4 : 2} step=".05" value={value} onChange={(event) => onChange(selected.id, target.id, Number(event.target.value))} /></label>;
        })}
      </div>
      <div className="f2-layer-matrix-toggle"><span>Audio matrix</span><button role="switch" aria-checked={selected.audioEnabled} onClick={() => onChange(selected.id, 'audioEnabled', !selected.audioEnabled)}>{selected.audioEnabled ? 'ACTIVE' : 'MUTED'}</button></div>
      <details className="f2-layer-routing">
        <summary><span>Audio matrix</span><small>Advanced</small></summary>
        <div className="f2-layer-audio-head"><span>{selectedGroup ? 'Master audio routing' : 'Mask routing'}</span><small>off → 50% → 100%</small></div>
        <div className="f2-layer-matrix-scroll">
          <table className="f2-layer-matrix">
            <thead><tr><th>Signal</th>{LAYER_TARGETS.map((target) => <th key={target.id} title={target.label}>{target.short}</th>)}</tr></thead>
            <tbody>{ELEMENTS.map((element) => <tr key={element.id}>
              <td title={element.hint}>{element.label}</td>
              {LAYER_TARGETS.map((target) => {
                const gain = selected.routes[element.id]?.[target.id] ?? 0;
                return <td key={target.id}><button className={gain >= 1 ? 'full' : gain > 0 ? 'half' : ''} aria-label={`${element.label} to ${target.label}`} aria-pressed={gain > 0} onClick={(event) => onRoute(selected.id, element.id, target.id, event.shiftKey)} /></td>;
              })}
            </tr>)}</tbody>
          </table>
        </div>
        <p className="f2-note">{selectedGroup ? 'Drives every visible mask in this analysis group.' : 'Refines only this image mask.'}</p>
      </details>
    </div>}
  </div>;
}
