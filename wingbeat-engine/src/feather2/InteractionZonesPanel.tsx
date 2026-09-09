import { ELEMENTS, type ElementId } from '../led/elements.ts';
import type { LayerGroup } from './LabPanels.tsx';
import type { InteractionZone, InteractionZoneDocument } from './interactionZones.ts';

export function InteractionZonesPanel({ groups, document, onSelect, onAdd, onDetect, onRemove, onChange, onRoute }: {
  groups: LayerGroup[];
  document: InteractionZoneDocument;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDetect: () => void;
  onRemove: (id: string) => void;
  onChange: (id: string, field: keyof InteractionZone, value: string | number | boolean) => void;
  onRoute: (masterId: string, zoneId: string, clear: boolean) => void;
}) {
  const selected = document.zones.find((zone) => zone.id === document.selectedId) ?? document.zones[0];
  const warnings = groups.flatMap((master) => {
    const routes = document.routes[master.id] ?? {};
    const active = document.zones.filter((zone) => zone.enabled && (routes[zone.id] ?? 0) > 0);
    const total = active.reduce((sum, zone) => sum + (routes[zone.id] ?? 0), 0);
    const hasBlackoutConflict = active.some((zone) => zone.behaviour === 'blackout') && active.length > 1;
    return [
      ...(total > 1.5 ? [`${master.name}: combined field gain ${total.toFixed(1)} will be clamped.`] : []),
      ...(hasBlackoutConflict ? [`${master.name}: blackout competes with another field.`] : []),
    ];
  });
  return <div className="f2-zones">
    <div className="f2-zone-title"><div><strong>Zones</strong><span>Auto detect from anatomy, or click cells one by one. Settings save on this device.</span></div><div className="f2-zone-title-actions"><button type="button" onClick={onDetect}>Auto detect</button><button type="button" onClick={onAdd}>＋ Zone</button></div></div>
    <div className="f2-causal-chain" aria-label="Causal mapping chain">{['Input', 'Interpretation', 'Region', 'Behaviour', 'Output', 'Limit'].map((step, index) => <span key={step}>{step}{index < 5 && <i>→</i>}</span>)}</div>
    {warnings.length > 0 && <div className="f2-zone-warnings"><strong>Dependency check</strong>{warnings.map((warning) => <span key={warning}>{warning}</span>)}</div>}
    <div className="f2-zone-tabs" role="tablist">{document.zones.map((zone) => <button role="tab" aria-selected={zone.id === selected?.id} className={zone.id === selected?.id ? 'selected' : ''} key={zone.id} onClick={() => onSelect(zone.id)}><i className={zone.enabled ? 'on' : ''} />{zone.name}</button>)}</div>

    <div className="f2-zone-section"><div><strong>Master routing</strong><span>off → 50% → 100%</span></div>
      <div className="f2-zone-matrix-scroll"><table className="f2-zone-matrix">
        <thead><tr><th>Group</th>{document.zones.map((zone) => <th key={zone.id} className={zone.id === selected?.id ? 'selected' : ''}><button type="button" title={zone.name} onClick={() => onSelect(zone.id)}>{zone.name}</button></th>)}</tr></thead>
        <tbody>{groups.map((master) => <tr key={master.id}>
          <td className="f2-zone-name">{master.name}</td>
          {document.zones.map((zone) => {
            const gain = document.routes[master.id]?.[zone.id] ?? 0;
            return <td key={zone.id}><button className={gain >= 1 ? 'full' : gain > 0 ? 'half' : ''} aria-label={`${master.name} to ${zone.name}`} aria-pressed={gain > 0} onClick={(event) => onRoute(master.id, zone.id, event.shiftKey)} /></td>;
          })}
        </tr>)}</tbody>
      </table></div>
    </div>

    {selected && <ZoneBehaviourEditor selected={selected} canDelete={document.zones.length > 1} onChange={onChange} onRemove={onRemove} />}
  </div>;
}

export function ZoneBehaviourEditor({ selected, canDelete, onChange, onRemove }: {
  selected: InteractionZone;
  canDelete: boolean;
  onChange: (id: string, field: keyof InteractionZone, value: string | number | boolean) => void;
  onRemove: (id: string) => void;
}) {
  return <div className="f2-zone-editor">
    <div className="f2-zone-editor-head"><strong>Input → behaviour</strong><div><button role="switch" aria-checked={selected.enabled} onClick={() => onChange(selected.id, 'enabled', !selected.enabled)}>{selected.enabled ? 'ACTIVE' : 'OFF'}</button><button onClick={() => onRemove(selected.id)} disabled={!canDelete}>Delete</button></div></div>
    <p className="f2-zone-selected">Editing <strong>{selected.name}</strong></p>
    <label className="f2-zone-field"><span>Name</span><input value={selected.name} onChange={(event) => onChange(selected.id, 'name', event.target.value)} /></label>
    <div className="f2-zone-grid">
      <label><span>Trigger</span><select value={selected.trigger} onChange={(event) => onChange(selected.id, 'trigger', event.target.value as ElementId)}>{ELEMENTS.map((element) => <option value={element.id} key={element.id}>{element.label}</option>)}</select></label>
      <label><span>Interpretation</span><select value={selected.mode} onChange={(event) => onChange(selected.id, 'mode', event.target.value)}><option value="toggle">Toggle</option><option value="gate">Follow</option><option value="oneshot">One shot</option></select></label>
      <label><span>Anatomical behaviour</span><select value={selected.behaviour} onChange={(event) => onChange(selected.id, 'behaviour', event.target.value)}><option value="flutter">Flutter · fringe only</option><option value="lift">Lift · connected vane</option><option value="shimmer">Shimmer · luminance</option><option value="pulse">Pulse · travelling opening</option><option value="blackout">Blackout · authored transition</option></select></label>
      <label><span>Movement plane</span><select value={selected.axis ?? 'z'} onChange={(event) => onChange(selected.id, 'axis', event.target.value)}><option value="z">Z · depth in / out</option><option value="x">X · side to side</option><option value="xy">X + Y · connected wave</option></select></label>
      <ZoneSlider label="Speed" value={selected.speed} min={0.1} max={10} step={0.1} onChange={(value) => onChange(selected.id, 'speed', value)} />
      <ZoneSlider label="Attack" value={selected.attack} min={5} max={1000} step={5} suffix="ms" onChange={(value) => onChange(selected.id, 'attack', value)} />
      <ZoneSlider label="Release" value={selected.release} min={50} max={3000} step={10} suffix="ms" onChange={(value) => onChange(selected.id, 'release', value)} />
      <ZoneSlider label="Bounded amount" value={selected.amount} min={0} max={1.5} step={0.05} onChange={(value) => onChange(selected.id, 'amount', value)} />
      <ZoneSlider label="Layer depth" value={selected.layerDepth ?? 0} min={0} max={2.5} step={0.05} onChange={(value) => onChange(selected.id, 'layerDepth', value)} />
    </div>
    <p className="f2-note">Layer depth is the minimum separation while this zone is triggered. Z is the primary layer motion and crosses the rest plane in both directions. X moves laterally. Y is available only as a connected wave coupled to X.</p>
  </div>;
}

function ZoneSlider({ label, value, min, max, step, suffix = '', onChange }: {
  label: string; value: number; min: number; max: number; step: number; suffix?: string; onChange: (value: number) => void;
}) {
  return <label><span>{label}<output>{Number.isInteger(step) ? Math.round(value) : value.toFixed(2)}{suffix}</output></span><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}
