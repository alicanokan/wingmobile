import type { CalibratedInputSample, GestureTrace } from './types.ts';

export class GestureTraceRecorder {
  private samples: CalibratedInputSample[] = [];
  private startedAt = 0;

  start(timestamp: number): void {
    this.startedAt = timestamp;
    this.samples = [];
  }

  record(sample: CalibratedInputSample): void {
    if (!sample.valid) return;
    if (!this.startedAt) this.startedAt = sample.timestamp;
    this.samples.push({ ...sample, timestamp: sample.timestamp - this.startedAt });
  }

  export(): GestureTrace {
    return { version: 1, startedAt: this.startedAt, samples: this.samples.map((sample) => ({ ...sample })) };
  }
}

export function validateGestureTrace(value: unknown): value is GestureTrace {
  if (!value || typeof value !== 'object') return false;
  const trace = value as Partial<GestureTrace>;
  return trace.version === 1
    && Number.isFinite(trace.startedAt)
    && Array.isArray(trace.samples)
    && trace.samples.every((sample) =>
      sample?.version === 1
      && typeof sample.nodeId === 'string'
      && ['wind', 'motion', 'presence'].includes(sample.kind)
      && ['simulation', 'mqtt', 'microphone', 'camera', 'touch', 'replay'].includes(sample.source)
      && Number.isFinite(sample.value)
      && Number.isFinite(sample.timestamp)
      && typeof sample.valid === 'boolean',
    );
}

/** Synchronous replay keeps tests and offline authoring independent of wall-clock time. */
export function replayGestureTrace(
  trace: GestureTrace,
  ingest: (sample: CalibratedInputSample) => void,
  onTime?: (timestamp: number) => void,
): void {
  if (!validateGestureTrace(trace)) throw new Error('Unsupported or invalid Wing Beat gesture trace');
  for (const sample of trace.samples) {
    const replayed = { ...sample, source: 'replay' as const };
    ingest(replayed);
    onTime?.(replayed.timestamp);
  }
}

export function replayGestureTraceRealtime(
  trace: GestureTrace,
  ingest: (sample: CalibratedInputSample) => void,
  now: () => number = () => performance.now(),
): () => void {
  if (!validateGestureTrace(trace)) throw new Error('Unsupported or invalid Wing Beat gesture trace');
  const base = now();
  const timers = trace.samples.map((sample) => setTimeout(() => {
    ingest({ ...sample, source: 'replay', timestamp: base + sample.timestamp });
  }, Math.max(0, sample.timestamp)));
  return () => timers.forEach((timer) => clearTimeout(timer));
}
