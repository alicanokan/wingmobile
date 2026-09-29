export const MIN_BPM = 30;
export const MAX_BPM = 240;
export const clampBpm = (value: number) => Number.isFinite(value) ? Math.min(MAX_BPM, Math.max(MIN_BPM, value)) : 120;
export const loopOffset = (beats: number, sourceBpm: number, duration: number) => duration > 0 ? ((beats * 60 / sourceBpm) % duration + duration) % duration : 0;
/** Offline counterpart of AudioBufferSourceNode.playbackRate, for WAV export. */
export function resampleLoop(channels: Float32Array[], sourceRate: number, rate: number, frames: number, outputRate: number): Float32Array {
  const result = new Float32Array(frames);
  const length = channels[0]?.length ?? 0;
  if (!length) return result;
  for (let i = 0; i < frames; i++) {
    const position = (i * rate * sourceRate / outputRate) % length;
    const a = Math.floor(position), b = (a + 1) % length, fraction = position - a;
    for (const channel of channels) result[i] += (channel[a] * (1 - fraction) + channel[b] * fraction) / channels.length;
  }
  return result;
}
