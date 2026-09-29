/** Discrete FL / FR / BL / BR output. Each source has its own room position. */
export const SPEAKER_LABELS = ['Front left', 'Front right', 'Back left', 'Back right'] as const;

export function speakerAmplitudes(weights: readonly number[]): number[] {
  const safe = Array.from({ length: 4 }, (_, i) => Number.isFinite(weights[i]) ? Math.max(0, weights[i]) : 0);
  const sum = safe.reduce((a, b) => a + b, 0);
  return safe.map((w) => Math.sqrt(sum ? w / sum : 0.25));
}

export class SpeakerOutput {
  private readonly nodes: AudioNode[] = [];
  private readonly sources = new Map<string, { gains: GainNode[]; mono: GainNode; detach: () => void }>();
  private readonly merger: ChannelMergerNode;
  private readonly master: GainNode;
  private readonly gate: GainNode;
  private readonly hp: BiquadFilterNode;
  private readonly lp: BiquadFilterNode;
  private readonly delay: DelayNode;
  private readonly feedback: GainNode;
  private readonly delayWet: GainNode;
  private readonly delayDry: GainNode;
  private readonly reverbWet: GainNode;
  private readonly reverbDry: GainNode;
  enabled = false;

  constructor(private readonly context: AudioContext) {
    const keep = <T extends AudioNode>(node: T): T => { this.nodes.push(node); return node; };
    const gain = (level: number) => {
      const node = keep(context.createGain());
      node.gain.value = level;
      node.channelCount = 4;
      node.channelCountMode = 'explicit';
      node.channelInterpretation = 'discrete';
      return node;
    };
    this.merger = keep(context.createChannelMerger(4));
    this.master = gain(0.7);
    this.gate = gain(0);
    this.hp = keep(context.createBiquadFilter()); this.hp.type = 'highpass'; this.hp.frequency.value = 20;
    this.lp = keep(context.createBiquadFilter()); this.lp.type = 'lowpass'; this.lp.frequency.value = 18000;
    this.delay = keep(context.createDelay(2)); this.delay.delayTime.value = 0.25;
    this.feedback = gain(0.25);
    this.delayWet = gain(0); this.delayDry = gain(1);
    this.reverbWet = gain(0); this.reverbDry = gain(1);
    const delayed = gain(1);
    this.merger.connect(this.master); this.master.connect(this.hp); this.hp.connect(this.lp);
    this.lp.connect(this.delayDry); this.delayDry.connect(delayed);
    this.lp.connect(this.delay); this.delay.connect(this.feedback); this.feedback.connect(this.delay);
    this.delay.connect(this.delayWet); this.delayWet.connect(delayed);
    delayed.connect(this.reverbDry); this.reverbDry.connect(this.gate);

    // One mono convolver per physical channel preserves source position.
    // A shared stereo reverb would fold the back speakers into the front pair.
    const split = keep(context.createChannelSplitter(4));
    const wet = keep(context.createChannelMerger(4));
    const impulse = context.createBuffer(1, Math.ceil(context.sampleRate * 6), context.sampleRate);
    const data = impulse.getChannelData(0);
    let seed = 761;
    for (let i = 0; i < data.length; i++) {
      seed = (1664525 * seed + 1013904223) >>> 0;
      data[i] = (seed / 0xffffffff * 2 - 1) * Math.exp(-i / context.sampleRate);
    }
    delayed.connect(split);
    for (let i = 0; i < 4; i++) {
      const reverb = keep(context.createConvolver()); reverb.buffer = impulse;
      split.connect(reverb, i); reverb.connect(wet, 0, i);
    }
    wet.connect(this.reverbWet); this.reverbWet.connect(this.gate);
    this.gate.connect(context.destination);
  }

  addSource(id: string, attach: (target: AudioNode) => () => void, weights: readonly number[]): void {
    this.removeSource(id);
    const mono = this.context.createGain();
    mono.channelCount = 1; mono.channelCountMode = 'explicit'; mono.channelInterpretation = 'speakers';
    const amplitudes = speakerAmplitudes(weights);
    const gains = amplitudes.map((v, i) => {
      const gain = this.context.createGain(); gain.gain.value = v;
      mono.connect(gain); gain.connect(this.merger, 0, i);
      return gain;
    });
    this.sources.set(id, { mono, gains, detach: attach(mono) });
  }

  position(id: string, weights: readonly number[]): void {
    const source = this.sources.get(id);
    if (!source) return;
    speakerAmplitudes(weights).forEach((v, i) => source.gains[i].gain.setTargetAtTime(v, this.context.currentTime, 0.04));
  }

  removeSource(id: string): void {
    const source = this.sources.get(id);
    if (!source) return;
    source.detach(); source.mono.disconnect(); source.gains.forEach((g) => g.disconnect());
    this.sources.delete(id);
  }

  setEnabled(enabled: boolean): void {
    if (enabled && this.context.destination.maxChannelCount < 4) throw new Error('Four-speaker output needs an audio interface with at least four channels. Stereo is still active.');
    // Validate before changing either output gate.
    if (enabled) this.context.destination.channelCount = 4;
    this.context.destination.channelInterpretation = 'discrete';
    this.enabled = enabled;
    this.gate.gain.setTargetAtTime(enabled ? 1 : 0, this.context.currentTime, 0.025);
  }

  setMaster(value: number, seconds = 0.04): void {
    this.master.gain.setTargetAtTime(Math.max(0, Math.min(1, value)), this.context.currentTime, seconds);
  }

  effects(fx: { delay: number; reverb: number; highpass: number; lowpass: number }, reverb: number, bpm: number): void {
    const now = this.context.currentTime;
    const set = (p: AudioParam, value: number) => p.setTargetAtTime(value, now, 0.04);
    set(this.hp.frequency, 20 * (3800 / 20) ** fx.highpass);
    set(this.lp.frequency, 18000 * (160 / 18000) ** fx.lowpass);
    set(this.delay.delayTime, 30 / Math.max(40, bpm));
    set(this.feedback.gain, 0.25 + fx.delay * 0.35);
    const delay = Math.min(0.65, fx.delay * 0.65);
    set(this.delayWet.gain, Math.sin(delay * Math.PI / 2)); set(this.delayDry.gain, Math.cos(delay * Math.PI / 2));
    const wet = Math.max(0, Math.min(1, Math.max(fx.reverb, reverb)));
    set(this.reverbWet.gain, Math.sin(wet * Math.PI / 2)); set(this.reverbDry.gain, Math.cos(wet * Math.PI / 2));
  }

  dispose(): void {
    for (const id of this.sources.keys()) this.removeSource(id);
    this.nodes.forEach((node) => node.disconnect());
  }
}
