// ============================================================================
//  Wing Beat — Transport interface
//
//  A transport is the ONLY thing that differs between "running a simulation on
//  a laptop" and "running the real installation in a forest". It does two jobs:
//
//    INBOUND   feed sensor readings INTO the engine (engine.ingest*)
//    OUTBOUND  carry the engine's commands OUT to the world (LED/audio)
//
//  Both SimTransport and MqttTransport implement this. The engine, the audio,
//  and the UI never know which one is plugged in.
// ============================================================================

import type { WingbeatEngine } from '../engine/WingbeatEngine.ts';

export type TransportStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'closed';

export interface Transport {
  readonly kind: 'sim' | 'mqtt';
  /** Human-readable connection target (e.g. 'synthetic' or 'ws://10.0.0.4:9001'). */
  readonly target: string;

  /** Wire this transport to an engine and start moving data both directions. */
  connect(engine: WingbeatEngine): void;
  disconnect(): void;

  /** Current link status, for the operator UI. */
  status(): TransportStatus;
  /** Subscribe to status changes. Returns an unsubscribe fn. */
  onStatus(cb: (s: TransportStatus) => void): () => void;
}

export abstract class BaseTransport implements Transport {
  abstract readonly kind: 'sim' | 'mqtt';
  abstract readonly target: string;

  protected engine: WingbeatEngine | null = null;
  protected detachers: Array<() => void> = [];
  private _status: TransportStatus = 'idle';
  private statusCbs = new Set<(s: TransportStatus) => void>();

  abstract connect(engine: WingbeatEngine): void;

  disconnect(): void {
    this.detachers.forEach((d) => d());
    this.detachers = [];
    this.engine = null;
    this.setStatus('closed');
  }

  status(): TransportStatus {
    return this._status;
  }

  onStatus(cb: (s: TransportStatus) => void): () => void {
    this.statusCbs.add(cb);
    cb(this._status);
    return () => this.statusCbs.delete(cb);
  }

  protected setStatus(s: TransportStatus) {
    this._status = s;
    for (const cb of this.statusCbs) cb(s);
  }
}
