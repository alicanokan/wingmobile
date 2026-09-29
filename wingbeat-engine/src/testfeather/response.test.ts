import { describe,expect,it } from 'vitest';
import { defaultResponses,changeTarget,responseLevel,playChannel,colourDrive } from './response.ts';
import { clampBpm,loopOffset,resampleLoop } from './audioTiming.ts';
describe('visual response routing',()=>{
  it('keeps silence silent and lets sensitivity change only the visual level',()=>{
    for(const sensitivity of [0,0.5,1,2,4])expect(responseLevel(0,sensitivity)).toBe(0);
    expect(responseLevel(0.5,1)).toBe(0.5);expect(responseLevel(0.5,2)).toBe(0.75);expect(responseLevel(0.5,0)).toBe(0);
  });
  it('uses supported movements for each region and preserves other settings',()=>{
    const response={...defaultResponses()[2],sensitivity:2,amount:0.3};
    const shaft=changeTarget(response,'shaft');expect(shaft.effect).toBe('wave');expect(shaft.sensitivity).toBe(2);
    expect(playChannel(shaft,0.5)).toMatchObject({part:'rachis',mode:6,strength:0.15});
    expect(changeTarget(response,'colour').effect).toBe('shift');
  });
  it('has no hidden colour route when disabled or assigned elsewhere',()=>{
    const responses=defaultResponses(),levels=[1,1,1,1,1];expect(colourDrive(responses,levels,1)).toBe(1);
    responses[4].effect='off';expect(colourDrive(responses,levels,1)).toBe(0);
    responses[4]=changeTarget(defaultResponses()[4],'vane');expect(colourDrive(responses,levels,1)).toBe(0);
    responses[0]=changeTarget(responses[0],'colour');expect(colourDrive(responses,levels,0)).toBe(0);
  });
});
describe('loop tempo math',()=>{
  it('clamps invalid tempo and wraps upload offsets in the shared beat clock',()=>{
    expect(clampBpm(NaN)).toBe(120);expect(clampBpm(0)).toBe(30);expect(clampBpm(999)).toBe(240);
    expect(loopOffset(9,120,2)).toBe(0.5);expect(loopOffset(1,60,0)).toBe(0);
  });
  it('resamples playback rate and folds stereo down for the export',()=>{
    expect([...resampleLoop([new Float32Array([0,1,0,-1])],4,2,4,4)]).toEqual([0,0,0,0]);
    expect([...resampleLoop([new Float32Array([0,1])],2,0.5,4,2)]).toEqual([0,0.5,1,0.5]);
    expect([...resampleLoop([new Float32Array([1,1]),new Float32Array([-1,-1])],2,1,2,2)]).toEqual([0,0]);
  });
});
