import type { SoundFeather, Voice } from './catalog.ts';
export interface RenderedStudy { sampleRate: number; duration: number; stems: Float32Array[] }
const TAU = Math.PI * 2;
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
/** Original deterministic phrases. No recordings or traditional melodies are sampled. */
export function renderStudy(recipe: SoundFeather, sampleRate = 22050): RenderedStudy {
  const beat = 60 / recipe.bpm;
  const bar = beat * recipe.beats;
  const duration = bar * 4;
  const length = Math.round(duration * sampleRate);
  const stems = Array.from({ length: 5 }, () => new Float32Array(length));
  let seed = [...recipe.id + recipe.style].reduce((s, c) => Math.imul(s ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  const note = (degree: number, octave = 0) => hz(recipe.root + recipe.scale[((degree % recipe.scale.length) + recipe.scale.length) % recipe.scale.length] + 12 * (octave + Math.floor(degree / recipe.scale.length)));
  function add(stem: number, at: number, seconds: number, freq: number, voice: Voice | 'drum', amp: number) {
    const start = Math.round(at * sampleRate);
    const n = Math.max(2, Math.round(seconds * sampleRate));
    let air = 0;
    const phase = random() * TAU;
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate, p = i / n;
      const attack = Math.min(1, t / (voice === 'pad' || voice === 'bow' ? 0.12 : 0.006));
      const tail = Math.min(1, (seconds - t) / 0.035);
      const a = TAU * freq * t;
      let sound: number, env: number;
      switch (voice) {
        case 'drum':
          sound = Math.sin(TAU * (freq * t + 4 * (1 - Math.exp(-t * 28)))) * 0.8 + (random() * 2 - 1) * Math.exp(-t * 55) * 0.35;
          env = Math.exp(-t * 18); break;
        case 'wood':
          sound = Math.sin(a) * 0.7 + Math.sin(a * 2.76) * 0.25;
          env = Math.exp(-t * 22); break;
        case 'metal':
          sound = Math.sin(a) * 0.5 + Math.sin(a * 2.01) * 0.26 + Math.sin(a * 3.97) * 0.15 + Math.sin(a * 5.43) * 0.08;
          env = Math.exp(-p * 5); break;
        case 'tine':
          sound = Math.sin(a) * 0.75 + Math.sin(a * 3.01) * Math.exp(-t * 8) * 0.3;
          env = Math.exp(-p * 4.5); break;
        case 'pluck':
          sound = Math.sin(a) * 0.63 + Math.sin(a * 2) * 0.23 * Math.exp(-t * 4) + Math.sin(a * 3) * 0.13 * Math.exp(-t * 8);
          env = Math.exp(-p * 5); break;
        case 'flute':
          air = air * 0.78 + (random() * 2 - 1) * 0.22;
          sound = Math.sin(a + Math.sin(t * 30) * 0.04) * 0.78 + Math.sin(a * 2) * 0.08 + air * 0.2;
          env = Math.sin(Math.PI * p); break;
        case 'reed':
          sound = Math.sin(a + 0.05 * Math.sin(t * 32)) * 0.58 + Math.sin(a * 3) * 0.24 + Math.sin(a * 5) * 0.1;
          env = Math.sin(Math.PI * p) ** 0.5; break;
        case 'brass':
          sound = Math.sin(a) * 0.5 + Math.sin(a * 2) * 0.3 + Math.sin(a * 3) * 0.16;
          env = Math.sin(Math.PI * p) ** 0.6; break;
        case 'bow':
          sound = Math.sin(a + 0.07 * Math.sin(t * 28)) * 0.6 + Math.sin(a * 2.002) * 0.23 + Math.sin(a * 3) * 0.12;
          env = Math.sin(Math.PI * p); break;
        case 'noise':
          air = air * 0.96 + (random() * 2 - 1) * 0.04;
          sound = air * 3 + Math.sin(a) * 0.08;
          env = Math.sin(Math.PI * p) ** 2; break;
        default:
          sound = (Math.sin(a) + Math.sin(a * 1.002 + phase) * 0.4 + Math.sin(a * 2) * 0.16) * 0.55;
          env = Math.sin(Math.PI * p) ** 2;
      }
      // Wrap every release into the start of the buffer for a continuous loop.
      stems[stem][(start + i) % length] += sound * env * attack * tail * amp;
    }
  }
  const sparse = recipe.bpm < 75;
  for (let b = 0; b < 4; b++) {
    const offset = b * bar;
    const baseDegree = /drone|gamelan|Guqin|Koto|Mbira|Santur|Carnatic|Hindustani/i.test(recipe.style) ? 0 : [0, 2, 3, 0][b];
    [...recipe.pulse].forEach((hit, s) => {
      if (hit === '.') return;
      const time = offset + (s / recipe.pulse.length) * bar + (s % 2 ? recipe.swing * beat * 0.5 : 0);
      add(0,time,hit === 'x' ? 0.32 : 0.16,hit === 'x' ? 65 : 190,hit === 'x' ? 'drum' : 'wood',hit === 'x' ? 0.75 : 0.5);
    });
    for (let s = 0; s < recipe.beats; s++) {
      if (sparse && s % 2) continue;
      add(1,offset + s * beat,beat * 1.5,note(baseDegree + (s % 2 ? 4 : 0),-2),recipe.voices[0],0.53);
    }
    add(2,offset,bar * 1.8,note(baseDegree,-1),recipe.voices[1],0.18);
    add(2,offset + bar * 0.25,bar * 1.5,note(baseDegree + 4,-1),recipe.voices[1],0.11);
    for (let s = 0; s < recipe.beats * 2; s++) {
      if (sparse && s % 3 !== 1) continue;
      const at = offset + (s + 0.5 + (s % 2 ? recipe.swing : 0)) * beat / 2;
      add(3,at,beat * 0.9,note(baseDegree + (s * 2 + b) % recipe.scale.length,1),recipe.voices[2],s % 2 ? 0.24 : 0.34);
    }
    const motif = Array.from({ length: recipe.beats }, (_, s) => Math.floor(random() * recipe.scale.length) + (s === recipe.beats - 1 ? 0 : baseDegree));
    for (let s = 0; s < recipe.beats; s++) {
      if ((s + b) % (sparse ? 3 : 5) === 2) continue;
      const at = offset + (s + (s % 2 ? recipe.swing * 0.5 : 0)) * beat;
      add(4,at,beat * (sparse ? 2.5 : 1.35),note(motif[s]),recipe.voices[3],0.48);
      if (/dub/i.test(recipe.style)) {
        add(4,at + beat * 0.75,beat,note(motif[s]),recipe.voices[3],0.2);
        add(4,at + beat * 1.5,beat,note(motif[s]),recipe.voices[3],0.08);
      }
    }
  }
  for (const stem of stems) {
    let peak = 0, mean = 0;
    for (const v of stem) { peak = Math.max(peak, Math.abs(v)); mean += v; }
    mean /= stem.length;
    const scale = peak > 0.8 ? 0.8 / peak : 1;
    for (let i = 0; i < stem.length; i++) stem[i] = (stem[i] - mean) * scale;
  }
  return { sampleRate, duration: length / sampleRate, stems };
}
export function effectiveGains(volumes: number[], muted: boolean[], solo: number): number[] {
  return volumes.map((v, i) => muted[i] || (solo >= 0 && solo !== i) ? 0 : Math.min(1, Math.max(0, v)));
}
/** 16-bit PCM export of the selected mix, including Solo, Mute and master. */
export function mixWav(study: RenderedStudy, gains: number[], master: number): ArrayBuffer {
  const frames = study.stems[0].length;
  const bytes = new ArrayBuffer(44 + frames * 2);
  const view = new DataView(bytes);
  const ascii = (offset: number, s: string) => [...s].forEach((c,i) => view.setUint8(offset+i,c.charCodeAt(0)));
  ascii(0,'RIFF'); view.setUint32(4,36+frames*2,true); ascii(8,'WAVE'); ascii(12,'fmt ');
  view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
  view.setUint32(24,study.sampleRate,true); view.setUint32(28,study.sampleRate*2,true);
  view.setUint16(32,2,true); view.setUint16(34,16,true); ascii(36,'data'); view.setUint32(40,frames*2,true);
  for (let i=0;i<frames;i++) {
    const sum=study.stems.reduce((v,stem,s)=>v+stem[i]*(gains[s]??0),0)*master;
    view.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,sum))*32767),true);
  }
  return bytes;
}
