import type {
  CalibratedInputSample,
  EncounterPhase,
  ExpressiveState,
  GestureEvent,
  NodeId,
} from './types.ts';

const STEP_MS = 1000 / 60;
const MAX_STEPS = 6;
const START_THRESHOLD = 0.12;
const END_THRESHOLD = 0.075;

interface ActiveGesture {
  id: string;
  nodeId: NodeId;
  kind: CalibratedInputSample['kind'];
  source: CalibratedInputSample['source'];
  onset: number;
  peakAt: number;
  peak: number;
}

export interface EncounterUpdate {
  gestures: GestureEvent[];
  state: ExpressiveState;
  previousPhase?: EncounterPhase;
}

/** Deterministic, bounded encounter state. It stores features, never raw audio. */
export class EncounterModel {
  private active = new Map<NodeId, ActiveGesture>();
  private levels = new Map<NodeId, number>();
  private history: GestureEvent[] = [];
  private sequence = 0;
  private lastStepAt: number | null = null;
  private accumulator = 0;
  private lastInputAt = -Infinity;
  private presence = false;
  private forceSettle = false;
  private held = false;
  private phase: EncounterPhase = 'rest';
  private energy = 0;
  private residue = 0;
  private vane = 0;
  private fringe = 0;
  private anticipation = 0;
  private recall = 0;
  private recallQueue: Array<{ at: number; strength: number }> = [];
  private lastRecallGestureId = '';
  private motionScale = 1;

  ingest(sample: CalibratedInputSample): GestureEvent[] {
    if (!sample.valid || !Number.isFinite(sample.value) || !Number.isFinite(sample.timestamp)) return [];
    const value = Math.max(0, Math.min(sample.kind === 'motion' ? 1.5 : 1, sample.value));
    if (sample.kind === 'presence') {
      this.presence = value >= 0.5;
      if (this.presence) this.lastInputAt = sample.timestamp;
      return [];
    }

    const channel = `${sample.nodeId}:${sample.kind}`;
    this.levels.set(channel, value);
    const active = this.active.get(channel);
    if (!active && value >= START_THRESHOLD) {
      this.active.set(channel, {
        id: `gesture-${++this.sequence}`,
        nodeId: sample.nodeId,
        kind: sample.kind,
        source: sample.source,
        onset: sample.timestamp,
        peakAt: sample.timestamp,
        peak: value,
      });
      this.lastInputAt = sample.timestamp;
      this.forceSettle = false;
      return [];
    }
    if (active && value > active.peak) {
      active.peak = value;
      active.peakAt = sample.timestamp;
    }
    if (!active || value > END_THRESHOLD) {
      if (value > END_THRESHOLD) this.lastInputAt = sample.timestamp;
      return [];
    }

    this.active.delete(channel);
    const gesture: GestureEvent = {
      version: 1,
      id: active.id,
      nodeId: active.nodeId,
      kind: active.kind,
      source: active.source,
      onset: active.onset,
      duration: Math.max(0, sample.timestamp - active.onset),
      strength: Math.min(1, active.peak),
      rise: Math.max(0, active.peakAt - active.onset),
      fall: Math.max(0, sample.timestamp - active.peakAt),
    };
    this.history.push(gesture);
    if (this.history.length > 12) this.history.shift();
    this.residue = Math.min(1, this.residue + gesture.strength * Math.min(1, gesture.duration / 1200) * 0.42);
    this.scheduleRecall(sample.timestamp);
    return [gesture];
  }

  requestSettle(): void {
    this.held = false;
    this.forceSettle = true;
    this.active.clear();
    this.levels.clear();
  }

  emergencyStop(): void {
    this.requestSettle();
    this.presence = false;
    this.energy = 0;
    this.residue = 0;
    this.vane = 0;
    this.fringe = 0;
    this.anticipation = 0;
    this.recall = 0;
    this.recallQueue = [];
    this.phase = 'rest';
  }

  setHeld(held: boolean): void {
    this.held = held;
  }

  setReducedMotion(reduced: boolean): void {
    this.motionScale = reduced ? 0.35 : 1;
  }

  advanceTo(timestamp: number): EncounterUpdate {
    if (this.lastStepAt === null) this.lastStepAt = timestamp;
    const elapsed = Math.max(0, Math.min(1000, timestamp - this.lastStepAt));
    this.lastStepAt = timestamp;
    this.accumulator += elapsed;
    let steps = 0;
    while (this.accumulator >= STEP_MS && steps++ < MAX_STEPS) {
      this.step(STEP_MS / 1000, timestamp - this.accumulator + STEP_MS);
      this.accumulator -= STEP_MS;
    }
    if (steps >= MAX_STEPS) this.accumulator = 0;

    const previous = this.phase;
    if (this.held) return { gestures: [], state: this.snapshot(timestamp) };
    this.phase = this.resolvePhase(timestamp);
    return {
      gestures: [],
      previousPhase: previous === this.phase ? undefined : previous,
      state: this.snapshot(timestamp),
    };
  }

  getHistory(): readonly GestureEvent[] {
    return this.history;
  }

  snapshot(timestamp: number): ExpressiveState {
    return {
      version: 1,
      timestamp,
      phase: this.phase,
      energy: this.energy,
      residue: this.residue,
      recall: this.recall * this.motionScale,
      anticipation: this.anticipation * this.motionScale,
      spatialBreadth: Math.min(1, this.residue * 0.7 + (this.phase === 'collectiveFlight' ? 0.45 : 0)),
      rootLoad: Math.min(0.32, this.vane * 0.28 + this.recall * 0.08) * this.motionScale,
      vaneLoad: Math.min(1, this.vane + this.recall * 0.45) * this.motionScale,
      fringeLoad: Math.min(1, this.fringe + this.recall * 0.28) * this.motionScale,
      settling: Math.max(0, Math.min(1, 1 - this.energy + this.residue * 0.25)),
    };
  }

  private step(dt: number, timestamp: number): void {
    if (this.held) return;
    let target = 0;
    for (const value of this.levels.values()) target = Math.max(target, Math.min(1, value));
    if (this.forceSettle) target = 0;
    this.energy += (target - this.energy) * (1 - Math.exp(-dt / (target > this.energy ? 0.045 : 0.55)));
    this.fringe += (target - this.fringe) * (1 - Math.exp(-dt / (target > this.fringe ? 0.025 : 0.8)));
    const vaneTarget = Math.max(0, target - 0.08);
    this.vane += (vaneTarget - this.vane) * (1 - Math.exp(-dt / (vaneTarget > this.vane ? 0.14 : 1.1)));
    this.residue *= Math.exp(-dt / 24);
    while (this.recallQueue.length && this.recallQueue[0].at <= timestamp) {
      this.recall = Math.max(this.recall, this.recallQueue.shift()!.strength);
    }
    this.recall *= Math.exp(-dt / 0.48);
    if (this.forceSettle && this.energy < 0.005 && this.residue < 0.01) this.forceSettle = false;
    this.anticipation = this.predictAnticipation(timestamp);
  }

  private predictAnticipation(timestamp: number): number {
    const recent = this.history.slice(-4);
    if (recent.length < 3 || this.active.size) return 0;
    const intervals = recent.slice(1).map((gesture, index) => gesture.onset - recent[index].onset);
    const mean = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
    if (mean < 250 || mean > 5000) return 0;
    const deviation = Math.sqrt(intervals.reduce((sum, value) => sum + (value - mean) ** 2, 0) / intervals.length);
    if (deviation / mean > 0.18) return 0;
    const next = recent.at(-1)!.onset + mean;
    const lead = next - timestamp;
    return lead >= 0 && lead <= 280 ? (1 - lead / 280) * 0.18 : 0;
  }

  private resolvePhase(timestamp: number): EncounterPhase {
    if (this.forceSettle) return this.energy > 0.01 || this.residue > 0.01 ? 'settling' : 'rest';
    const recent = this.history.filter((gesture) => timestamp - gesture.onset < 20_000);
    if (recent.length >= 4 && this.residue > 0.35) return 'collectiveFlight';
    if (this.active.size || this.energy > 0.12) return recent.length >= 2 ? 'awakening' : 'breath';
    if (timestamp - this.lastInputAt < 1400 && this.fringe > 0.03) return 'settling';
    if ((this.residue > 0.06 && recent.length) || this.recall > 0.01) return 'rememberedEncounter';
    if (this.presence) return 'presence';
    return 'rest';
  }

  private scheduleRecall(timestamp: number): void {
    const sequence = this.history.slice(-3);
    if (sequence.length < 3 || sequence.at(-1)!.id === this.lastRecallGestureId) return;
    this.lastRecallGestureId = sequence.at(-1)!.id;
    const first = sequence[0].onset;
    const span = sequence.at(-1)!.onset - first;
    if (span > 7000) return;
    const base = timestamp + 1800;
    this.recallQueue = sequence.map((gesture) => ({
      at: base + gesture.onset - first,
      strength: Math.min(0.28, gesture.strength * 0.28),
    }));
  }
}
