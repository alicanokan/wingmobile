import { describe, expect, it } from 'vitest';
import { parseTopic, parseLedCmd, parseStatus, topics, WIRE_DOC, LED_MODES } from '../wire.ts';

describe('parseTopic', () => {
  it('classifies every topic the builders produce', () => {
    expect(parseTopic(topics.status('feather_01'))).toEqual({ kind: 'status', id: 'feather_01' });
    expect(parseTopic(topics.sensor('sensor_03', 'wind'))).toEqual({ kind: 'sensor', id: 'sensor_03', sensor: 'wind' });
    expect(parseTopic(topics.cmdLed('feather_01'))).toEqual({ kind: 'cmd', id: 'feather_01', cmd: 'led' });
    expect(parseTopic(topics.cmdAudio('audio_01'))).toEqual({ kind: 'cmd', id: 'audio_01', cmd: 'audio' });
    expect(parseTopic(topics.globalScene)).toEqual({ kind: 'global', what: 'scene' });
    expect(parseTopic(topics.globalAll)).toEqual({ kind: 'global', what: 'all' });
  });
  it('rejects anything outside the contract', () => {
    expect(parseTopic('other/node/x/status')).toBeNull();
    expect(parseTopic('wingbeat/node/x/sensor/temperature')).toBeNull();
    expect(parseTopic('wingbeat/node/x/cmd/led/extra')).toBeNull();
    expect(parseTopic('wingbeat/node//status')).toBeNull();
  });
});

describe('payload parsers', () => {
  it('clamps LED commands and keeps the src tag', () => {
    expect(parseLedCmd({ mode: 'solid', r: 300, g: -4, b: 12.6, intensity: 2, src: 'router' })).toEqual({ mode: 'solid', r: 255, g: 0, b: 13, intensity: 1, src: 'router' });
    expect(parseLedCmd({ mode: 'disco' })).toBeNull();
    expect(parseLedCmd({ mode: 'off', src: 'hacker' })!.src).toBeUndefined();
  });
  it('reads status leniently', () => {
    expect(parseStatus({ online: false, role: 'feather', rssi: -60 })).toEqual({ online: false, role: 'feather', fw: undefined, rssi: -60, ip: undefined });
    expect(parseStatus({ role: 'toaster' }).role).toBeUndefined();
  });
  it('documents every LED mode and valid JSON examples', () => {
    const ledDoc = WIRE_DOC.find((e) => e.topic.endsWith('cmd/led'))!;
    for (const m of LED_MODES) expect(ledDoc.notes).toContain(m);
    for (const e of WIRE_DOC) expect(() => JSON.parse(e.example)).not.toThrow();
  });
});
