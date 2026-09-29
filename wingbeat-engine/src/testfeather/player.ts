import type { SoundFeather } from './catalog.ts';
import { effectiveGains, mixWav, type RenderedStudy } from './synthesis.ts';
import { clampBpm, loopOffset, resampleLoop } from './audioTiming.ts';
export interface UploadedLayer { name: string; buffer: AudioBuffer; bpm: number }
interface Selection { bpm: number; uploads: Array<UploadedLayer | null> }
interface VoiceSlot { source: AudioBufferSourceNode; gate: GainNode; buffer: AudioBuffer; sourceBpm: number }
/** One beat clock; uploads replace a source before the same gain and analyser. */
export class StudyPlayer {
  private context?: AudioContext;
  private master?: GainNode;
  private voices: Array<VoiceSlot | undefined> = [];
  private retiring = new Set<VoiceSlot>();
  private gains: GainNode[] = [];
  private analysers: AnalyserNode[] = [];
  private waveform = new Float32Array(512);
  private worker?: Worker;
  private cancelJob?: () => void;
  private generation = 0;
  private uploadTokens = new Map<string, number>();
  private disposed = false;
  private selections = new Map<string, Selection>();
  private recipe?: SoundFeather;
  private rendered?: RenderedStudy;
  private renderedId?: string;
  private buffers: AudioBuffer[] = [];
  private clockTime = 0;
  private clockBeats = 0;
  private enabled = false;
  volumes = [0.75, 0.78, 0.65, 0.6, 0.78];
  muted = [false, false, false, false, false];
  solo = -1;
  masterVolume = 0.4;
  get active() { return this.enabled && this.context?.state === 'running'; }
  get progress() { return this.active && this.recipe ? (this.beatsAt(this.context!.currentTime) % (this.recipe.beats * 4)) / (this.recipe.beats * 4) : 0; }
  get preparedId() { return this.renderedId; }
  selection(recipe: SoundFeather): Selection {
    let selection = this.selections.get(recipe.id);
    if (!selection) { selection = { bpm: recipe.bpm, uploads: Array(5).fill(null) }; this.selections.set(recipe.id, selection); }
    return selection;
  }
  private getContext() {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      const limiter = this.context.createDynamicsCompressor();
      limiter.threshold.value = -5; limiter.knee.value = 8; limiter.ratio.value = 10;
      this.master.connect(limiter); limiter.connect(this.context.destination);
    }
    return this.context;
  }
  private beatsAt(time: number) {
    return this.clockBeats + Math.max(0, time - this.clockTime) * (this.recipe ? this.selection(this.recipe).bpm : 120) / 60;
  }
  setBpm(recipe: SoundFeather, value: number) {
    const selection = this.selection(recipe), bpm = clampBpm(value);
    if (this.enabled && this.recipe?.id === recipe.id && this.context) {
      const at = Math.max(this.context.currentTime, this.clockTime);
      this.clockBeats = this.beatsAt(at); this.clockTime = at;
      this.voices.forEach(voice => voice?.source.playbackRate.setValueAtTime(bpm / voice.sourceBpm, at));
    }
    selection.bpm = bpm;
  }
  async start(recipe: SoundFeather): Promise<boolean> {
    this.stop();
    this.recipe = recipe; this.selection(recipe);
    this.rendered = undefined; this.renderedId = undefined; this.buffers = [];
    const generation = this.generation;
    const context = this.getContext();
    await context.resume();
    if (generation !== this.generation) return false;
    const rendered = await new Promise<RenderedStudy | null>((resolve, reject) => {
      const worker = new Worker(new URL('./synthesis.worker.ts', import.meta.url), { type: 'module' });
      this.worker = worker; this.cancelJob = () => resolve(null);
      worker.onmessage = (event: MessageEvent<{ rendered?: RenderedStudy; error?: string }>) => {
        if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.rendered ?? null);
      };
      worker.onerror = () => reject(new Error('The audio study could not load. Please try again.'));
      worker.postMessage(recipe);
    }).finally(() => {
      if (generation === this.generation) { this.worker?.terminate(); this.worker = undefined; this.cancelJob = undefined; }
    });
    if (!rendered || generation !== this.generation) return false;
    this.rendered = rendered; this.renderedId = recipe.id;
    this.clockTime = context.currentTime + 0.045; this.clockBeats = 0;
    rendered.stems.forEach(stem => {
      const buffer = context.createBuffer(1, stem.length, rendered.sampleRate);
      buffer.copyToChannel(stem as Float32Array<ArrayBuffer>, 0); this.buffers.push(buffer);
      const gain = context.createGain(); const analyser = context.createAnalyser(); analyser.fftSize = 512;
      gain.connect(analyser); analyser.connect(this.master!);
      this.gains.push(gain); this.analysers.push(analyser);
    });
    this.applyMix(true);
    this.enabled = true;
    for (let i = 0; i < 5; i++) this.replaceVoice(i, this.clockTime);
    return true;
  }
  private releaseVoice(voice: VoiceSlot) {
    voice.source.disconnect(); voice.gate.disconnect(); this.retiring.delete(voice);
  }
  private replaceVoice(index: number, when = this.context!.currentTime + 0.015) {
    if (!this.enabled || !this.context || !this.recipe || !this.buffers[index]) return;
    when = Math.max(when, this.clockTime);
    const selection = this.selection(this.recipe), upload = selection.uploads[index];
    const buffer = upload?.buffer ?? this.buffers[index], sourceBpm = upload?.bpm ?? this.recipe.bpm;
    const source = this.context.createBufferSource(), gate = this.context.createGain();
    source.buffer = buffer; source.loop = true;
    source.playbackRate.value = selection.bpm / sourceBpm;
    source.connect(gate); gate.connect(this.gains[index]);
    const previous = this.voices[index];
    if (previous) {
      gate.gain.setValueAtTime(0, when); gate.gain.linearRampToValueAtTime(1, when + 0.02);
      previous.gate.gain.cancelScheduledValues(when); previous.gate.gain.setValueAtTime(1, when);
      previous.gate.gain.linearRampToValueAtTime(0, when + 0.02);
      this.retiring.add(previous);
      previous.source.onended = () => this.releaseVoice(previous);
      previous.source.stop(when + 0.025);
    }
    const voice = { source, gate, buffer, sourceBpm };
    this.voices[index] = voice;
    source.start(when, loopOffset(this.beatsAt(when), sourceBpm, buffer.duration));
  }
  async upload(recipe: SoundFeather, index: number, file: File): Promise<boolean> {
    if (!Number.isInteger(index) || index < 0 || index > 4) throw new Error('Choose one of the five layers.');
    const key = `${recipe.id}:${index}`, token = (this.uploadTokens.get(key) ?? 0) + 1;
    this.uploadTokens.set(key, token);
    if (file.size > 50 * 1024 * 1024) throw new Error('Choose an audio file smaller than 50 MB.');
    const context = this.getContext();
    let buffer: AudioBuffer;
    try { buffer = await context.decodeAudioData(await file.arrayBuffer()); }
    catch { if (this.disposed || this.uploadTokens.get(key) !== token) return false; throw new Error('This file could not be read. Try an MP3, WAV, OGG or M4A audio file.'); }
    if (this.disposed || this.uploadTokens.get(key) !== token) return false;
    if (!Number.isFinite(buffer.duration) || buffer.duration < 0.05 || buffer.duration > 300) throw new Error('Choose an audio clip between 0.05 seconds and 5 minutes.');
    this.selection(recipe).uploads[index] = { name: file.name, buffer, bpm: recipe.bpm };
    if (this.enabled && this.recipe?.id === recipe.id) this.replaceVoice(index);
    return true;
  }
  restore(recipe: SoundFeather, index: number) {
    const key = `${recipe.id}:${index}`;
    this.uploadTokens.set(key, (this.uploadTokens.get(key) ?? 0) + 1);
    this.selection(recipe).uploads[index] = null;
    if (this.enabled && this.recipe?.id === recipe.id) this.replaceVoice(index);
  }
  setClipBpm(recipe: SoundFeather, index: number, bpm: number) {
    const clip = this.selection(recipe).uploads[index]; if (!clip) return;
    clip.bpm = clampBpm(bpm);
    if (this.enabled && this.recipe?.id === recipe.id) this.replaceVoice(index);
  }
  applyMix(immediate = false) {
    if (!this.context) return;
    const values = effectiveGains(this.volumes, this.muted, this.solo);
    this.gains.forEach((node,i) => {
      node.gain.cancelScheduledValues(this.context!.currentTime);
      if (immediate) node.gain.value = values[i]; else node.gain.setTargetAtTime(values[i],this.context!.currentTime,0.012);
    });
    this.master?.gain.setTargetAtTime(this.masterVolume,this.context.currentTime,0.012);
  }
  read(): number[] {
    if (!this.active) return [0,0,0,0,0];
    return this.analysers.map(analyser => {
      analyser.getFloatTimeDomainData(this.waveform);
      let energy = 0; for (const v of this.waveform) energy += v*v;
      return 1 - Math.exp(-Math.sqrt(energy / this.waveform.length) * this.masterVolume * 12);
    });
  }
  export(): ArrayBuffer | null {
    if (!this.rendered || !this.recipe || this.renderedId !== this.recipe.id) return null;
    const selection = this.selection(this.recipe), sampleRate = this.rendered.sampleRate;
    const duration = this.recipe.beats * 4 * 60 / selection.bpm, frames = Math.round(duration * sampleRate);
    const stems = this.rendered.stems.map((stem,i) => {
      const clip = selection.uploads[i];
      return resampleLoop(clip ? Array.from({length:clip.buffer.numberOfChannels},(_,c)=>clip.buffer.getChannelData(c)) : [stem],
        clip?.buffer.sampleRate ?? sampleRate, selection.bpm / (clip?.bpm ?? this.recipe!.bpm), frames, sampleRate);
    });
    return mixWav({stems,sampleRate,duration},effectiveGains(this.volumes,this.muted,this.solo),this.masterVolume);
  }
  stop() {
    ++this.generation; this.enabled = false;
    this.worker?.terminate(); this.worker = undefined;
    this.cancelJob?.(); this.cancelJob = undefined;
    for (const voice of [...this.voices, ...this.retiring]) if (voice) {
      voice.source.onended = null;
      try { voice.source.stop(); } catch {} this.releaseVoice(voice);
    }
    this.gains.forEach(node=>node.disconnect()); this.analysers.forEach(node=>node.disconnect());
    this.voices=[]; this.retiring.clear(); this.gains=[]; this.analysers=[];
  }
  dispose() {
    this.disposed=true; this.uploadTokens.clear(); this.stop();
    void this.context?.close(); this.context=undefined; this.master=undefined;
    this.selections.clear(); this.buffers=[]; this.rendered=undefined;
  }
}
