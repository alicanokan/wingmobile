// ============================================================================
//  MIDI out — a consumer of the engine bus, like AudioEngine, that drives
//  external gear (a DAW, a hardware synth, a lighting desk that speaks MIDI).
//
//    melody  → note-on/off, channel 1, velocity from the gust
//    perc    → note-on/off, channel 10 (GM drums), velocity from the shake
//    accent  → note-on/off, channel 2
//    wind    → CC 1 (mod wheel) on channel 1, the room's loudest breath
//    node    → CC 20 + sensor index, each sensor's own wind (0..127)
//    scene   → program change = index of the scene in SCENE_KEYS
//
//  Output only (decided 2026-07-19). Web MIDI needs a user gesture + a
//  secure context; on browsers without it (Safari) `supported` is false and
//  the panel says so instead of failing quietly. Device choice persists.
// ============================================================================

import type { WingbeatEngine } from '../engine/WingbeatEngine.ts';
import { SCENE_KEYS } from '../engine/scenes.ts';
import { LAYOUT } from '../engine/spatial.ts';
import { bool, loadJson, saveJson, str } from '../sim/persisted.ts';

const KEY = 'wb.midi.v1';
const NOTE_MS = 280;

const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 'C4' → 60, 'Eb3' → 51, 'F#5' → 78. Null for anything else. */
export function noteToMidi(note: string): number | null {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(note.trim());
  if (!m) return null;
  let n = NOTE_INDEX[m[1].toUpperCase()];
  if (m[2] === '#') n += 1;
  else if (m[2] === 'b') n -= 1;
  const midi = (Number(m[3]) + 1) * 12 + n;
  return midi >= 0 && midi <= 127 ? midi : null;
}

const to127 = (v: number) => Math.max(0, Math.min(127, Math.round(v * 127)));

export interface MidiState {
  enabled: boolean;
  outputId: string;
}

export class MidiOut {
  readonly supported = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  state: MidiState = loadJson(KEY, (raw) => {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return { enabled: bool(r.enabled, false), outputId: str(r.outputId) };
  });
  outputs: Array<{ id: string; name: string }> = [];
  status: 'idle' | 'requesting' | 'ready' | 'denied' | 'unsupported' = 'idle';

  private access: MIDIAccess | null = null;
  private out: MIDIOutput | null = null;
  private detachers: Array<() => void> = [];
  private changeCbs = new Set<() => void>();
  private lastCc = new Map<number, number>();
  private sensorIndex = new Map<string, number>();

  constructor() {
    LAYOUT.nodes.filter((n) => n.role === 'sensor').forEach((n, i) => this.sensorIndex.set(n.id, i));
    if (!this.supported) this.status = 'unsupported';
  }

  onChange(cb: () => void): () => void {
    this.changeCbs.add(cb);
    return () => this.changeCbs.delete(cb);
  }
  private changed() {
    for (const cb of this.changeCbs) cb();
  }
  private persist() {
    saveJson(KEY, this.state);
  }

  /** Ask the browser for MIDI (user gesture). Safe to call repeatedly. */
  async request(): Promise<void> {
    if (!this.supported) return;
    if (this.access) return;
    this.status = 'requesting';
    this.changed();
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
      this.access.onstatechange = () => this.refreshOutputs();
      this.status = 'ready';
      this.refreshOutputs();
    } catch (err) {
      console.warn('[midi] access denied', err);
      this.status = 'denied';
      this.changed();
    }
  }

  private refreshOutputs() {
    if (!this.access) return;
    this.outputs = [...this.access.outputs.values()].map((o) => ({ id: o.id, name: o.name ?? o.id }));
    // keep the chosen device if it's still there, else the first one
    const want = this.state.outputId && this.outputs.some((o) => o.id === this.state.outputId) ? this.state.outputId : (this.outputs[0]?.id ?? '');
    this.selectOutput(want);
    this.changed();
  }

  selectOutput(id: string) {
    this.state.outputId = id;
    this.out = (this.access && id && this.access.outputs.get(id)) || null;
    this.persist();
    this.changed();
  }

  setEnabled(on: boolean) {
    this.state.enabled = on;
    this.persist();
    if (on) void this.request();
    else this.allNotesOff();
    this.changed();
  }

  get active(): boolean {
    return this.state.enabled && !!this.out;
  }

  // ---- raw sends ---------------------------------------------------------
  private send(bytes: number[]) {
    if (!this.active) return;
    try {
      this.out!.send(bytes);
    } catch (err) {
      console.warn('[midi] send failed', err);
    }
  }
  private note(channel: number, midi: number, velocity: number) {
    const ch = Math.max(0, Math.min(15, channel - 1));
    this.send([0x90 | ch, midi, to127(velocity)]);
    setTimeout(() => this.send([0x80 | ch, midi, 0]), NOTE_MS);
  }
  private cc(channel: number, cc: number, value01: number) {
    const v = to127(value01);
    const key = channel * 1000 + cc;
    if (this.lastCc.get(key) === v) return; // don't flood identical values
    this.lastCc.set(key, v);
    this.send([0xb0 | Math.max(0, Math.min(15, channel - 1)), cc, v]);
  }
  private program(channel: number, n: number) {
    this.send([0xc0 | Math.max(0, Math.min(15, channel - 1)), Math.max(0, Math.min(127, n))]);
  }
  allNotesOff() {
    for (let ch = 0; ch < 16; ch++) this.send([0xb0 | ch, 123, 0]);
  }

  // ---- bus wiring --------------------------------------------------------
  attach(engine: WingbeatEngine): () => void {
    this.detach();
    this.detachers.push(
      engine.on('melody', ({ note, velocity }) => {
        const m = noteToMidi(note);
        if (m !== null) this.note(1, m, velocity);
      }),
      engine.on('perc', ({ note, velocity }) => {
        const m = noteToMidi(note);
        if (m !== null) this.note(10, m, velocity);
      }),
      engine.on('accent', ({ note, velocity }) => {
        const m = noteToMidi(note);
        if (m !== null) this.note(2, m, velocity);
      }),
      engine.on('wind', ({ maxWind }) => this.cc(1, 1, maxWind)),
      engine.on('node', ({ id, state }) => {
        const i = this.sensorIndex.get(id);
        if (i !== undefined) this.cc(1, 20 + i, state.wind);
      }),
      engine.on('scene', ({ key }) => {
        const i = SCENE_KEYS.indexOf(key);
        if (i >= 0) this.program(1, i);
      }),
    );
    if (this.state.enabled) void this.request();
    return () => this.detach();
  }

  detach() {
    this.detachers.forEach((d) => d());
    this.detachers = [];
  }
}

/** The console's one MIDI sender. */
export const midiOut = new MidiOut();
