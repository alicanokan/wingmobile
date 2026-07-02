// ============================================================================
//  Wing Beat — Simulation transport
//
//  Feeds the engine without any hardware. Three input modes, freely mixable:
//
//    • manual    — the operator map calls blow()/shake()/setPresence() when
//                  you click/drag a sensor in the room
//    • mic       — your laptop mic drives the wind value of a chosen sensor
//                  (the "breathe at the screen" demo)
//    • auto-demo — synthetic gusts/presence on every ring sensor, so the piece
//                  comes alive on its own for video/testing
//
//  Outbound LED commands need no hardware here: the on-screen feathers read
//  the engine's node state directly, so this transport's outbound side is a
//  no-op (we just let the bus events flow to the UI/audio consumers).
// ============================================================================

import { BaseTransport } from './Transport.ts';
import { LAYOUT } from '../engine/spatial.ts';
import type { WingbeatEngine } from '../engine/WingbeatEngine.ts';

export class SimTransport extends BaseTransport {
  readonly kind = 'sim' as const;
  readonly target = 'synthetic';

  private autoTimer: ReturnType<typeof setInterval> | null = null;
  private staleTimer: ReturnType<typeof setInterval> | null = null;
  private autoDemo: boolean;

  // Continuous wind values (e.g. from mic / held mouse) that we re-emit at a
  // steady rate so the wind layer stays alive, mirroring a real sensor's 20 Hz.
  private held = new Map<string, number>();
  private heldTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: { autoDemo?: boolean } = {}) {
    super();
    this.autoDemo = opts.autoDemo ?? false;
  }

  connect(engine: WingbeatEngine): void {
    this.engine = engine;
    this.setStatus('connected');

    // Bring every sensor + the feather online so the room is fully populated.
    for (const node of LAYOUT.nodes) {
      engine.ingestStatus(node.id, { online: true, role: node.role, fw: 'sim', rssi: -40 });
    }

    // Re-emit held wind values at ~20 Hz (matches firmware WIND_PUBLISH_HZ).
    this.heldTimer = setInterval(() => {
      if (!this.engine) return;
      for (const [id, v] of this.held) this.engine.ingestWind(id, v);
    }, 50);

    this.staleTimer = setInterval(() => engine.tickStaleness(), 2000);

    if (this.autoDemo) this.startAutoDemo();
  }

  disconnect(): void {
    this.stopAutoDemo();
    if (this.heldTimer) clearInterval(this.heldTimer);
    if (this.staleTimer) clearInterval(this.staleTimer);
    this.heldTimer = this.staleTimer = null;
    this.held.clear();
    super.disconnect();
  }

  // ---- Manual / mic input ------------------------------------------------

  /** One-shot or instantaneous wind value for a node, 0..1. */
  blow(id: string, intensity: number) {
    this.engine?.ingestWind(id, intensity);
  }

  /** Hold a continuous wind value on a node (mic level, or mouse held down). */
  holdWind(id: string, intensity: number) {
    if (intensity <= 0.001) this.held.delete(id);
    else this.held.set(id, Math.min(1, intensity));
  }
  releaseWind(id: string) {
    this.held.delete(id);
    this.engine?.ingestWind(id, 0);
  }

  shake(id: string, mag: number) {
    this.engine?.ingestMotion(id, mag);
  }

  setPresence(id: string, present: boolean) {
    this.engine?.ingestPresence(id, present);
  }

  // ---- Auto demo ---------------------------------------------------------

  setAutoDemo(on: boolean) {
    this.autoDemo = on;
    if (!this.engine) return;
    if (on) this.startAutoDemo();
    else this.stopAutoDemo();
  }

  private startAutoDemo() {
    if (this.autoTimer) return;
    const sensors = LAYOUT.nodes.filter((n) => n.role === 'sensor' || n.role === 'feather');
    this.autoTimer = setInterval(() => {
      if (!this.engine) return;
      for (const s of sensors) {
        // mostly gentle, occasional gust (product of two randoms skews low)
        const gust = Math.random() * Math.random();
        this.engine.ingestWind(s.id, gust);
        if (Math.random() < 0.04) this.engine.ingestMotion(s.id, 0.6 + Math.random() * 0.8);
        if (Math.random() < 0.02) this.engine.ingestPresence(s.id, Math.random() < 0.7);
      }
    }, 120);
  }

  private stopAutoDemo() {
    if (this.autoTimer) clearInterval(this.autoTimer);
    this.autoTimer = null;
  }
}
