export const LOOP_SECONDS = 16;
export const STEM_NAMES = ['Drums', 'Bass', 'Chords', 'Melody', 'Texture'];
export const LOOP_STYLES = [
  { name: 'Ambient', bpm: 60, feather: 'air-study', root: 45, swing: 0, drive: .25 },
  { name: 'Lo-fi', bpm: 90, feather: '01f', root: 48, swing: .18, drive: .6 },
  { name: 'House', bpm: 120, feather: '02f', root: 43, swing: 0, drive: .85 },
  { name: 'Techno', bpm: 120, feather: '04f', root: 40, swing: 0, drive: 1 },
  { name: 'Drum & bass', bpm: 180, feather: '05f', root: 38, swing: 0, drive: .95 },
  { name: 'Hip-hop', bpm: 90, feather: '06f', root: 41, swing: .12, drive: .8 },
  { name: 'Jazz electronica', bpm: 120, feather: '07f', root: 46, swing: .28, drive: .5 },
  { name: 'Dub', bpm: 90, feather: '08f', root: 36, swing: .08, drive: .7 },
  { name: 'Synthwave', bpm: 120, feather: '09f', root: 45, swing: 0, drive: .8 },
  { name: 'Broken beat', bpm: 150, feather: '10f', root: 42, swing: .1, drive: .85 },
];

/** Original deterministic compositions; all five stems share a sample clock. */
export function renderMusicLoop(styleIndex: number, rate = 22050): Float32Array[] {
  const style = LOOP_STYLES[styleIndex];
  if (!style) throw new Error('Unknown music style');
  const count = Math.round(rate * LOOP_SECONDS);
  const stems = Array.from({ length: 5 }, () => new Float32Array(count));
  let seed = 137 + styleIndex * 4099;
  const noise = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 2147483648 - 1; };
  const hz = (note: number) => 440 * 2 ** ((note - 69) / 12);
  const add = (channel: number, at: number, duration: number, voice: (t: number) => number) => {
    const start = Math.round(at * rate), length = Math.round(duration * rate);
    for (let i = 0; i < length; i++) {
      const t = i / rate;
      // Wrap release tails to the beginning so every stem loops continuously.
      stems[channel][(start + i) % count] += voice(t) * Math.min(1, i / Math.max(1, rate * .003)) * Math.min(1, (length - i) / Math.max(1, rate * .012));
    }
  };
  const beat = 60 / style.bpm, bars = Math.round(LOOP_SECONDS / (beat * 4));
  const progression = styleIndex === 6 ? [0, 5, 2, 7] : [0, 7, 3, 5];
  for (let bar = 0; bar < bars; bar++) {
    const root = style.root + progression[bar % 4];
    for (let step = 0; step < 16; step++) {
      const at = bar * beat * 4 + (step / 4 + (step % 2 ? style.swing / 4 : 0)) * beat;
      const four = [2, 3, 8].includes(styleIndex);
      const kick = four ? step % 4 === 0 : [0, styleIndex === 4 ? 10 : 7].includes(step);
      if (kick && (styleIndex !== 0 || bar % 2 === 0)) add(0, at, .42, t => Math.sin(2 * Math.PI * (46 * t + 7 * (1 - Math.exp(-t * 35)))) * Math.exp(-t * 13) * style.drive);
      if ([4, 12].includes(step) && styleIndex !== 0) add(0, at, .18, t => (noise() * .55 + Math.sin(t * 1100) * .18) * Math.exp(-t * 26) * style.drive);
      if (step % (styleIndex === 4 ? 1 : 2) === 0) add(0, at, .055, t => noise() * Math.exp(-t * 65) * .14 * style.drive);
      if (step % (styleIndex === 0 ? 8 : 4) === 0 || (styleIndex === 9 && step === 11)) {
        const f = hz(root + (step === 12 ? 7 : 0));
        add(1, at, beat * .8, t => Math.tanh((Math.sin(2 * Math.PI * f * t) + .25 * Math.sin(4 * Math.PI * f * t)) * 1.2) * Math.exp(-t * (styleIndex === 7 ? 2 : 5)) * .5);
      }
      const leadStep = styleIndex === 0 ? step === 2 : (step + bar) % (styleIndex === 3 ? 2 : 3) === 0;
      if (leadStep) {
        const scale = [0, 3, 7, 10, 12, 14, 15, 19];
        const f = hz(root + 24 + scale[(step + bar * 2 + styleIndex) % scale.length]);
        add(3, at, beat * 1.4, t => Math.sin(2 * Math.PI * f * t + Math.sin(2 * Math.PI * f * 2 * t) * Math.exp(-t * 8) * (styleIndex === 6 ? 2 : .5)) * Math.exp(-t * (styleIndex === 0 ? 2 : 7)) * .27);
      }
    }
    const chordAt = bar * 4 * beat + (styleIndex === 7 ? beat : 0);
    const chordLength = [2, 7].includes(styleIndex) ? beat * .5 : beat * 3.8;
    for (const interval of [0, styleIndex === 6 ? 4 : 3, 7, 10]) {
      const f = hz(root + 12 + interval);
      add(2, chordAt, chordLength, t => (Math.sin(2 * Math.PI * f * t) + .2 * Math.sin(2 * Math.PI * f * 1.003 * t)) * Math.sin(Math.PI * t / chordLength) * .095);
    }
    const f = hz(root + 36);
    add(4, bar * 4 * beat, beat * 4.5, t => (Math.sin(2 * Math.PI * f * t) * .06 + noise() * .025) * Math.sin(Math.PI * t / (beat * 4.5)) ** 2 * (.65 + .35 * Math.sin(t * 3)));
  }
  // Fixed gain preserves arrangement dynamics; bound peaks without clipping.
  for (const stem of stems) {
    let peak = 0;
    for (const sample of stem) peak = Math.max(peak, Math.abs(sample));
    const gain = peak > .65 ? .65 / peak : 1;
    for (let i = 0; i < stem.length; i++) stem[i] *= gain;
  }
  return stems;
}

export const STEM_TARGETS = ['Rachis', 'Barbs', 'Little feathers', 'Patterns', 'Colours'];
export function channelGain(volume: number, muted: boolean, solo: number, index: number): number {
  return muted || (solo >= 0 && solo !== index) ? 0 : Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0));
}
export class MusicLoopPlayer {
  private context?: AudioContext;
  private sources: AudioBufferSourceNode[] = [];
  private gains: GainNode[] = [];
  private analysers: AnalyserNode[] = [];
  private scratch = new Float32Array(512);
  private revision = 0;
  volumes = [0.8, 0.8, 0.65, 0.65, 0.6];
  muted = [false, false, false, false, false];
  solo = -1;
  targets = [0, 1, 3, 4, 2];
  active = false;
  selected = 0;
  startedAt = 0;
  async play(index: number) {
    this.stop();
    const revision = ++this.revision;
    this.context ??= new AudioContext();
    await this.context.resume();
    if (revision !== this.revision) return;
    const stems = renderMusicLoop(index);
    const master = this.context.createGain(); master.gain.value = .28; master.connect(this.context.destination);
    const when = this.context.currentTime + .08;
    stems.forEach((samples, i) => {
      const buffer = this.context!.createBuffer(1, samples.length, 22050); buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
      const source = this.context!.createBufferSource(); source.buffer = buffer; source.loop = true; source.loopEnd = LOOP_SECONDS;
      const gain = this.context!.createGain();
      const analyser = this.context!.createAnalyser(); analyser.fftSize = 512;
      source.connect(gain); gain.connect(analyser); analyser.connect(master);
      this.sources[i] = source; this.gains[i] = gain; this.analysers[i] = analyser;
      source.onended = () => { source.disconnect(); gain.disconnect(); analyser.disconnect(); if (i === 4) master.disconnect(); };
      source.start(when);
    });
    this.selected = index; this.startedAt = when; this.active = true; this.update();
  }
  update() {
    this.gains.forEach((gain, i) => gain.gain.setTargetAtTime(channelGain(this.volumes[i], this.muted[i], this.solo, i), this.context!.currentTime, .015));
  }
  read() {
    if (!this.active) return [0, 0, 0, 0, 0];
    return this.analysers.map(analyser => {
      analyser.getFloatTimeDomainData(this.scratch);
      let sum = 0; for (const v of this.scratch) sum += v * v;
      return Math.min(1, Math.sqrt(sum / this.scratch.length) * 8);
    });
  }
  stop() { this.revision++; this.sources.forEach(s => { try { s.stop(); } catch { /* already stopped */ } }); this.sources = []; this.gains = []; this.analysers = []; this.active = false; }
  dispose() { this.stop(); void this.context?.close(); }
}
