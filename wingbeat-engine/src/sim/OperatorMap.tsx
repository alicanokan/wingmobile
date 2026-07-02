// ============================================================================
//  Operator map — top-down view of the installation room.
//
//  Reproduces the layout diagram: projection screen, 4 corner speakers (which
//  glow with their live per-speaker gain), the central INTERACTION zone, the
//  8 ring wind-sensors, and the feather prop. Every element is driven by the
//  one engine — in sim mode you can press-and-hold a sensor to "blow" on it;
//  in hardware mode the same diamonds light up from real ESP8266 sensors.
// ============================================================================

import { useEffect, useRef } from 'react';
import { LAYOUT, VIEWBOX } from '../engine/spatial.ts';
import { SENSOR_CHANNELS } from './channels.ts';
import type { NodeState } from '../engine/types.ts';
import type { SimTransport } from '../transports/SimTransport.ts';
import type { EngineSnapshot } from './useEngine.ts';

const W = VIEWBOX.w;
const H = VIEWBOX.h;
const CHANNEL_BY_ID = new Map(SENSOR_CHANNELS.map((c) => [c.sensor, c]));

function ledColor(n: NodeState | undefined, fallbackHue = 210): string {
  if (!n) return `hsl(${fallbackHue} 30% 30%)`;
  const k = 0.35 + 0.65 * Math.max(n.wind, n.present ? 0.5 : 0);
  const { r, g, b } = n.led;
  return `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
}

interface Props {
  snapshot: EngineSnapshot;
  sim: SimTransport | null; // null = read-only (hardware mode)
}

export function OperatorMap({ snapshot, sim }: Props) {
  const byId = new Map(snapshot.nodes.map((n) => [n.id, n]));
  // per-sensor hold ramps (sim interaction)
  const holds = useRef(new Map<string, ReturnType<typeof setInterval>>());

  useEffect(() => {
    const map = holds.current;
    return () => {
      for (const t of map.values()) clearInterval(t);
      map.clear();
    };
  }, []);

  const startBlow = (id: string) => {
    if (!sim) return;
    sim.setPresence(id, true);
    let v = 0.2;
    const t = setInterval(() => {
      v = Math.min(1, v + 0.08);
      sim.holdWind(id, v);
    }, 50);
    holds.current.get(id) && clearInterval(holds.current.get(id)!);
    holds.current.set(id, t);
  };
  const stopBlow = (id: string) => {
    if (!sim) return;
    const t = holds.current.get(id);
    if (t) clearInterval(t);
    holds.current.delete(id);
    sim.releaseWind(id);
    setTimeout(() => sim?.setPresence(id, false), 400);
  };

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none' }}
    >
      {/* room */}
      <rect x={8} y={8} width={W - 16} height={H - 16} rx={14} fill="#0c0c10" stroke="#1d1d27" />

      {/* projection screen — horizontal, across the top (perspective trapezoid) */}
      <g>
        <polygon
          points={`${(LAYOUT.screen.pos.x - (LAYOUT.screen.w / 2) * 0.86) * W},${(LAYOUT.screen.pos.y - LAYOUT.screen.h / 2) * H}
                   ${(LAYOUT.screen.pos.x + (LAYOUT.screen.w / 2) * 0.86) * W},${(LAYOUT.screen.pos.y - LAYOUT.screen.h / 2) * H}
                   ${(LAYOUT.screen.pos.x + LAYOUT.screen.w / 2) * W},${(LAYOUT.screen.pos.y + LAYOUT.screen.h / 2) * H}
                   ${(LAYOUT.screen.pos.x - LAYOUT.screen.w / 2) * W},${(LAYOUT.screen.pos.y + LAYOUT.screen.h / 2) * H}`}
          fill="#f5a623"
          opacity={0.18 + snapshot.maxWind * 0.5}
          stroke="#f5a623"
          strokeOpacity={0.6}
        />
        <text
          x={LAYOUT.screen.pos.x * W}
          y={LAYOUT.screen.pos.y * H + 5}
          fill="#f5a623"
          fontSize={20}
          textAnchor="middle"
          opacity={0.85}
          letterSpacing={6}
        >
          SCREEN
        </text>
      </g>

      {/* speakers */}
      {LAYOUT.speakers.map((s, i) => {
        const gain = snapshot.perSpeakerGain[i] ?? 0;
        const lit = gain * snapshot.maxWind;
        return (
          <g key={s.id}>
            <circle
              cx={s.pos.x * W}
              cy={s.pos.y * H}
              r={34 + lit * 40}
              fill="#6ee7ff"
              opacity={lit * 0.25}
            />
            <rect
              x={s.pos.x * W - 26}
              y={s.pos.y * H - 26}
              width={52}
              height={52}
              rx={8}
              fill="#2a2a32"
              stroke="#6ee7ff"
              strokeOpacity={0.3 + lit}
            />
            <text x={s.pos.x * W} y={s.pos.y * H + 4} fill="#9aa" fontSize={11} textAnchor="middle">
              {s.id.replace('spk_', '')}
            </text>
          </g>
        );
      })}

      {/* interaction zone */}
      <circle
        cx={LAYOUT.center.x * W}
        cy={LAYOUT.center.y * H}
        r={LAYOUT.interactionRadius * W}
        fill="#7c3aed"
        opacity={0.5 + snapshot.maxWind * 0.4}
      />
      <text
        x={LAYOUT.center.x * W}
        y={LAYOUT.center.y * H + 5}
        fill="#fff"
        fontSize={18}
        textAnchor="middle"
        letterSpacing={2}
        opacity={0.9}
      >
        INTERACTION
      </text>

      {/* sensors + feather */}
      {LAYOUT.nodes.map((spec) => {
        const n = byId.get(spec.id);
        const wind = n?.wind ?? 0;
        const present = n?.present ?? false;
        const online = n?.online ?? false;
        const cx = spec.pos.x * W;
        const cy = spec.pos.y * H;
        const size = 26 + wind * 22;
        const isFeather = spec.role === 'feather';
        // legend: which part / color group this sensor drives
        const ch = CHANNEL_BY_ID.get(spec.id);
        const dx = spec.pos.x - LAYOUT.center.x;
        const dy = spec.pos.y - LAYOUT.center.y;
        const dl = Math.hypot(dx, dy) || 1;
        const off = size / 2 + 26;
        const lx = cx + (dx / dl) * off;
        const ly = cy + (dy / dl) * off;
        const palette = snapshot.featherPalette ?? [];
        const pal = ch?.kind === 'color' && ch.colorSlot != null ? palette[ch.colorSlot] : null;
        const swatch = pal ? `rgb(${Math.round(pal[0] * 255)},${Math.round(pal[1] * 255)},${Math.round(pal[2] * 255)})` : null;
        return (
          <g
            key={spec.id}
            style={{ cursor: sim ? 'pointer' : 'default' }}
            onPointerDown={(e) => {
              (e.target as Element).setPointerCapture?.(e.pointerId);
              startBlow(spec.id);
            }}
            onPointerUp={() => stopBlow(spec.id)}
            onPointerLeave={() => stopBlow(spec.id)}
          >
            {/* presence halo */}
            {present && (
              <circle cx={cx} cy={cy} r={size + 16} fill={ledColor(n)} opacity={0.18} />
            )}
            {/* diamond */}
            <rect
              x={cx - size / 2}
              y={cy - size / 2}
              width={size}
              height={size}
              transform={`rotate(45 ${cx} ${cy})`}
              fill={online ? ledColor(n, spec.role === 'feather' ? 30 : 150) : '#23232b'}
              stroke={isFeather ? '#fff' : '#000'}
              strokeOpacity={isFeather ? 0.5 : 0.2}
              rx={4}
            />
            <text x={cx} y={cy + 3} fill="#0a0a0a" fontSize={9} textAnchor="middle" fontWeight={700}>
              {isFeather ? '✦' : spec.id.replace('sensor_', '')}
            </text>

            {/* legend: the feather part / color group this sensor drives */}
            {ch && (
              <g pointerEvents="none">
                {swatch && (
                  <rect x={lx - 14} y={ly - 13} width={9} height={9} rx={2} fill={swatch} stroke="#000" strokeOpacity={0.4} />
                )}
                <text
                  x={swatch ? lx - 1 : lx}
                  y={ly - 5}
                  fill="#9a9aa8"
                  fontSize={11}
                  textAnchor="middle"
                  letterSpacing={1}
                >
                  {ch.label}
                </text>
                {/* keyboard shortcut badge */}
                <text x={lx} y={ly + 9} fill="#5b5b6a" fontSize={9} textAnchor="middle" letterSpacing={1}>
                  [{ch.key.toUpperCase()}]
                </text>
              </g>
            )}
          </g>
        );
      })}

      {/* hint */}
      {sim && (
        <text x={W / 2} y={H - 18} fill="#555" fontSize={12} textAnchor="middle">
          hold F (or the feather) to reveal its form · keys Q W E R T blow on the sensors
        </text>
      )}
    </svg>
  );
}
