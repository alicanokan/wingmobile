// ============================================================================
//  LedLink — the wire between the router and the strips.
//
//  Deliberately separate from MqttTransport. That class binds to a
//  WingbeatEngine (`connect(engine)`) and is only ever constructed by the /sim
//  app, whereas the richest audio in this project lives on /feather2, which has
//  no engine at all. Rather than thread an engine through a page that does not
//  want one, this owns a small client of its own and does exactly two jobs:
//  publish LED commands, and listen for nodes announcing themselves.
//
//  One deliberate difference from MqttTransport: LED commands go out at QoS 0.
//  That transport uses QoS 1, which is right for a one-off scene change and
//  wrong for a continuous stream — QoS 1 waits for a PUBACK, so on a lossy link
//  the packets queue and the lights fall progressively behind the music. A
//  dropped LED frame is invisible; a backlog is not.
// ============================================================================

import mqtt, { type MqttClient } from 'mqtt';
import type { LedCommand, NodeId, NodeRole } from '../engine/types.ts';
import type { LedSource, LedWire } from './types.ts';

export type LinkStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'closed';

export interface DiscoveredNode {
  id: NodeId;
  role?: NodeRole;
  online: boolean;
  rssi?: number;
  ip?: string;
  fw?: string;
  /** performance.now()-style stamp of the last thing we heard */
  lastSeen: number;
}

export interface LedLinkOptions {
  url: string;
  username?: string;
  password?: string;
}

export class LedLink {
  private client: MqttClient | null = null;
  private _status: LinkStatus = 'idle';
  private statusCbs = new Set<(s: LinkStatus) => void>();
  private nodeCbs = new Set<(n: Map<NodeId, DiscoveredNode>) => void>();
  private ledCbs = new Set<(id: NodeId, cmd: LedWire) => void>();
  private nodes = new Map<NodeId, DiscoveredNode>();
  private _sent = 0;
  private _dropped = 0;
  url = '';

  get status(): LinkStatus {
    return this._status;
  }
  get connected(): boolean {
    return !!this.client?.connected;
  }
  /** Packets actually put on the wire, and those dropped because the link was down. */
  get counters(): { sent: number; dropped: number } {
    return { sent: this._sent, dropped: this._dropped };
  }
  get discovered(): Map<NodeId, DiscoveredNode> {
    return this.nodes;
  }

  onStatus(cb: (s: LinkStatus) => void): () => void {
    this.statusCbs.add(cb);
    cb(this._status);
    return () => this.statusCbs.delete(cb);
  }

  /**
   * Observe LED commands as they appear ON THE WIRE, whoever published them.
   * The operator console and the page producing the signal are separate page
   * loads with separate clients, so logging our own intent would show an empty
   * monitor on the console while the lights were moving. Watching the topic
   * shows the truth instead — including another operator's traffic, and
   * including our own echoed back, which proves the round trip completed.
   */
  onLed(cb: (id: NodeId, cmd: LedWire) => void): () => void {
    this.ledCbs.add(cb);
    return () => this.ledCbs.delete(cb);
  }

  onNodes(cb: (n: Map<NodeId, DiscoveredNode>) => void): () => void {
    this.nodeCbs.add(cb);
    cb(this.nodes);
    return () => this.nodeCbs.delete(cb);
  }

  private setStatus(s: LinkStatus) {
    this._status = s;
    for (const cb of this.statusCbs) cb(s);
  }

  private emitNodes() {
    for (const cb of this.nodeCbs) cb(this.nodes);
  }

  connect(opts: LedLinkOptions): void {
    this.disconnect();
    this.url = opts.url;
    this.setStatus('connecting');
    let client: MqttClient;
    try {
      client = mqtt.connect(opts.url, {
        username: opts.username,
        password: opts.password,
        clientId: 'wingbeat-led-' + Math.random().toString(16).slice(2, 8),
        reconnectPeriod: 2000,
        clean: true,
      });
    } catch {
      // a malformed URL throws synchronously rather than emitting 'error'
      this.setStatus('error');
      return;
    }
    this.client = client;

    client.on('connect', () => {
      this.setStatus('connected');
      // nodes announce themselves here; the firmware publishes this retained
      // with an LWT of {"online":false}, so we learn about a node the moment
      // we subscribe and again the moment it dies
      client.subscribe('wingbeat/node/+/status', { qos: 1 });
      client.subscribe('wingbeat/node/+/cmd/led', { qos: 0 });
    });
    client.on('reconnect', () => this.setStatus('connecting'));
    client.on('error', () => this.setStatus('error'));
    client.on('close', () => {
      if (this._status !== 'error') this.setStatus('closed');
    });
    client.on('message', (topic, msg) => this.onMessage(topic, msg));
  }

  private onMessage(topic: string, msg: Uint8Array) {
    const parts = topic.split('/');
    if (parts[0] !== 'wingbeat') return;
    if (parts.length === 5 && parts[3] === 'cmd' && parts[4] === 'led') {
      try {
        const cmd = JSON.parse(new TextDecoder().decode(msg)) as LedWire;
        for (const cb of this.ledCbs) cb(parts[2], cmd);
      } catch { /* a partial payload is not worth reporting */ }
      return;
    }
    if (parts.length !== 4 || parts[3] !== 'status') return;
    const id = parts[2];
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(new TextDecoder().decode(msg)) as Record<string, unknown>;
    } catch {
      return; // a node mid-flash can emit a partial payload; ignore it
    }
    const prev = this.nodes.get(id);
    this.nodes.set(id, {
      id,
      role: (body.role as NodeRole) ?? prev?.role,
      online: body.online !== false,
      rssi: typeof body.rssi === 'number' ? body.rssi : prev?.rssi,
      ip: typeof body.ip === 'string' ? body.ip : prev?.ip,
      fw: typeof body.fw === 'string' ? body.fw : prev?.fw,
      lastSeen: performance.now(),
    });
    this.emitNodes();
  }

  /** Fire-and-forget an LED command, tagged with who sent it so the engine
   *  pipeline (and any other client) can tell a router stream from an event.
   *  Returns false when the link is down. */
  publishLed(id: NodeId, cmd: LedCommand, src: LedSource = 'router'): boolean {
    if (!this.client?.connected) {
      this._dropped++;
      return false;
    }
    const wire: LedWire = { ...cmd, src };
    this.client.publish(`wingbeat/node/${id}/cmd/led`, JSON.stringify(wire), {
      qos: 0,
      retain: false,
    });
    this._sent++;
    return true;
  }

  /** Manually add a node the operator knows exists but which has not spoken. */
  addManual(id: NodeId): void {
    if (this.nodes.has(id)) return;
    this.nodes.set(id, { id, online: false, lastSeen: 0 });
    this.emitNodes();
  }

  forget(id: NodeId): void {
    if (this.nodes.delete(id)) this.emitNodes();
  }

  disconnect(): void {
    if (this.client) {
      this.client.end(true);
      this.client = null;
    }
    if (this._status !== 'idle') this.setStatus('closed');
  }
}
