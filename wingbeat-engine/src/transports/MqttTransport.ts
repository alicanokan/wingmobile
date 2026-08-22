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
//    OUTBOUND  engine 'led'   event → wingbeat/node/<id>/cmd/led  (tagged src:engine,
//                                     arbitrated against the LED router — see
//                                     LedArbiter in led/types.ts)
//              engine 'scene' event → wingbeat/global/scene  (retained)
//              engine 'accent' event → wingbeat/node/<audio id>/cmd/audio
//
//  Flip the transport from SimTransport to this, point it at the broker, and
//  the simulation you tuned IS the installation.
// ============================================================================

import mqtt, { type MqttClient } from 'mqtt';
import { BaseTransport } from './Transport.ts';
import { getScene } from '../engine/scenes.ts';
import type { WingbeatEngine } from '../engine/WingbeatEngine.ts';
import type { LedCommand, NodeId } from '../engine/types.ts';
import type { LedArbiter, LedWire } from '../led/types.ts';
import { QOS, parseJson, parseLedCmd, parseStatus, parseTopic, topics, type AudioCmdWire, type GlobalAction, type SceneWire } from '../protocol/wire.ts';

export interface MqttOptions {
  /** e.g. ws://10.0.0.4:9001 — the Mosquitto WebSocket listener. */
  url: string;
  username?: string;
  password?: string;
  /**
   * The LED arbiter (normally `ledService`). When given, the engine's
   * event-driven LED commands are published only for nodes the router isn't
   * streaming to, blackout is honoured, and the engine re-asserts its state
   * the moment a node is handed back. Without it this transport publishes
   * every `led` event unconditionally — the pre-arbitration behaviour.
   */
  led?: LedArbiter;
}

/** How often the transport checks whether a router-owned node has been
 *  handed back (stream stopped) and needs the engine's colour re-sent. */
const HANDBACK_SWEEP_MS = 1000;

export class MqttTransport extends BaseTransport {
  readonly kind = 'mqtt' as const;
  readonly target: string;

  private client: MqttClient | null = null;
  private opts: MqttOptions;
  private staleTimer: ReturnType<typeof setInterval> | null = null;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  /** per node: did the engine have the floor at the last sweep? */
  private hadFloor = new Map<NodeId, boolean>();
  private wasBlackout = false;

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
      client.subscribe(topics.anySensor, { qos: QOS.sensor });
      client.subscribe(topics.anyStatus, { qos: QOS.status });
      // watch the LED topic too: that's how we know a router stream is live
      // for a node (see LedArbiter) even when this page has no LedLink open
      if (this.opts.led) client.subscribe(topics.anyCmdLed, { qos: QOS.cmdStream });
      // Announce the engine's current scene so freshly-booted nodes sync up.
      this.publishScene(engine.scene);
    });

    client.on('reconnect', () => this.setStatus('connecting'));
    client.on('close', () => this.setStatus('closed'));
    client.on('error', () => this.setStatus('error'));

    client.on('message', (topic, msg) => this.onMessage(topic, msg));

    // A node whose TCP session survives but whose packets stop (weak wifi,
    // brownout) never triggers the broker's LWT — the engine's own staleness
    // sweep is the only thing that turns its dot grey. Same cadence as sim.
    this.staleTimer = setInterval(() => engine.tickStaleness(), 2000);

    // ---- Outbound: engine commands → MQTT ----
    this.detachers.push(
      engine.on('led', ({ id, cmd }) => {
        const led = this.opts.led;
        if (led && !led.engineMayDrive(id)) return; // router owns it right now
        this.publishLed(id, cmd);
      }),
    );

    // ---- Arbitration housekeeping ----
    const led = this.opts.led;
    if (led) {
      this.wasBlackout = led.blackout;
      // blackout flips: going dark → every engine node gets `off` (the
      // router only knows its fixtures); coming back → re-assert the engine's
      // last colour on every node it may drive
      this.detachers.push(
        led.onChange(() => {
          const now = led.blackout;
          if (now === this.wasBlackout) return;
          this.wasBlackout = now;
          if (now) {
            for (const n of engine.getNodes()) this.publishLed(n.id, { mode: 'off', r: 0, g: 0, b: 0, intensity: 0 });
          } else {
            this.reassert(engine, led);
          }
        }),
      );
      // a router stream that stops (tab closed, link dropped) hands the node
      // back; nothing event-driven may happen for minutes, so re-send
      // proactively rather than leave the strip frozen on the router's last
      // colour
      this.sweepTimer = setInterval(() => this.reassert(engine, led, true), HANDBACK_SWEEP_MS);
    }

    this.detachers.push(
      engine.on('scene', ({ key }) => this.publishScene(key)),
    );

    // Drive the I2S audio nodes: an 'accent' (presence onset) fires their
    // local accent sample. Accents are raised by SENSOR nodes, so the command
    // goes to every node whose role is 'audio' — the old gate compared the
    // triggering sensor's own role, which is never 'audio', so no audio node
    // ever received a command.
    this.detachers.push(
      engine.on('accent', () => {
        if (!client.connected) return;
        const cmd: AudioCmdWire = { layer: 'accent', gain: 0.8, play: true };
        for (const node of engine.getNodes()) {
          if (node.role !== 'audio' || !node.online) continue;
          client.publish(topics.cmdAudio(node.id), JSON.stringify(cmd), { qos: QOS.cmdAudio });
        }
      }),
    );
  }

  private publishLed(id: NodeId, cmd: LedCommand) {
    if (!this.client?.connected) return;
    const wire: LedWire = { ...cmd, src: 'engine' };
    this.client.publish(topics.cmdLed(id), JSON.stringify(wire), { qos: QOS.cmdEvent, retain: false });
  }

  /** Re-send the engine's current LED state for nodes it may drive. With
   *  `onlyRegained` only nodes whose floor flipped false→true since the last
   *  call are sent, so the sweep is silent in steady state. */
  private reassert(engine: WingbeatEngine, led: LedArbiter, onlyRegained = false) {
    for (const n of engine.getNodes()) {
      const may = led.engineMayDrive(n.id);
      const had = this.hadFloor.get(n.id) ?? true;
      this.hadFloor.set(n.id, may);
      if (!may) continue;
      if (onlyRegained && had) continue;
      this.publishLed(n.id, n.led);
    }
  }

  disconnect(): void {
    if (this.staleTimer) clearInterval(this.staleTimer);
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.staleTimer = this.sweepTimer = null;
    this.hadFloor.clear();
    this.client?.end(true);
    this.client = null;
    super.disconnect();
  }

  // ---- Inbound: MQTT → engine -------------------------------------------
  private onMessage(topic: string, msg: Uint8Array | Buffer) {
    if (!this.engine) return;
    const t = parseTopic(topic);
    if (!t) return;
    const payload = parseJson(msg);
    if (!payload) return;

    if (t.kind === 'cmd') {
      if (t.cmd === 'led') {
        const cmd = parseLedCmd(payload);
        if (cmd) this.opts.led?.noteWire(t.id, cmd);
      }
      return;
    }
    if (t.kind === 'status') {
      this.engine.ingestStatus(t.id, parseStatus(payload));
    } else if (t.kind === 'sensor') {
      if (t.sensor === 'wind') this.engine.ingestWind(t.id, Number(payload.v ?? 0));
      else if (t.sensor === 'motion') this.engine.ingestMotion(t.id, Number(payload.mag ?? 0));
      else if (t.sensor === 'presence') this.engine.ingestPresence(t.id, Boolean(payload.present));
    }
  }

  private publishScene(key: string) {
    if (!this.client?.connected) return;
    // include the LED tint so scene-aware firmware can react without a table
    const scene = getScene(key);
    const wire: SceneWire = { scene: key, fade_ms: 2500, led: scene.led };
    this.client.publish(topics.globalScene, JSON.stringify(wire), { qos: QOS.scene, retain: true });
  }

  /** Operator-panel maintenance broadcast (reset / calibrate / rainbow / silence). */
  publishGlobalCmd(action: GlobalAction) {
    if (!this.client?.connected) return;
    this.client.publish(topics.globalAll, JSON.stringify({ action }), { qos: QOS.all });
  }
}
