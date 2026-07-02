// ============================================================================
//  Knob — a tactile rotary control (Teenage-Engineering style).
//
//  270° sweep with an arc value track and a pointer notch. Drag vertically to
//  turn (up = more); double-click resets to `reset` (or the midpoint). The whole
//  thing is one SVG so it stays crisp at any size and rotates smoothly.
// ============================================================================

import { useRef } from 'react';

interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  /** Formats the numeric readout (defaults to the raw value). */
  format?: (v: number) => string;
  /** Value applied on double-click (defaults to the midpoint). */
  reset?: number;
  size?: number;
  /** Arc + pointer colour. */
  color?: string;
}

const SWEEP = 270; // degrees of travel
const START = -135; // 7:30 position

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
}
function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

export function Knob({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  format,
  reset,
  size = 46,
  color = '#7c3aed',
}: Props) {
  const drag = useRef<{ y: number; v: number } | null>(null);

  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const quantize = (v: number) => {
    const q = Math.round(v / step) * step;
    // kill float dust like 0.7000000000001
    return parseFloat(q.toFixed(6));
  };

  const t = (clamp(value) - min) / (max - min || 1);
  const angle = START + t * SWEEP;

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 3;
  const knobR = r - 6;

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { y: e.clientY, v: clamp(value) };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    // full range over ~180px of travel; Shift = fine (×0.25).
    const span = e.shiftKey ? 720 : 180;
    const dv = ((drag.current.y - e.clientY) / span) * (max - min);
    onChange(quantize(clamp(drag.current.v + dv)));
  };
  const end = (e: React.PointerEvent) => {
    drag.current = null;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  };

  const [px0, py0] = polar(cx, cy, knobR - 2, angle);
  const [px1, py1] = polar(cx, cy, knobR - 9, angle);
  const readout = format ? format(value) : `${value}`;

  return (
    <div className="wb-knob" title={`${label}: ${readout}`}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="wb-knob-dial"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        onDoubleClick={() => onChange(quantize(clamp(reset ?? (min + max) / 2)))}
      >
        <path d={arcPath(cx, cy, r, START, START + SWEEP)} className="wb-knob-track" />
        <path d={arcPath(cx, cy, r, START, angle)} className="wb-knob-arc" style={{ stroke: color }} />
        <circle cx={cx} cy={cy} r={knobR} className="wb-knob-cap" />
        <line x1={px0} y1={py0} x2={px1} y2={py1} className="wb-knob-ptr" style={{ stroke: color }} />
      </svg>
      <div className="wb-knob-label">{label}</div>
      <div className="wb-knob-val">{readout}</div>
    </div>
  );
}
