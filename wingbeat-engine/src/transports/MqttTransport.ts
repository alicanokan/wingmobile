// ============================================================================
//  Wing Beat — MQTT transport (the hardware bridge)
//
//  This is the ONE file that connects the simulation's brain to the real
//  installation. It speaks the exact topic schema already defined in
//  wingbeat-system/docs/mqtt-topics.md, so the existing ESP8266 firmware
//  (feather_node.ino / audio_node.ino) works against it unchanged.
//
//    INBOUND   wingbeat/node/<id>/sensor/{wind,motion,presence}  → engine.ingest*
//              wingbeat/node/<id>/status                         → engine.ingestStatus
//
//    OUTBOUND  engine 'led'   event → wingbeat/node/<id>/cmd/led
//              engine 'scene' event → wingbeat/global/scene  (retained)
//
//  Flip the transport from SimTransport to this, point it at the broker, and
//  the simulation you tuned IS the installation.
// ============================================================================

import mqtt, { type MqttClient } from 'mqtt';
import { BaseTransport } from './Transport.ts';
import { getScene } from '../engine/scenes.ts';
import type { WingbeatEngine } from '../engine/WingbeatEngine.ts';
import type { NodeRole } from '../engine/types.ts';

export interface MqttOptions {
  /** e.g. ws://10.0.0.4:9001 — the Mosquitto WebSocket listener. */
  url: string;
  username?: string;
  password?: string;
}

export class MqttTransport extends BaseTransport {
  readonly kind = 'mqtt' as const;
  readonly target: string;

  private client: MqttClient | null = null;
  private opts: MqttOptions;

  constructor(opts: MqttOptions) {
    super();
    this.opts = opts;
    this.target = opts.url;
  }

  connect(engine: WingbeatEngine): void {
    this.engine = engine;
    this.setStatus('connecting');

    const client = mqtt.connect(this.opts.url, {
      username: this.opts.username,
      password: this.opts.password,
      clientId: 'wingbeat-engine-' + Math.random().toString(16).slice(2, 8),
      reconnectPeriod: 2000,
      clean: true,
    });
    this.client = client;

    client.on('connect', () => {
      this.setStatus('connected');
      client.subscribe('wingbeat/node/+/sensor/+', { qos: 0 });
      client.subscribe('wingbeat/node/+/status', { qos: 1 });
      // Announce the engine's current scene so freshly-booted nodes sync up.
      this.publishScene(engine.scene);
    });

    client.on('reconnect', () => this.setStatus('connecting'));
    client.on('close', () => this.setStatus('closed'));
    client.on('error', () => this.setStatus('error'));

    client.on('message', (topic, msg) => this.onMessage(topic, msg));

    // ---- Outbound: engine commands → MQTT ----
    this.detachers.push(
      engine.on('led', ({ id, cmd }) => {
        if (!client.connected) return;
        client.publish(`wingbeat/node/${id}/cmd/led`, JSON.stringify(cmd), {
          qos: 1,
          retain: false,
        });
      }),
    );

    this.detachers.push(
      engine.on('scene', ({ key }) => this.publishScene(key)),
    );

    // (Optional) drive I2S audio nodes: an 'accent' could fire a local sample.
    this.detachers.push(
      engine.on('accent', ({ id }) => {
        if (!client.connected) return;
        const node = engine.getNode(id);
        if (node?.role !== 'audio') return;
        client.publish(
          `wingbeat/node/${id}/cmd/audio`,
          JSON.stringify({ layer: 'accent', gain: 0.8, play: true }),
          { qos: 1 },
        );
      }),
    );
  }

  disconnect(): void {
    this.client?.end(true);
    this.client = null;
    super.disconnect();
  }

  // ---- Inbound: MQTT → engine -------------------------------------------
  private onMessage(topic: string, msg: Uint8Array | Buffer) {
    if (!this.engine) return;
    const parts = topic.split('/');
    if (parts[0] !== 'wingbeat' || parts[1] !== 'node') return;
    const id = parts[2];
    const kind = parts[3];

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(msg.toString());
    } catch {
      return;
    }

    if (kind === 'status') {
      this.engine.ingestStatus(id, {
        online: Boolean(payload.online),
        role: payload.role as NodeRole | undefined,
        fw: payload.fw as string | undefined,
        rssi: payload.rssi as number | undefined,
      });
    } else if (kind === 'sensor') {
      const sub = parts[4];
      if (sub === 'wind') this.engine.ingestWind(id, Number(payload.v ?? 0));
      else if (sub === 'motion') this.engine.ingestMotion(id, Number(payload.mag ?? 0));
      else if (sub === 'presence') this.engine.ingestPresence(id, Boolean(payload.present));
    }
  }

  private publishScene(key: string) {
    if (!this.client?.connected) return;
    // include the LED tint so scene-aware firmware can react without a table
    const scene = getScene(key);
    this.client.publish(
      'wingbeat/global/scene',
      JSON.stringify({ scene: key, fade_ms: 2500, led: scene.led }),
      { qos: 1, retain: true },
    );
  }

  /** Operator-panel maintenance broadcast (reset / calibrate / rainbow). */
  publishGlobalCmd(action: 'reset' | 'calibrate' | 'rainbow') {
    if (!this.client?.connected) return;
    this.client.publish('wingbeat/global/cmd/all', JSON.stringify({ action }), { qos: 1 });
  }
}
