import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => {
  const handlers = new Map<string, (...args: any[]) => void>();
  const client = { connected: true, on: vi.fn((name: string, fn: (...args: any[]) => void) => { handlers.set(name, fn); }), subscribe: vi.fn(), publish: vi.fn(), end: vi.fn() };
  return { handlers, client, connect: vi.fn(() => client) };
});
vi.mock('mqtt', () => ({ default: { connect: fake.connect } }));
import { MqttTransport } from '../MqttTransport';
import { WingbeatEngine } from '../../engine/WingbeatEngine';
import { engineLedInputs } from '../../led/engineInputs';
import { topics } from '../../protocol/wire';
const message = (topic: string, body: object) => fake.handlers.get('message')!(topic, Buffer.from(JSON.stringify(body)));
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); fake.handlers.clear(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('hardware bridge', () => {
  it('shares hardware input with visuals/lights, rejects bad samples, and releases on disconnect', () => {
    const e = new WingbeatEngine(); const t = new MqttTransport({ url: 'ws://localhost:9001' }); t.connect(e);
    fake.handlers.get('connect')!();
    message('wingbeat/node/sensor_01/sensor/wind', { v: 0.8, ts: 100 });
    expect(e.getNode('sensor_01')!.wind).toBe(0.8);
    e.tick(performance.now() + 200);
    expect(engineLedInputs(e).sensors?.sensor_01.wind).toBeGreaterThan(0);
    message('wingbeat/node/sensor_01/sensor/wind', { v: 'bad', ts: 100000 });
    message('wingbeat/node/sensor_01/sensor/wind', { v: 0.5, ts: 101 });
    expect(e.getNode('sensor_01')!.wind).toBe(0.5);
    message('wingbeat/node/sensor_01/sensor/presence', { present: 'false' });
    expect(e.getNode('sensor_01')!.present).toBe(false);
    t.disconnect(); expect(e.getNode('sensor_01')!.wind).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it('renews engine LEDs before their TTL, without stealing router ownership', () => {
    let may = true;
    const led = { engineMayDrive: () => may, noteWire: vi.fn(), onChange: () => () => {}, blackout: false };
    const e = new WingbeatEngine(); const t = new MqttTransport({ url: 'ws://localhost:9001', led }); t.connect(e); fake.handlers.get('connect')!();
    e.ingestStatus('sensor_01', { online: true });
    fake.client.publish.mockClear(); vi.advanceTimersByTime(2000);
    const packets = fake.client.publish.mock.calls as unknown as Array<[string, string]>;
    expect(packets.some(([topic, body]) => topic === topics.cmdLed('sensor_01') && JSON.parse(body).ttlMs === 3500)).toBe(true);
    may = false; fake.client.publish.mockClear(); vi.advanceTimersByTime(3000);
    expect(fake.client.publish).not.toHaveBeenCalled(); t.disconnect();
  });
  it('reports an invalid broker without throwing into React', () => {
    const t = new MqttTransport({ url: 'not a broker' }); expect(() => t.connect(new WingbeatEngine())).not.toThrow(); expect(t.status()).toBe('error'); t.disconnect();
  });
});
