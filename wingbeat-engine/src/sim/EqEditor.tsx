// ============================================================================
//  EqEditor — a visual EQ for one sensor's loop sample.
//
//  Shows the loop's live spectrum (input), lets you drag out a frequency range
//  on top of it (the filter), and reads out the resulting level in real time
//  (the filtered result) — the exact number that drives that sensor's layer
//  reactivity (AudioEngine.getLoopBandRange / Projection's uAudioCh).
//
//  The spectrum keeps animating as long as the loop is loaded (it's analysed
//  from the player's raw output, independent of whether its trigger volume is
//  up), but obviously only shows real content while a Test is actually
//  playing the sample.
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import type { AudioEngine } from '../engine/AudioEngine.ts';
import type { AudioBand } from './rig.ts';

const FMIN = 20; // Hz — bottom of the visible axis (log scale can't show 0)
const CANVAS_W = 300;
const CANVAS_H = 64;

interface Props {
  audio: AudioEngine;
  sensorId: string;
  band: AudioBand;
  range?: [number, number];
  sensitivity?: number; // input gain applied to the meter — matches Projection's audioCh
  onChange: (band: AudioBand, range: [number, number]) => void;
}

const fmtHz = (hz: number) => (hz >= 1000 ? `${(hz / 1000).toFixed(1)}kHz` : `${Math.round(hz)}Hz`);

export function EqEditor({ audio, sensorId, band, range, sensitivity, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const meterFillRef = useRef<HTMLDivElement | null>(null);
  const meterValRef = useRef<HTMLSpanElement | null>(null);
  const rafRef = useRef(0);
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null); // live drag, fractions 0..1

  const nyquist = audio.nyquist || 22050;
  const hzToFrac = (hz: number) => Math.log(Math.max(FMIN, hz) / FMIN) / Math.log(nyquist / FMIN);
  const fracToHz = (f: number) => FMIN * Math.pow(nyquist / FMIN, Math.min(1, Math.max(0, f)));

  const committed: [number, number] = range ?? [FMIN, nyquist];
  const liveMin = drag ? fracToHz(Math.min(drag.a, drag.b)) : committed[0];
  const liveMax = drag ? fracToHz(Math.max(drag.a, drag.b)) : committed[1];

  // Draw loop: spectrum bars + selection overlay, plus the live filtered-result meter.
  useEffect(() => {
    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.fillStyle = '#0a0a10';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      const spectrum = audio.getLoopSpectrum(sensorId);
      if (!spectrum) {
        ctx.fillStyle = '#4a4a5a';
        ctx.font = '10px ui-sans-serif, system-ui';
        ctx.fillText('no signal — hit Test to hear + see it', 8, CANVAS_H / 2 + 3);
      } else {
        const n = spectrum.length;
        ctx.fillStyle = '#e8c56a';
        for (let k = 1; k < n; k++) {
          const hz = (k / n) * nyquist;
          if (hz < FMIN) continue;
          const x = hzToFrac(hz) * CANVAS_W;
          const db = spectrum[k];
          const h = Math.max(0, Math.min(1, (db + 100) / 100)) * CANVAS_H;
          ctx.globalAlpha = 0.85;
          ctx.fillRect(x, CANVAS_H - h, 2, h);
        }
        ctx.globalAlpha = 1;
      }

      // selection overlay
      const x0 = hzToFrac(liveMin) * CANVAS_W;
      const x1 = hzToFrac(liveMax) * CANVAS_W;
      ctx.fillStyle = 'rgba(232, 197, 106, 0.16)';
      ctx.fillRect(x0, 0, x1 - x0, CANVAS_H);
      ctx.strokeStyle = '#e8c56a';
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 0.5, 0.5, Math.max(1, x1 - x0 - 1), CANVAS_H - 1);

      // live filtered-result meter (imperative — avoid a React re-render every frame).
      // Scale by sensitivity so this reads the exact value Projection feeds the layer.
      const lvl = Math.min(1, audio.getLoopBandRange(sensorId, liveMin, liveMax) * (sensitivity ?? 1));
      if (meterFillRef.current) meterFillRef.current.style.width = `${Math.round(lvl * 100)}%`;
      if (meterValRef.current) meterValRef.current.textContent = lvl.toFixed(2);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio, sensorId, liveMin, liveMax, nyquist, sensitivity]);

  const fracAt = (clientX: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const f = fracAt(e.clientX);
    setDrag({ a: f, b: f });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    setDrag((d) => (d ? { a: d.a, b: fracAt(e.clientX) } : d));
  };
  const onPointerUp = () => {
    if (!drag) return;
    const min = fracToHz(Math.min(drag.a, drag.b));
    const max = fracToHz(Math.max(drag.a, drag.b));
    setDrag(null);
    if (max - min > 5) onChange('custom', [Math.round(min), Math.round(max)]);
  };

  const preset = (b: 'full' | 'low' | 'mid' | 'high') => {
    const lo = b === 'full' ? FMIN : b === 'low' ? FMIN : b === 'mid' ? nyquist / 3 : (2 * nyquist) / 3;
    const hi = b === 'full' ? nyquist : b === 'low' ? nyquist / 3 : b === 'mid' ? (2 * nyquist) / 3 : nyquist;
    onChange(b, [Math.round(lo), Math.round(hi)]);
  };

  return (
    <div className="cond-eq">
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        className="cond-eq-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div className="cond-eq-range">
        <span>{fmtHz(liveMin)}</span>
        <span>drag to set a custom range · input → EQ → filtered result</span>
        <span>{fmtHz(liveMax)}</span>
      </div>
      <div className="cond-eq-row">
        <div className="cond-eq-presets">
          {(['full', 'low', 'mid', 'high'] as const).map((b) => (
            <button key={b} className={`cond-layer ${band === b ? 'on' : ''}`} onClick={() => preset(b)}>
              {b === 'full' ? 'Full' : b === 'low' ? 'Bass' : b === 'mid' ? 'Mid' : 'Treble'}
            </button>
          ))}
          <span className={`cond-layer ${band === 'custom' ? 'on' : ''}`} style={{ cursor: 'default' }}>
            Custom
          </span>
        </div>
        <div className="cond-eq-meter">
          <span className="cond-eq-meter-label">filtered</span>
          <div className="wb-level" style={{ maxWidth: 90 }}>
            <div ref={meterFillRef} className="wb-level-fill" style={{ width: '0%', background: 'linear-gradient(90deg,#7c3aed,#c4a8ff)' }} />
          </div>
          <span ref={meterValRef} className="cond-eq-meter-val">0.00</span>
        </div>
      </div>
    </div>
  );
}
