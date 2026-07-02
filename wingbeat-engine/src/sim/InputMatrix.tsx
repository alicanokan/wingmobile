// ============================================================================
//  Input routing matrix — the 3-stage patch UI.
//
//    Stage 1  Source → Sensor : pick which device fires each trigger slot.
//    Stage 2  Sensor → Part   : pick which feather part(s) each slot drives
//                               (multi-select — one slot can move many zones).
// ============================================================================

import { useEffect, useState } from 'react';
import { INPUT_SOURCES, SLOTS, PARTS, type SourceKind, type SourceMap, type PartMap, type KeyMap } from './inputs.ts';

interface Props {
  sources: SourceMap;
  parts: PartMap;
  keys: KeyMap;
  onSource: (slot: string, source: SourceKind) => void;
  onTogglePart: (slot: string, part: string) => void;
  onKey: (slot: string, letter: string) => void;
  /** 0..1 live levels per source, for the meters. */
  levels: Partial<Record<SourceKind, number>>;
  /** Whether each device is currently running. */
  active: Partial<Record<SourceKind, boolean>>;
  hardware: boolean;
  onClose: () => void;
}

/** Click-to-rebind key cap: shows the slot's letter; click, then press a key. */
function KeyCap({ letter, onBind }: { letter: string; onBind: (k: string) => void }) {
  const [listening, setListening] = useState(false);
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        setListening(false);
        return;
      }
      // single printable character only
      if (k.length === 1 && k !== ' ') {
        onBind(k);
        setListening(false);
      }
    };
    // capture phase so the global trigger handler doesn't also fire
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [listening, onBind]);

  return (
    <button
      className={`wb-keycap ${listening ? 'listening' : ''}`}
      title="Click, then press a key to rebind"
      onClick={() => setListening((v) => !v)}
    >
      {listening ? '…' : letter.toUpperCase()}
    </button>
  );
}

export function InputMatrix({ sources, parts, keys, onSource, onTogglePart, onKey, levels, active, hardware, onClose }: Props) {
  return (
    <div className="wb-matrix-panel">
      <div className="wb-settings-head">
        <span>Inputs · Routing Matrix</span>
        <button className="wb-btn" style={{ padding: '2px 8px' }} onClick={onClose}>
          ✕
        </button>
      </div>

      {/* live source level strip — mic, camera, and any connected device */}
      <div className="wb-src-strip">
        {INPUT_SOURCES.filter((s) => s.key === 'mic' || s.key === 'camera' || (/^dev\d+$/.test(s.key) && !!active[s.key])).map((s) => {
          const on = !!active[s.key];
          const lvl = levels[s.key] ?? 0;
          return (
            <div key={s.key} className={`wb-src ${on ? 'on' : ''}`} title={s.hint}>
              <span className="wb-src-dot" />
              <span className="wb-src-name">{s.label}</span>
              <div className="wb-src-meter">
                <div className="wb-src-fill" style={{ height: `${Math.round(lvl * 100)}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Stage 1 — source → sensor slot (single select) */}
      <div className="wb-settings-section">Source → Sensor</div>
      <table className="wb-route">
        <thead>
          <tr>
            <th />
            {INPUT_SOURCES.map((s) => (
              <th key={s.key} title={s.hint}>
                {s.label}
                {s.hardware && !hardware ? <span className="wb-route-hw">hw</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SLOTS.map((slot) => (
            <tr key={slot.id}>
              <td className="wb-route-name">
                {slot.name}
                <KeyCap letter={keys[slot.id] ?? slot.key} onBind={(k) => onKey(slot.id, k)} />
              </td>
              {INPUT_SOURCES.map((s) => {
                const sel = sources[slot.id] === s.key;
                return (
                  <td key={s.key}>
                    <button
                      className={`wb-route-cell ${sel ? 'sel' : ''} ${s.key}`}
                      aria-label={`${slot.name} ← ${s.label}`}
                      onClick={() => onSource(slot.id, s.key)}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Stage 2 — sensor slot → feather part(s) (multi select) */}
      <div className="wb-settings-section">Sensor → Feather part</div>
      <table className="wb-route">
        <thead>
          <tr>
            <th />
            {PARTS.map((p) => (
              <th key={p.id}>{p.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SLOTS.map((slot) => {
            const linked = parts[slot.id] ?? [];
            return (
              <tr key={slot.id}>
                <td className="wb-route-name">
                  {slot.name}
                  <span className="wb-key"> [{(keys[slot.id] ?? slot.key).toUpperCase()}]</span>
                </td>
                {PARTS.map((p) => {
                  const on = linked.includes(p.id);
                  return (
                    <td key={p.id}>
                      <button
                        className={`wb-route-cell square ${on ? 'sel part' : ''}`}
                        aria-label={`${slot.name} → ${p.label}`}
                        onClick={() => onTogglePart(slot.id, p.id)}
                      >
                        {on ? '✓' : ''}
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>

      {!hardware && (
        <div className="wb-route-foot">ESP routing applies when the Hardware transport is connected.</div>
      )}
    </div>
  );
}
