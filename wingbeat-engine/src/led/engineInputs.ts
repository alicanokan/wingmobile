import type { WingbeatEngine } from '../engine/WingbeatEngine.ts';
import { getScene } from '../engine/scenes.ts';
import type { LedInputs, SensorSnapshot } from './types.ts';

/** Both performance surfaces derive sensor lighting from the same encounter. */
export function engineLedInputs(engine: WingbeatEngine): LedInputs {
  const sensors: Record<string, SensorSnapshot> = {};
  const expression = engine.getExpressiveState();
  const nodes = engine.getNodes();
  nodes.forEach((n, index) => {
    const path = Math.max(0, 1 - Math.abs(index / Math.max(1, nodes.length - 1) - expression.spatialBreadth) * 2.2);
    sensors[n.id] = {
      wind: n.online ? Math.min(1, expression.fringeLoad * 0.35 + expression.spatialBreadth * path * 0.65) : 0,
      motion: n.online ? expression.vaneLoad * path : 0,
      present: n.online && expression.phase !== 'rest',
      hue: (((n.hue % 360) + 360) % 360) / 360,
    };
  });
  return { sensors, sceneLed: getScene(engine.scene).led };
}
