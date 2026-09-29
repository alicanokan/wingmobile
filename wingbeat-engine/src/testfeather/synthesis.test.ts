import { describe, expect, it } from 'vitest';
import { FEATHERS } from '../sim/feathers.ts';
import { SOUND_FEATHERS, CONTINENTS, atlasCsv } from './catalog.ts';
import { renderStudy, effectiveGains, mixWav } from './synthesis.ts';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

describe('feather sound atlas',()=>{
  it('covers every real feather once, with five usable layers and local images',()=>{
    const ids=SOUND_FEATHERS.map(f=>f.id);
    expect([...ids].sort()).toEqual(FEATHERS.filter(f=>!f.procedural).map(f=>f.id).sort());
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(SOUND_FEATHERS.map(f=>f.style)).size).toBe(ids.length);
    expect(new Set(SOUND_FEATHERS.map(f=>f.continent))).toEqual(new Set(CONTINENTS));
    for(const f of SOUND_FEATHERS){
      expect(f.layers).toHaveLength(5); expect(f.voices).toHaveLength(4);
      expect(existsSync(`public/feathers/${f.id}.png`)).toBe(true);
      expect(existsSync(`public/feathers/thumbs/${f.id}.png`)).toBe(true);
    }
    expect(atlasCsv().split('\r\n')).toHaveLength(45);
  });
  it('renders 44 different, bounded loops with sound on every stem',()=>{
    const hashes=new Set();
    for(const f of SOUND_FEATHERS){
      // Production sample rate catches aliasing-sized discontinuities and real output bounds.
      const audio=renderStudy(f);
      expect(audio.stems).toHaveLength(5);
      expect(audio.duration).toBeCloseTo(4*f.beats*60/f.bpm,3);
      const hash=createHash('sha256');
      for(const stem of audio.stems){
        let energy=0,peak=0,maxStep=0,previous=stem.at(-1)!;
        for(const v of stem){energy+=v*v;peak=Math.max(peak,Math.abs(v));maxStep=Math.max(maxStep,Math.abs(v-previous));previous=v;}
        expect(Number.isFinite(energy)).toBe(true);
        expect(Math.sqrt(energy/stem.length)).toBeGreaterThan(0.005);
        expect(peak).toBeLessThan(0.82);
        // No wrap click: the boundary jump stays below 0.12 full-scale.
        expect(Math.abs(stem[0]-stem.at(-1)!)).toBeLessThan(0.12);
        hash.update(new Uint8Array(stem.buffer));
      }
      hashes.add(hash.digest('hex'));
    }
    expect(hashes.size).toBe(44);
  },20000);
  it('keeps all stems aligned and renders repeatably',()=>{
    const a=renderStudy(SOUND_FEATHERS[0],8000),b=renderStudy(SOUND_FEATHERS[0],8000);
    expect(a.stems).toEqual(b.stems);
    expect(new Set(a.stems.map(s=>s.length)).size).toBe(1);
  });
  it('exports precisely the chosen solo/mute mix and valid silent PCM when muted',()=>{
    const study=renderStudy(SOUND_FEATHERS[0],8000);
    const volumes=[0.5,0.5,0.5,0.5,0.5];
    const solo=effectiveGains(volumes,[false,false,false,false,false],2);
    expect(solo).toEqual([0,0,0.5,0,0]);
    expect(effectiveGains(volumes,[false,false,true,false,false],2)).toEqual([0,0,0,0,0]);
    const wav=new DataView(mixWav(study,solo,0.4));
    expect(wav.getUint32(24,true)).toBe(8000);
    expect(wav.getUint32(40,true)).toBe(study.stems[0].length*2);
    for(let i=0;i<study.stems[0].length;i+=137){expect(wav.getInt16(44+i*2,true)).toBe(Math.round(study.stems[2][i]*0.5*0.4*32767) || 0);}
    const silent=new Uint8Array(mixWav(study,[0,0,0,0,0],0.4));
    expect(silent.slice(44).every(v=>v===0)).toBe(true);
  });
});
