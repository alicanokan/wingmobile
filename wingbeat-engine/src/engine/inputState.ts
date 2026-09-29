import type { CalibratedInputSample, InputSource, NodeId } from './types.ts';

export const INPUT_STALE_MS = 8000;
export interface InputLevels { wind: number; motion: number; present: boolean }
interface SourceState extends InputLevels { seenAt: number; windAt: number; motionAt: number }

/** Sources share a physical part without one source's release erasing another. */
export class InputState {
  private nodes = new Map<NodeId, Map<InputSource, SourceState>>();

  ingest(sample: CalibratedInputSample): InputLevels {
    let sources = this.nodes.get(sample.nodeId);
    if (!sources) this.nodes.set(sample.nodeId, sources = new Map());
    let state = sources.get(sample.source);
    if (!state) sources.set(sample.source, state = { wind: 0, motion: 0, present: false, seenAt: sample.timestamp, windAt: -Infinity, motionAt: -Infinity });
    state.seenAt = sample.timestamp;
    if (sample.kind === 'presence') state.present = sample.value >= 0.5;
    else {
      state[sample.kind] = Math.max(0, Math.min(sample.kind === 'motion' ? 1.5 : 1, sample.value));
      state[sample.kind === 'wind' ? 'windAt' : 'motionAt'] = sample.timestamp;
    }
    return this.levels(sample.nodeId);
  }

  levels(id: NodeId): InputLevels {
    const result = { wind: 0, motion: 0, present: false };
    for (const state of this.nodes.get(id)?.values() ?? []) {
      result.wind = Math.max(result.wind, state.wind);
      result.motion = Math.max(result.motion, state.motion);
      result.present ||= state.present;
    }
    return result;
  }

  dropNode(id: NodeId): void { this.nodes.delete(id); }

  dropSource(source: InputSource): NodeId[] {
    const changed: NodeId[] = [];
    for (const [id, sources] of this.nodes) {
      if (sources.delete(source)) changed.push(id);
      if (!sources.size) this.nodes.delete(id);
    }
    return changed;
  }

  expire(now: number): NodeId[] {
    const changed = new Set<NodeId>();
    for (const [id, sources] of this.nodes) {
      for (const [source, state] of sources) {
        if (now - state.seenAt > INPUT_STALE_MS) {
          sources.delete(source);
          changed.add(id);
          continue;
        }
        // Presence is edge-triggered in the firmware; fresh samples from this
        // source keep it alive. Wind/motion must renew their own measurements.
        for (const kind of ['wind', 'motion'] as const) {
          if (state[kind] && now - state[kind === 'wind' ? 'windAt' : 'motionAt'] > INPUT_STALE_MS) {
            state[kind] = 0;
            changed.add(id);
          }
        }
      }
      if (!sources.size) this.nodes.delete(id);
    }
    return [...changed];
  }
}
