import { useEffect, useRef, useState } from 'react';
import type { WingbeatEngine } from '../engine/WingbeatEngine.ts';
import type { NodeState } from '../engine/types.ts';

export interface EngineSnapshot {
  nodes: NodeState[];
  scene: string;
  maxWind: number;
  perSpeakerGain: number[];
  feather: string;
  featherPalette: number[][];
  featherLayerCounts: number[];
}

/**
 * Polls the engine at ~30fps into React state. With ~9 nodes this is cheap and
 * keeps the operator map's reactive SVG perfectly in sync without wiring every
 * bus event into React's render cycle.
 */
export function useEngineSnapshot(engine: WingbeatEngine, fps = 30): EngineSnapshot {
  const [snap, setSnap] = useState<EngineSnapshot>({
    nodes: engine.getNodes(),
    scene: engine.scene,
    maxWind: 0,
    perSpeakerGain: [0.25, 0.25, 0.25, 0.25],
    feather: engine.feather,
    featherPalette: engine.featherPalette,
    featherLayerCounts: engine.featherLayerCounts,
  });

  // latest wind aggregate, captured off the bus
  const windRef = useRef({ maxWind: 0, perSpeakerGain: [0.25, 0.25, 0.25, 0.25] });

  useEffect(() => {
    const off = engine.on('wind', (e) => {
      windRef.current = { maxWind: e.maxWind, perSpeakerGain: e.perSpeakerGain };
    });
    return off;
  }, [engine]);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const interval = 1000 / fps;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < interval) return;
      last = t;
      setSnap({
        nodes: engine.getNodes(),
        scene: engine.scene,
        maxWind: windRef.current.maxWind,
        perSpeakerGain: windRef.current.perSpeakerGain,
        feather: engine.feather,
        featherPalette: engine.featherPalette,
    featherLayerCounts: engine.featherLayerCounts,
      });
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [engine, fps]);

  return snap;
}
