// ============================================================================
//  Keyboard pulse panel.
//
//  Shapes the "Key" input source: a press fires a pulse at AMOUNT, then decays
//  over RELEASE seconds (instead of a hard on/off). The meter shows the live
//  enveloped pulse so you can see your playing. Which sensor each key fires is
//  set in the Inputs routing matrix (with remappable key caps).
// ============================================================================

import { Knob } from './Knob.tsx';

interface Props {
  amount: number;
  release: number;
  level: number; // live 0..1 pulse for the meter
  onAmount: (v: number) => void;
  onRelease: (v: number) => void;
  onClose: () => void;
}

export function KeyboardPanel({ amount, release, level, onAmount, onRelease, onClose }: Props) {
  return (
    <div className="wb-motion">
      <div className="wb-settings-head">
        <span>Keyboard · Pulse</span>
        <button className="wb-btn" style={{ padding: '2px 8px' }} onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="wb-settings-note">
        A key press fires a pulse at <b>Amount</b>, then decays over <b>Release</b>. Assign which key fires which sensor in the Inputs matrix.
      </div>

      {/* live pulse meter */}
      <div className="wb-level">
        <div className="wb-level-fill" style={{ width: `${Math.round(level * 100)}%`, background: 'linear-gradient(90deg, #e8e8e8, #ffffff)' }} />
        <span className="wb-level-val">{level.toFixed(2)}</span>
      </div>

      <div className="wb-settings-section">Pulse</div>
      <div className="wb-knob-row" style={{ justifyContent: 'flex-start', gap: 18 }}>
        <Knob label="Amount" value={amount} min={0} max={1} step={0.01} reset={1} onChange={onAmount} format={(v) => v.toFixed(2)} />
        <Knob label="Release" value={release} min={0} max={3} step={0.05} reset={0.25} onChange={onRelease} format={(v) => `${v.toFixed(2)}s`} />
      </div>
    </div>
  );
}
