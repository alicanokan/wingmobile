import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudyPlayer } from './player.ts';
import { SOUND_FEATHERS } from './catalog.ts';
const param=()=>({value:1,cancelScheduledValues:vi.fn(),setTargetAtTime:vi.fn(),setValueAtTime:vi.fn(),linearRampToValueAtTime:vi.fn()});
class NodeMock {
  gain=param();playbackRate=param();threshold=param();knee=param();ratio=param();buffer?:BufferMock;onended:(()=>void)|null=null;
  connect=vi.fn();disconnect=vi.fn();start=vi.fn();stop=vi.fn();
  getFloatTimeDomainData=(data:Float32Array)=>data.fill(0.1);
}
class BufferMock {
  numberOfChannels=1; sampleRate=8000; duration:number; channels:Float32Array[];
  constructor(frames=8000, sampleRate=8000){this.sampleRate=sampleRate;this.duration=frames/sampleRate;this.channels=[new Float32Array(frames).fill(0.2)];}
  copyToChannel(stem:Float32Array,index:number){this.channels[index]=stem.slice();}
  getChannelData(index:number){return this.channels[index];}
}
class ContextMock {
  static contexts:ContextMock[]=[];
  state='suspended';currentTime=1;destination=new NodeMock();sources:NodeMock[]=[];analysers:NodeMock[]=[];
  decodeAudioData=vi.fn(async(_bytes:ArrayBuffer)=>new BufferMock(16000));
  constructor(){ContextMock.contexts.push(this);}
  async resume(){this.state='running';}async close(){this.state='closed';}
  createGain(){return new NodeMock();}createDynamicsCompressor(){return new NodeMock();}
  createAnalyser(){const n=new NodeMock();this.analysers.push(n);return n;}
  createBuffer(_channels:number,length:number,rate:number){return new BufferMock(length,rate);}
  createBufferSource(){const n=new NodeMock();this.sources.push(n);return n;}
}
class WorkerMock {
  static jobs:WorkerMock[]=[];onmessage?:(event:unknown)=>void;onerror?:()=>void;
  terminate=vi.fn();postMessage=vi.fn();constructor(){WorkerMock.jobs.push(this);}
  finish(){this.onmessage?.({data:{rendered:{sampleRate:8000,duration:1,stems:Array.from({length:5},()=>new Float32Array(8000).fill(0.1))}}});}
}
let player:StudyPlayer;
const recipe=SOUND_FEATHERS[0];
const file=(name='replacement.wav')=>({name,size:200,arrayBuffer:async()=>new ArrayBuffer(8)} as File);
async function start(){const job=player.start(recipe);await Promise.resolve();WorkerMock.jobs.at(-1)!.finish();return job;}
beforeEach(()=>{ContextMock.contexts=[];WorkerMock.jobs=[];vi.stubGlobal('AudioContext',ContextMock);vi.stubGlobal('Worker',WorkerMock);player=new StudyPlayer();});
afterEach(()=>{player.dispose();vi.unstubAllGlobals();});
describe('study playback lifecycle',()=>{
  it('starts five stems on one clock and releases every output on stop',async()=>{
    await start();const ctx=ContextMock.contexts[0];expect(player.active).toBe(true);expect(ctx.sources).toHaveLength(5);
    for(const source of ctx.sources)expect(source.start).toHaveBeenCalledWith(1.045,0);
    expect(player.read().every(v=>v>0)).toBe(true);
    ctx.state='suspended';expect(player.read()).toEqual([0,0,0,0,0]);ctx.state='running';
    player.stop();expect(player.active).toBe(false);expect(player.read()).toEqual([0,0,0,0,0]);
    for(const source of ctx.sources){expect(source.stop).toHaveBeenCalledOnce();expect(source.disconnect).toHaveBeenCalledOnce();}
  });
  it('cancels a pending feather without restarting stale sound',async()=>{
    const old=player.start(recipe);await Promise.resolve();const worker=WorkerMock.jobs[0];
    const next=player.start(SOUND_FEATHERS[1]);await Promise.resolve();
    expect(worker.terminate).toHaveBeenCalledOnce();worker.finish();WorkerMock.jobs[1].finish();
    expect(await old).toBe(false);expect(await next).toBe(true);expect(ContextMock.contexts[0].sources).toHaveLength(5);
  });
  it('honours stop during audio unlock',async()=>{const job=player.start(recipe);player.stop();expect(await job).toBe(false);expect(WorkerMock.jobs).toHaveLength(0);});
  it('recovers from a worker error',async()=>{
    const first=player.start(recipe);const result=expect(first).rejects.toThrow('could not load');
    await Promise.resolve();WorkerMock.jobs[0].onerror?.();await result;expect(WorkerMock.jobs[0].terminate).toHaveBeenCalledOnce();expect(await start()).toBe(true);
  });
});
describe('tempo and replacement audio',()=>{
  it('changes all playback rates together and keeps continuous beat phase',async()=>{
    await start();const ctx=ContextMock.contexts[0];ctx.currentTime=2.045;const before=player.progress;
    player.setBpm(recipe,recipe.bpm*2);expect(player.progress).toBeCloseTo(before,8);
    for(const source of ctx.sources)expect(source.playbackRate.setValueAtTime).toHaveBeenLastCalledWith(2,2.045);
    ctx.currentTime+=1;expect(player.progress-before).toBeCloseTo((recipe.bpm*2/60)/(recipe.beats*4));
  });
  it('replaces just one source, preserving gain, mute, solo, analyser and timeline',async()=>{
    await start();const ctx=ContextMock.contexts[0];player.volumes[2]=0.27;player.muted[2]=true;player.solo=1;ctx.currentTime=4;
    const channels=[...ctx.analysers];await player.upload(recipe,2,file());
    expect(ctx.sources).toHaveLength(6);expect(ctx.analysers).toEqual(channels);
    expect(ctx.sources[2].stop).toHaveBeenCalled();for(const i of [0,1,3,4])expect(ctx.sources[i].stop).not.toHaveBeenCalled();
    expect(ctx.sources[5].start.mock.calls[0][1]).toBeCloseTo((4.015-1.045)%2);
    expect(player.volumes[2]).toBe(0.27);expect(player.muted[2]).toBe(true);expect(player.solo).toBe(1);
    expect(player.selection(recipe).uploads[2]?.name).toBe('replacement.wav');
  });
  it('uploads before playback, retains files per feather, and restores the original',async()=>{
    await player.upload(recipe,1,file());player.setBpm(recipe,100);expect(player.active).toBe(false);
    await start();const ctx=ContextMock.contexts[0];expect(ctx.sources[1].buffer?.duration).toBe(2);
    expect(ctx.sources[1].playbackRate.value).toBeCloseTo(100/recipe.bpm);
    expect(player.selection(SOUND_FEATHERS[1]).uploads[1]).toBeNull();
    player.restore(recipe,1);expect(player.selection(recipe).uploads[1]).toBeNull();expect(ctx.sources.at(-1)!.buffer?.duration).toBe(1);
  });
  it('a failed decode keeps the previous clip and live sound',async()=>{
    await start();await player.upload(recipe,0,file('good.wav'));const ctx=ContextMock.contexts[0],count=ctx.sources.length;
    ctx.decodeAudioData.mockRejectedValueOnce(new Error('bad file'));
    await expect(player.upload(recipe,0,file('bad.wav'))).rejects.toThrow('could not be read');
    expect(player.selection(recipe).uploads[0]?.name).toBe('good.wav');expect(ctx.sources).toHaveLength(count);expect(player.active).toBe(true);
  });
  it('late decodes cannot undo a newer upload, restore, or disposal',async()=>{
    await start();const ctx=ContextMock.contexts[0];let finish!:(buffer:BufferMock)=>void;
    ctx.decodeAudioData.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const old=player.upload(recipe,0,file('old.wav'));await Promise.resolve();await player.upload(recipe,0,file('new.wav'));
    finish(new BufferMock());expect(await old).toBe(false);expect(player.selection(recipe).uploads[0]?.name).toBe('new.wav');
    ctx.decodeAudioData.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const restored=player.upload(recipe,0,file());await Promise.resolve();player.restore(recipe,0);finish(new BufferMock());expect(await restored).toBe(false);
    ctx.decodeAudioData.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const disposed=player.upload(recipe,0,file());await Promise.resolve();player.dispose();finish(new BufferMock());expect(await disposed).toBe(false);
  });
  it('uses uploaded content and master tempo in the four-bar WAV export',async()=>{
    await start();await player.upload(recipe,0,file());player.solo=0;player.volumes[0]=1;player.masterVolume=0.5;
    player.setBpm(recipe,120);player.setClipBpm(recipe,0,60);
    expect(ContextMock.contexts[0].sources.at(-1)!.playbackRate.value).toBe(2);
    const wav=new DataView(player.export()!);
    expect(wav.getUint32(40,true)).toBe(Math.round(recipe.beats*4*60/120*8000)*2);
    expect(wav.getInt16(44,true)).toBe(Math.round(0.2*0.5*32767));
  });
});
