import { useState } from 'react';
import type { LayerControl, LayerControls } from './LabPanels';
import { resolveLife } from './layerLife';

const PARTS = [
  ['barbs', 'Barbs', 'The feather’s main surface'],
  ['rachis', 'Rachis', 'One continuous, bending shaft'],
  ['down', 'Little feathers', 'Soft fibres around the base'],
  ['patterns', 'Patterns', 'Markings across the barbs'],
  ['colours', 'Colours', 'The main feather palette'],
  ['extras', 'Extras', 'Additional patterns & colours'],
] as const;
type Part = typeof PARTS[number][0];
const PRESETS = [
  { name: 'Still', mode: 0, amount: 0, speed: .45 },
  { name: 'Breathe', mode: 1, amount: .3, speed: .4 },
  { name: 'Wave', mode: 6, amount: .45, speed: .5 },
  { name: 'Fly', mode: 2, amount: .65, speed: .45 },
  { name: 'Swirl', mode: 3, amount: .7, speed: .5 },
  { name: 'Pulse', mode: 5, amount: .6, speed: .6 },
];

export function SimpleControls({ controls, onChange, particleCount, onParticles, busy, volume, thickness, onVolume, onThickness, particleShape, connection, onShape, onConnection, optics, onOptics }: {
  controls: LayerControls;
  particleCount: number;
  onParticles: (count: number) => void;
  busy: boolean;
  volume: number;
  thickness: number;
  optics: { motionBlur: number; roughness: number; reflection: number; metalness: number; taper: number; centreSize: number; tipSize: number; size: number; alpha: number; radiance: number; tail: number; blendMode: number };
  onOptics: (key: 'motionBlur' | 'roughness' | 'reflection' | 'metalness' | 'taper' | 'centreSize' | 'tipSize' | 'size' | 'alpha' | 'radiance' | 'tail' | 'blendMode', value: number) => void;
  particleShape: number;
  connection: number;
  onShape: (value: number) => void;
  onConnection: (value: number) => void;
  onVolume: (value: number) => void;
  onThickness: (value: number) => void;
  onChange: (updates: Array<{ id: string; values: Record<string, number> }>) => void;
}) {
  const [part, setPart] = useState<Part>('barbs');
  const [extra, setExtra] = useState<'patterns' | 'colours'>('patterns');
  const [mask, setMask] = useState('all');
  const matches = (layer: LayerControl) => {
    if (part === 'barbs') return layer.kind === 'parts' && layer.index === 2;
    if (part === 'rachis') return layer.kind === 'parts' && layer.index === 1;
    if (part === 'down') return layer.kind === 'parts' && layer.index === 3;
    if (part === 'patterns') return layer.kind === 'patterns';
    if (part === 'colours') return layer.kind === 'colors' && layer.index < 2;
    return extra === 'patterns' ? layer.kind === 'parts' && layer.index === 4 : layer.kind === 'colors' && layer.index >= 2;
  };
  const available = controls.layers.filter(matches);
  const targets = available.filter(layer => mask === 'all' || layer.id === mask);
  const effective = targets.map(layer => resolveLife(layer, controls.groups.find(g => g.id === layer.groupId) ?? {}, layer.id));
  const life = effective[0];
  const update = (values: Record<string, number>) => onChange(targets.map(layer => {
    // Materialise inherited behaviour before changing a single simple control.
    const current = resolveLife(layer, controls.groups.find(g => g.id === layer.groupId) ?? {}, layer.id);
    const patch = { lifeMode: current.mode, lifeAmount: current.amount, lifeSpeed: current.speed, lifeGlow: current.glow, lifeHue: current.hue, ...values };
    return { id: layer.id, values: patch };
  }));
  return <div className="f2-simple">
    <section className="f2-particle-character" aria-label="Particle character">
      <h3>Living texture</h3>
      <div className="f2-simple-presets">{['Photo', 'Liquid', 'Ivy', 'Square', 'Hexagon', 'Crystal', 'Sphere', 'Pearl', 'Bubble', 'Living ivy', 'Gaussian'].map((name, index) => <button key={name} aria-pressed={particleShape === index} onClick={() => onShape(index)}>{name}</button>)}</div>
      {particleShape > 0 && <label className="f2-simple-slider"><span>Connection<output>{Math.round(connection * 100)}%</output></span><input aria-label="Organic particle connection" type="range" min="0" max="1" step=".01" value={connection} onChange={e => onConnection(Number(e.target.value))} /></label>}
      <div className="f2-simple-switch"><button aria-pressed={optics.tail === 0} onClick={() => onOptics('tail', 0)}>No tail</button><button aria-pressed={optics.tail > 0} onClick={() => onOptics('tail', 1)}>With tail</button></div>
      <div className="f2-simple-presets" aria-label="Particle blending">{['Transparent', 'Light', 'Dichroic'].map((name, index) => <button key={name} aria-pressed={optics.blendMode === index} onClick={() => onOptics('blendMode', index)}>{name}</button>)}</div>
      <div className="f2-simple-switch"><button aria-pressed={optics.taper > .5} onClick={() => onOptics('taper', 1)}>Taper to tips</button><button aria-pressed={optics.taper <= .5} onClick={() => onOptics('taper', 0)}>Uniform size</button></div>
      {optics.taper > .5 && <>{([['centreSize', 'Centre size'], ['tipSize', 'Barb tip size']] as const).map(([key, label]) => <label className="f2-simple-slider" key={key}><span>{label}<output>{optics[key].toFixed(2)}</output></span><input aria-label={label} type="range" min=".01" max="3" step=".01" value={optics[key]} onChange={e => onOptics(key, Number(e.target.value))} /></label>)}<p className="f2-note">A smooth taper follows each barb from shaft to edge, even in flight. Layer size controls multiply this profile.</p></>}
      {([['size', 'Particle size' , .1, 3], ['alpha', 'Opacity', 0, 1], ['radiance', 'Shine', 0, 8]] as const).filter(([key]) => key !== 'size' || optics.taper <= .5).map(([key, label, min, max]) => <label className="f2-simple-slider" key={key}><span>{label}<output>{optics[key].toFixed(2)}</output></span><input aria-label={label} type="range" min={min} max={max} step=".01" value={optics[key]} onChange={e => onOptics(key, Number(e.target.value))} /></label>)}
      <details className="f2-depth-controls"><summary>Material & motion blur</summary>
      <div className="f2-simple-presets">{[['Silk', .7, .2, 0], ['Glass', .12, .75, 0], ['Metal', .24, .8, 1]].map(([name, roughness, reflection, metalness]) => <button key={name} onClick={() => { onOptics('roughness', Number(roughness)); onOptics('reflection', Number(reflection)); onOptics('metalness', Number(metalness)); }}>{name}</button>)}</div>
      {([['roughness', 'Roughness'], ['reflection', 'Studio reflection'], ['metalness', 'Metallic tint'], ['motionBlur', 'Motion blur']] as const).map(([key, label]) => <label className="f2-simple-slider" key={key}><span>{label}<output>{Math.round(optics[key] * 100)}%</output></span><input aria-label={label} type="range" min="0" max="1" step=".01" value={optics[key]} onChange={e => onOptics(key, Number(e.target.value))} /></label>)}
      <p className="f2-note">Softer reflections for silk; sharper highlights for glass. Motion blur blends recent frames. Gaussian uses soft, elongated grains.</p>
      </details>
      <p className="f2-note">Shine brightens small particles without increasing opacity. Dichroic adds shifting colours where translucent particles overlap.</p>
      <p className="f2-note">{particleShape === 0 ? 'Original photographic patches.' : particleShape === 1 ? 'Soft droplets stretch and overlap along the fibres.' : particleShape === 2 ? 'Tiny branching stems and buds follow the barbs.' : particleShape === 6 ? 'Round grains with soft directional shading.' : particleShape === 7 ? 'Lustrous spheres with a delicate colour sheen.' : particleShape === 8 ? 'Transparent centres with bright, watery rims.' : particleShape === 9 ? 'Rounded buds merge, detach and return. Raise Connection to keep the branches joined.' : particleShape === 10 ? 'Soft Gaussian grains overlap along the barbs.' : 'Geometric grains follow the feather’s fibres.'}</p>
    </section>
    <details className="f2-depth-controls">
      <summary>Detail & 3D depth</summary>
      <div className="f2-simple-presets" aria-label="Particle detail">{[[140000, 'Fine'], [300000, 'Finer'], [500000, 'Ultra']] .map(([count, label]) => <button key={count} disabled={busy} aria-pressed={particleCount === count} onClick={() => onParticles(Number(count))}>{label}</button>)}</div>
      <p className="f2-note" role="status">{busy ? 'Building finer detail…' : `Up to ${Math.round(particleCount / 1000)}k particles · whole feather`}</p>
      <label className="f2-simple-slider"><span>3D depth<output>{volume.toFixed(2)}</output></span><input aria-label="Whole feather 3D depth" type="range" min="0" max="2.5" step=".01" value={volume} onChange={e => onVolume(Number(e.target.value))} /></label>
      <label className="f2-simple-slider"><span>Fibre thickness<output>{thickness.toFixed(2)}</output></span><input aria-label="Fibre depth thickness" type="range" min="0" max="3" step=".01" value={thickness} onChange={e => onThickness(Number(e.target.value))} /></label>
      <p className="f2-note">Turn the feather slightly to see its depth. Ultra takes longer to prepare.</p>
    </details>
    <p className="f2-simple-intro">Choose a part. Give it a movement.</p>
    <div className="f2-part-buttons" aria-label="Feather parts">{PARTS.map(([id, name], index) => <button key={id} aria-pressed={part === id} onClick={() => { setPart(id); setMask('all'); }}><small>0{index + 1}</small>{name}</button>)}</div>
    <div className="f2-simple-heading"><h3>{PARTS.find(p => p[0] === part)?.[1]}</h3><p>{PARTS.find(p => p[0] === part)?.[2]}</p></div>
    {part === 'extras' && <div className="f2-simple-switch">{(['patterns', 'colours'] as const).map(id => <button key={id} aria-pressed={extra === id} onClick={() => { setExtra(id); setMask('all'); }}>{id === 'patterns' ? 'Additional patterns' : 'Accent colours'}</button>)}</div>}
    {available.length > 1 && <label className="f2-simple-select">Apply to<select value={mask} onChange={e => setMask(e.target.value)}><option value="all">All {part === 'extras' ? extra : part}</option>{available.map(layer => <option value={layer.id} key={layer.id}>{layer.name}</option>)}</select></label>}
    {!life ? <p className="f2-note">No matching detail in this feather. Choose another part or refine its masks in Advanced.</p> : <>
      <div className="f2-simple-presets" aria-label="Movement presets">{PRESETS.filter(p => part !== 'rachis' || [0, 6].includes(p.mode)).map(preset => <button key={preset.name} aria-pressed={effective.every(e => e.mode === preset.mode)} onClick={() => update({ lifeMode: preset.mode, lifeAmount: preset.amount, lifeSpeed: preset.speed })}>{preset.name}</button>)}</div>
      {part === 'rachis' && <p className="f2-note">Wave bends the rachis and calamus together. Their centre stays connected.</p>}
      {([
        ['lifeAmount', 'Strength', 'amount', 2], ['lifeSpeed', 'Speed', 'speed', 3],
        ['lifeGlow', 'Glow', 'glow', 2], ['lifeHue', 'Colour play', 'hue', 1],
      ] as const).map(([field, label, key, max]) => <label className="f2-simple-slider" key={field}><span>{label}<output>{effective.some(e => e[key] !== life[key]) ? 'Mixed' : `${Math.round(life[key] / max * 100)}%`}</output></span><input aria-label={`${label} for ${part}`} type="range" min="0" max={max} step=".01" value={life[key]} onChange={e => update({ [field]: Number(e.target.value) })} /></label>)}
      {part !== 'rachis' && <label className="f2-simple-slider"><span>Layer distance<output>{targets.some(t => t.depth !== targets[0].depth) ? 'Mixed' : targets[0].depth.toFixed(2)}</output></span><input aria-label={`Layer distance for ${part}`} type="range" min="0" max="4" step=".01" value={targets[0].depth} onChange={e => update({ depth: Number(e.target.value) })} /></label>}
      <p className="f2-note">Movement runs without audio. Your changes save automatically.</p>
    </>}
  </div>;
}
