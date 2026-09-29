import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  class Events {
    handlers = new Map<string, Array<(...args: any[]) => void>>();
    on(name: string, cb: (...args: any[]) => void) { this.handlers.set(name, [...(this.handlers.get(name) ?? []), cb]); return this; }
    emit(name: string, ...args: any[]) { for (const cb of this.handlers.get(name) ?? []) cb(...args); }
  }
  class Connection extends Events {
    open = false; peer = 'phone'; send = vi.fn();
    close = vi.fn(() => { this.open = false; this.emit('close'); });
  }
  class Peer extends Events {
    static instances: Peer[] = [];
    open = false; destroyed = false; disconnected = false;
    connections: Connection[] = [];
    constructor(..._args: any[]) { super(); Peer.instances.push(this); }
    destroy = vi.fn(() => { this.destroyed = true; this.open = false; });
    reconnect = vi.fn();
    connect = vi.fn(() => { const c = new Connection(); this.connections.push(c); return c; });
  }
  return { Peer, Connection };
});
vi.mock('peerjs', () => ({ Peer: fake.Peer }));
import { startHost, connectHost } from '../link.ts';

beforeEach(() => { vi.useFakeTimers(); fake.Peer.instances.length = 0; vi.spyOn(Math, 'random').mockReturnValue(0); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('phone connection recovery', () => {
  it('recreates a host after initial signalling failure and cleans up retries', () => {
    const status = vi.fn(); const host = startHost({ onControl: vi.fn(), onStatus: status });
    const first = fake.Peer.instances[0];
    first.emit('error', { type: 'network', message: 'offline' });
    first.emit('disconnected');
    vi.advanceTimersByTime(800);
    expect(fake.Peer.instances).toHaveLength(2);
    const next = fake.Peer.instances[1]; next.open = true; next.emit('open');
    expect(status).toHaveBeenLastCalledWith('ready');
    host.destroy(); vi.advanceTimersByTime(60000);
    expect(fake.Peer.instances).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('counts only open phones and drops a stalled handshake', () => {
    const drop = vi.fn(); const host = startHost({ onControl: vi.fn(), onDrop: drop, onStatus: vi.fn() });
    const p = fake.Peer.instances[0]; p.open = true; p.emit('open');
    const pending = new fake.Connection(); p.emit('connection', pending);
    expect(host.peerCount()).toBe(0);
    vi.advanceTimersByTime(15000);
    expect(pending.close).toHaveBeenCalledOnce(); expect(drop).toHaveBeenCalledWith('phone');
    const ready = new fake.Connection(); p.emit('connection', ready); ready.open = true; ready.emit('open');
    expect(host.peerCount()).toBe(1); ready.close(); expect(host.peerCount()).toBe(0);
    host.destroy(); expect(vi.getTimerCount()).toBe(0);
  });
  it('recreates a phone after initial failure, then retries a stalled data channel', () => {
    const status = vi.fn(); const phone = connectHost('ROOM', 'CODE', { onStatus: status });
    fake.Peer.instances[0].emit('error', { type: 'network' }); vi.advanceTimersByTime(800);
    const p = fake.Peer.instances[1]; p.open = true; p.emit('open');
    const first = p.connections[0]; vi.advanceTimersByTime(15000);
    expect(first.close).toHaveBeenCalled(); vi.advanceTimersByTime(1600);
    expect(p.connections).toHaveLength(2);
    const c = p.connections[1]; c.open = true; c.emit('open');
    expect(status).toHaveBeenLastCalledWith('peer');
    phone.send({ t: 'motion', v: 0.4 }); expect(c.send).toHaveBeenLastCalledWith({ t: 'motion', v: 0.4 });
    phone.destroy(); expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps an open phone channel usable while signalling reconnects', () => {
    const phone = connectHost('ROOM', 'CODE', { onStatus: vi.fn() });
    const p = fake.Peer.instances[0]; p.open = true; p.emit('open');
    const c = p.connections[0]; c.open = true; c.emit('open');
    p.open = false; p.disconnected = true; p.emit('disconnected'); vi.advanceTimersByTime(800);
    expect(p.reconnect).toHaveBeenCalledOnce();
    phone.send({ t: 'motion', v: 0.7 }); expect(c.send).toHaveBeenLastCalledWith({ t: 'motion', v: 0.7 });
    p.open = true; p.disconnected = false; p.emit('open'); expect(p.connections).toHaveLength(1);
    phone.destroy();
  });
});
