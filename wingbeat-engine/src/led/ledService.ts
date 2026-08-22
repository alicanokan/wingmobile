// ============================================================================
//  ledService — the one place the whole app agrees about the lights.
//
//  A module-level singleton on purpose. The signal that should drive the strips
//  is produced on /feather2, the operator who configures them sits in the
//  control module on /, and neither route can hold the other's state. A
//  singleton lets /feather2 push features every frame without knowing anything
//  about MQTT, and lets the control module configure and watch the output
//  without knowing anything about audio.
//
//  Everything the operator sets is persisted, because a lighting patch that
//  evaporates on reload is worse than no patch at all when you are standing in
//  a room with the install half-built.
// ============================================================================

import type { LedCommand, NodeId } from '../engine/types.ts';
import { LedRouter, DEFAULT_RATE_HZ } from './LedRouter.ts';
import { LedLink, type DiscoveredNode, type LinkStatus } from './LedLink.ts';
import { DEFAULT_FIXTURE, type LedArbiter, type LedFixture, type LedInputs, type LedWire } from './types.ts';

/** A router stream counts as live for this long after its last packet —
 *  comfortably more than the router's 2 s heartbeat, so a held colour keeps
 *  ownership, and short enough that a closed /feather2 tab hands the node
 *  back to the engine before anyone walks over to check the strip. */
export const ROUTER_LIVE_MS = 3500;

const FIXTURES_KEY = 'wb.led.fixtures';
const CONFIG_KEY = 'wb.led.config';

export interface LedConfig {
  url: string;
  autoConnect: boolean;
  master: number;
  blackout: boolean;
  rateHz: number;
  /** false parks the router without tearing the link down */
  enabled: boolean;
}

const DEFAULT_CONFIG: LedConfig = {
  // the Mosquitto websocket listener from broker/mosquitto.conf
  url: 'ws://localhost:9001',
  autoConnect: false,
  master: 1,
  blackout: false,
  rateHz: DEFAULT_RATE_HZ,
  enabled: true,
};

export interface LedTrace {
  id: NodeId;
  cmd: LedCommand;
  reason: string;
  at: number;
}

function loadConfig(): LedConfig {
  const cfg = { ...DEFAULT_CONFIG };
  try {
    const raw = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? '{}') as Partial<LedConfig>;
    if (typeof raw.url === 'string' && raw.url) cfg.url = raw.url;
    if (typeof raw.autoConnect === 'boolean') cfg.autoConnect = raw.autoConnect;
    if (Number.isFinite(raw.master)) cfg.master = Math.max(0, Math.min(1, raw.master as number));
    if (typeof raw.blackout === 'boolean') cfg.blackout = raw.blackout;
    if (Number.isFinite(raw.rateHz)) cfg.rateHz = Math.max(1, Math.min(30, raw.rateHz as number));
    if (typeof raw.enabled === 'boolean') cfg.enabled = raw.enabled;
  } catch { /* defaults */ }
  return cfg;
}

function loadFixtures(): LedFixture[] {
  try {
    const raw = JSON.parse(localStorage.getItem(FIXTURES_KEY) ?? 'null');
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((f) => f && typeof f.id === 'string')
      .map((f) => ({
        ...DEFAULT_FIXTURE,
        ...f,
        gains: f.gains && typeof f.gains === 'object' ? f.gains : { ...DEFAULT_FIXTURE.gains },
        gain: Number.isFinite(f.gain) ? Math.max(0, Math.min(1, f.gain)) : 1,
      })) as LedFixture[];
  } catch {
    return [];
  }
}

class LedService implements LedArbiter {
  readonly router = new LedRouter();
  readonly link = new LedLink();

  config: LedConfig = loadConfig();
  fixtures: LedFixture[] = loadFixtures();

  /** last N emissions, for the operator's output monitor */
  trace: LedTrace[] = [];
  private traceCbs = new Set<() => void>();
  private changeCbs = new Set<() => void>();
  private identifyUntil = new Map<NodeId, number>();
  /** last time a ROUTER-tagged packet was seen on the wire, per node */
  private routerSeen = new Map<NodeId, number>();

  constructor() {
    this.router.setRate(this.config.rateHz);
    this.router.setFixtures(this.fixtures);
    this.link.onNodes((nodes) => this.adoptDiscovered(nodes));
    // the monitor reports what is genuinely on the wire, not what we meant
    this.link.onLed((id, cmd) => {
      this.noteWire(id, cmd);
      this.pushTrace({ id, cmd, reason: `wire:${cmd.src ?? '?'}`, at: performance.now() });
    });
    if (typeof window === 'undefined') return; // plain-Node import (tests)

    // Each route is its own page load, so /conductor's panel and /feather2's
    // streamer are SEPARATE instances of this singleton. `storage` fires in
    // every OTHER page when one writes localStorage — that's exactly the
    // cross-page channel needed so Blackout / Master / Rate / fixture edits
    // made at the console actually govern the page that is streaming frames.
    window.addEventListener('storage', (e) => {
      if (e.key === CONFIG_KEY) {
        this.config = loadConfig();
        this.router.setRate(this.config.rateHz);
        this.changed();
      } else if (e.key === FIXTURES_KEY) {
        this.fixtures = loadFixtures();
        this.router.setFixtures(this.fixtures);
        this.changed();
      }
    });
  }

  // ---- subscriptions -------------------------------------------------------
  onChange(cb: () => void): () => void {
    this.changeCbs.add(cb);
    return () => this.changeCbs.delete(cb);
  }
  onTrace(cb: () => void): () => void {
    this.traceCbs.add(cb);
    return () => this.traceCbs.delete(cb);
  }
  onStatus(cb: (s: LinkStatus) => void): () => void {
    return this.link.onStatus(cb);
  }
  private changed() {
    for (const cb of this.changeCbs) cb();
  }

  // ---- configuration -------------------------------------------------------
  setConfig(patch: Partial<LedConfig>): void {
    this.config = { ...this.config, ...patch };
    if (patch.rateHz !== undefined) this.router.setRate(this.config.rateHz);
    localStorage.setItem(CONFIG_KEY, JSON.stringify(this.config));
    this.changed();
  }

  setFixtures(f: LedFixture[]): void {
    this.fixtures = f;
    this.router.setFixtures(f);
    localStorage.setItem(FIXTURES_KEY, JSON.stringify(f));
    this.changed();
  }

  updateFixture(id: NodeId, patch: Partial<LedFixture>): void {
    this.setFixtures(this.fixtures.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  addFixture(id: NodeId): void {
    if (!id || this.fixtures.some((f) => f.id === id)) return;
    this.setFixtures([...this.fixtures, { id, ...DEFAULT_FIXTURE }]);
    this.link.addManual(id);
  }

  removeFixture(id: NodeId): void {
    this.setFixtures(this.fixtures.filter((f) => f.id !== id));
  }

  /** A node that announces itself becomes a fixture automatically — walking up
   *  to an install and having the strips appear is the point. */
  private adoptDiscovered(nodes: Map<NodeId, DiscoveredNode>): void {
    let added = false;
    const next = [...this.fixtures];
    for (const [id, n] of nodes) {
      if (n.role && n.role !== 'feather' && n.role !== 'plant') continue; // audio nodes have no strip
      if (next.some((f) => f.id === id)) continue;
      next.push({ id, ...DEFAULT_FIXTURE });
      added = true;
    }
    if (added) this.setFixtures(next);
    else this.changed();
  }

  // ---- link ----------------------------------------------------------------
  connect(url?: string): void {
    if (url) this.setConfig({ url });
    this.link.connect({ url: this.config.url });
  }
  disconnect(): void {
    this.link.disconnect();
  }

  // ---- arbitration between the two pipelines --------------------------------
  //
  // Two things publish to wingbeat/node/<id>/cmd/led: the ENGINE (event-driven
  // shimmer / wind / pulse through MqttTransport — how the installation has
  // always behaved) and the ROUTER (a solid-colour stream from /feather2's
  // music or the console's sensors). Without a rule they interleave and the
  // strip flickers between two intentions. The rule, per node:
  //
  //   1. blackout           → only `off` goes out, from anyone
  //   2. identify in flight → the white flash wins
  //   3. fixture source 'engine', or no fixture → the engine drives
  //   4. a router stream is LIVE (a router packet in the last ROUTER_LIVE_MS)
  //                         → the router drives, the engine stays silent
  //   5. otherwise          → the engine drives (a patched fixture with nobody
  //                           streaming for it must not go dark)
  //
  // Liveness is measured on the wire, so it works across page loads: the
  // console (engine) and /feather2 (router) are different tabs with different
  // MQTT clients, and the only thing they both see is the broker.

  get blackout(): boolean {
    return this.config.blackout;
  }

  noteWire(id: NodeId, cmd: LedWire): void {
    if (cmd.src === 'router' || cmd.src === 'identify') this.routerSeen.set(id, performance.now());
  }

  /** True while a router stream has spoken for this node recently. */
  routerLive(id: NodeId, now = performance.now()): boolean {
    const t = this.routerSeen.get(id);
    return t !== undefined && now - t < ROUTER_LIVE_MS;
  }

  engineMayDrive(id: NodeId): boolean {
    if (this.config.blackout) return false;
    const now = performance.now();
    const until = this.identifyUntil.get(id);
    if (until !== undefined && now < until) return false;
    const fx = this.fixtures.find((f) => f.id === id);
    if (!fx || fx.source === 'engine') return true;
    return !this.routerLive(id, now);
  }

  /**
   * Flash one node white for a moment so an operator can tell which physical
   * strip is which. Bypasses the router entirely — identifying a fixture must
   * work even when the patch is muted, blacked out or misconfigured.
   */
  identify(id: NodeId, ms = 1200): void {
    this.link.publishLed(id, { mode: 'solid', r: 255, g: 255, b: 255, intensity: 1 }, 'identify');
    this.identifyUntil.set(id, performance.now() + ms);
    this.pushTrace({ id, cmd: { mode: 'solid', r: 255, g: 255, b: 255, intensity: 1 }, reason: 'identify', at: performance.now() });
  }

  /** Send every fixture black immediately, ignoring rate and change gates —
   *  and LATCH via blackout, so the next push() can't quietly resume the show.
   *  (The old resync() here meant "all off" lasted exactly one frame.)
   *  Un-tick Blackout in the panel to resume. */
  allOff(): void {
    const off: LedCommand = { mode: 'off', r: 0, g: 0, b: 0, intensity: 0 };
    for (const f of this.fixtures) this.link.publishLed(f.id, off);
    this.setConfig({ blackout: true });
  }

  private pushTrace(t: LedTrace) {
    this.trace.push(t);
    if (this.trace.length > 60) this.trace.shift();
    for (const cb of this.traceCbs) cb();
  }

  // ---- the per-frame entry point -------------------------------------------
  /**
   * Called from whichever page is producing signal. Cheap when nothing is due:
   * the router's rate gate returns an empty array most frames.
   */
  push(inputs: Omit<LedInputs, 'master' | 'blackout'>): void {
    if (!this.config.enabled) return;
    // The producing page (/feather2) never had a connect button — honour
    // autoConnect here so the stream reaches the wire without the operator
    // having to open a console on the same page.
    if (this.config.autoConnect && this.link.status === 'idle') {
      this.connect();
    }
    if (!this.fixtures.length) return;
    const now = performance.now();
    const emissions = this.router.tick(now, {
      ...inputs,
      master: this.config.master,
      blackout: this.config.blackout,
    });
    if (!emissions.length) return;
    for (const e of emissions) {
      // don't fight an in-flight identify flash
      const until = this.identifyUntil.get(e.id);
      if (until !== undefined) {
        if (now < until) continue;
        this.identifyUntil.delete(e.id);
      }
      this.link.publishLed(e.id, e.cmd);
      this.pushTrace({ id: e.id, cmd: e.cmd, reason: e.reason, at: now });
    }
  }
}

/** The single instance every route shares. */
export const ledService = new LedService();
