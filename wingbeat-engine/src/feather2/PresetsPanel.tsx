import { useState } from 'react';
import type { FeatherPreset } from './presets.ts';

/** Name + save, and the list of saved looks to recall or delete. */
export function PresetsPanel({ presets, activeId, currentLabel, onSave, onLoad, onDelete }: {
  presets: FeatherPreset[];
  activeId: string | null;
  currentLabel: string;
  onSave: (name: string) => void;
  onLoad: (preset: FeatherPreset) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed);
    setName('');
  };
  return <section className="f2-presets" aria-label="Feather presets">
    <div className="f2-section-heading"><h2>Presets</h2><span>{String(presets.length).padStart(2, '0')}</span></div>
    <p className="f2-note">A preset keeps this feather with its masks, movement, appearance and camera angle. Recall it here or on the experience page.</p>
    <form className="f2-presets-save" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <input aria-label="Preset name" placeholder={`Name this look of ${currentLabel}`} value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
      <button type="submit" className="f2-btn" disabled={!name.trim()}>Save preset</button>
    </form>
    {presets.length > 0 && <div className="f2-presets-list">
      {presets.map((preset) => <div key={preset.id} className={`f2-presets-item ${preset.id === activeId ? 'active' : ''}`}>
        <button type="button" className="f2-presets-load" onClick={() => onLoad(preset)} title={`recall ${preset.name}`}>
          <strong>{preset.name}</strong>
          <small>{preset.label}{preset.scene.view ? ' · with camera' : ''}</small>
        </button>
        <button type="button" className="f2-presets-delete" aria-label={`delete ${preset.name}`} onClick={() => onDelete(preset.id)}>✕</button>
      </div>)}
    </div>}
  </section>;
}
