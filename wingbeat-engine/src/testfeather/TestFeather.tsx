import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import Feather2 from '../feather2/Feather2.tsx';
import type { FeatherPlay } from '../feather2/play.ts';
import { SOUND_FEATHERS, CONTINENTS, CONTINENT_COLOURS, LAYERS, featherLabel, atlasCsv, type Continent, type SoundFeather } from './catalog.ts';
import { StudyPlayer } from './player.ts';
import './testfeather.css';
import { Icon } from './icons.tsx';
import ResponseEditor from './ResponseEditor.tsx';
import { defaultResponses, playChannel, responseLevel, colourDrive, TARGETS, type LayerResponse } from './response.ts';
import { MIN_BPM, MAX_BPM } from './audioTiming.ts';
import { BpmInput } from './BpmInput.tsx';


function download(data: BlobPart, type: string, name: string) {
  const url=URL.createObjectURL(new Blob([data],{type}));
  const a=document.createElement('a'); a.href=url; a.download=name; a.click();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export default function TestFeather() {
  const [selected,setSelected]=useState(SOUND_FEATHERS.find(f=>f.id==='08f')!);
  const [continent,setContinent]=useState<Continent|'All'>('All');
  const [playing,setPlaying]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [expanded,setExpanded]=useState(false);
  const [about,setAbout]=useState(false);
  const [openResponse,setOpenResponse]=useState<number|null>(null);
  const [responseSets,setResponseSets]=useState<Record<string,LayerResponse[]>>({});
  const [uploadState,setUploadState]=useState<Record<string,{busy:boolean;error:string}>>({});
  const fileInputs=useRef<Array<HTMLInputElement|null>>([]);
  const responseDots=useRef<Array<SVGCircleElement|null>>([]);
  const uploadRequests=useRef<Record<string,number>>({});
  const [motion,setMotion]=useState(()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.25 : 0.9);
  const [,refresh]=useState(0);
  const player=useMemo(()=>new StudyPlayer(),[]);
  const request=useRef(0);
  const meters=useRef<Array<HTMLMeterElement|null>>([]);
  const readings=useRef<Array<HTMLOutputElement|null>>([]);
  const progress=useRef<HTMLProgressElement>(null);
  const motionRef=useRef(motion); motionRef.current=motion;
  const defaults=useMemo(defaultResponses,[]);
  const responses=responseSets[selected.id]??defaults;
  const responseRef=useRef(responses);responseRef.current=responses;
  const play=useMemo<FeatherPlay>(()=>({levels:[0,0,0,0,0],enveloped:true,channels:defaultResponses().map(r=>playChannel(r,1))}),[]);
  const stemInput=useMemo(()=>({levels:[0,0,0,0,0],active:true}),[]);
  const selection=player.selection(selected);
  const setResponse=(index:number,value:LayerResponse)=>setResponseSets(sets=>({...sets,[selected.id]:(sets[selected.id]??defaultResponses()).map((r,i)=>i===index?value:r)}));
  const filtered=SOUND_FEATHERS.filter(f=>continent==='All'||f.continent===continent);
  const color=CONTINENT_COLOURS[selected.continent];
  useEffect(()=>{
    document.title='Wing Beat — Feather sound atlas';
    let raf=0,last=performance.now(); const smoothed=[0,0,0,0,0];
    const frame=(now:number)=>{
      const dt=Math.min(0.1,(now-last)/1000); last=now;
      const levels=player.read();
      levels.forEach((v,i)=>{
        smoothed[i]=player.active ? smoothed[i]+(v-smoothed[i])*(1-Math.exp(-dt/(v>smoothed[i]?0.045:0.18))) : 0;
        const response=responseRef.current[i];
        const driven=responseLevel(smoothed[i],response.sensitivity);
        play.levels[i]=response.effect==='off'?0:driven;
        play.channels[i]=playChannel(response,motionRef.current);
        if(meters.current[i]) meters.current[i]!.value=smoothed[i];
        if(readings.current[i]) readings.current[i]!.textContent=`${Math.round(smoothed[i]*100)}%`;
        responseDots.current[i]?.setAttribute('cx',String(12+smoothed[i]*176));
        responseDots.current[i]?.setAttribute('cy',String(88-driven*76));
      });
      stemInput.levels[4]=colourDrive(responseRef.current,play.levels,motionRef.current);
      if(progress.current) progress.current.value=player.progress;
      raf=requestAnimationFrame(frame);
    };
    raf=requestAnimationFrame(frame);
    return()=>{cancelAnimationFrame(raf);++request.current;player.dispose();};
  },[player,play,stemInput]);
  const start=async(feather=selected)=>{
    const id=++request.current;
    setError('');setBusy(true);setPlaying(false);
    try {const started=await player.start(feather);if(id===request.current)setPlaying(started);}
    catch(e){if(id===request.current)setError(e instanceof Error?e.message:'Audio could not start. Try again.');}
    finally {if(id===request.current)setBusy(false);}
  };
  const stop=()=>{++request.current;player.stop();setPlaying(false);setBusy(false);};
  const choose=(feather:SoundFeather)=>{
    if(feather.id===selected.id)return;
    const continuePlaying=playing||busy;
    stop();setSelected(feather);setError('');
    player.solo=-1;player.muted.fill(false);player.applyMix();refresh(n=>n+1);
    if(continuePlaying)void start(feather);
  };
  const changeMix=(change:()=>void)=>{change();player.applyMix();refresh(n=>n+1);};
  const uploadAudio=async(index:number,file:File)=>{
    const feather=selected,key=`${feather.id}:${index}`;
    const token=(uploadRequests.current[key]??0)+1;uploadRequests.current[key]=token;
    setUploadState(s=>({...s,[key]:{busy:true,error:''}}));
    try {await player.upload(feather,index,file);}
    catch(e){if(uploadRequests.current[key]===token)setUploadState(s=>({...s,[key]:{busy:false,error:e instanceof Error?e.message:'Audio could not load.'}}));}
    finally {if(uploadRequests.current[key]===token){setUploadState(s=>({...s,[key]:{busy:false,error:s[key]?.error??''}}));refresh(n=>n+1);}}
  };
  const exportMix=()=>{const bytes=player.export();if(bytes)download(bytes,'audio/wav',`wingbeat-${selected.id}-study.wav`);};
  return <div className="tf" style={{'--tf-accent':color} as CSSProperties}>
    <header className="tf-header">
      <a href="/" className="tf-brand"><Icon name="feather" size={30}/><span>WING BEAT<small>FEATHER SOUND ATLAS</small></span></a>
      <span className="tf-edition"><i/> Listening studies · 01</span>
      <a className="tf-back" href="/experience">Experience <span>↗</span></a>
    </header>
    <section className="tf-intro" aria-label="Introduction">
      <div><span className="tf-eyebrow">44 FEATHERS / 7 GEOGRAPHIES / 5 LAYERS</span><h1>What does a feather carry?</h1></div>
      <p>Choose a feather. Hear its layers.<br/>Watch sound move through its fibres.</p>
    </section>
    <nav className="tf-continents" aria-label="Filter by continent">
      <Icon name="globe"/>{(['All',...CONTINENTS] as const).map(c=><button key={c} aria-pressed={continent===c} onClick={()=>setContinent(c)}>{c}<small>{c==='All'?44:SOUND_FEATHERS.filter(f=>f.continent===c).length}</small></button>)}
    </nav>
    <section className="tf-workbench" aria-label="Listening workbench">
      <div className="tf-stage">
        <Feather2 embedded featherId={selected.id} play={play} stemInput={stemInput}/>
        <div className="tf-stage-heading"><span className="tf-eyebrow">{featherLabel(selected.id)} <span>/ {selected.continent}</span></span><h2>{selected.style}</h2><p>{selected.place}</p></div>
        <div className="tf-stage-foot"><span className="tf-carry">{selected.carries}</span><small>Drag to turn · Scroll to look closer</small></div>
        <span className={`tf-live ${playing?'is-live':''}`}><i/>{busy?'Preparing sound':playing?'Audio reactive':'Ready to listen'}</span>
      </div>
      <aside className="tf-mixer" aria-label="Five sound layers">
        <div className="tf-transport">
          <button className="tf-play" onClick={()=>playing||busy?stop():void start()} aria-label={busy?'Cancel audio preparation':playing?'Stop study':'Play study'}><Icon name={playing||busy?'stop':'play'} size={21}/><span>{busy?'Cancel':playing?'Stop':'Listen'}</span></button>
          <div><strong>Five layers. One feather.</strong><small>{selection.bpm} BPM · {selected.beats} pulse units / bar</small></div>
        </div>
        <div className="tf-tempo">
          <label htmlFor="tf-bpm">Master BPM</label><BpmInput id="tf-bpm" label="Master BPM" value={selection.bpm} onChange={value=>changeMix(()=>player.setBpm(selected,value))}/>
          <input aria-label="Master tempo" type="range" min={MIN_BPM} max={MAX_BPM} step="1" value={selection.bpm} onChange={e=>changeMix(()=>player.setBpm(selected,Number(e.target.value)))}/>
          <button aria-label="Reset master BPM" title="Original tempo" onClick={()=>changeMix(()=>player.setBpm(selected,selected.bpm))}>↺</button>
        </div>
        <p className="tf-tempo-note">Tempo changes speed and pitch. Files stay in this tab.</p>
        <progress className="tf-progress" ref={progress} max="1" value="0" aria-label="Loop progress"/>
        {error&&<p className="tf-error" role="alert">{error}</p>}
        <div className="tf-layer-list">{LAYERS.map((layer,i)=>{
          const clip=selection.uploads[i],upload=uploadState[`${selected.id}:${i}`];
          return <div key={layer.name} className={`tf-layer ${player.muted[i]||(player.solo>=0&&player.solo!==i)?'is-muted':''}`}>
          <div className="tf-layer-top"><span className="tf-layer-icon"><Icon name={layer.icon}/></span><div className="tf-layer-name"><strong>{layer.name}<span>→ {TARGETS.find(t=>t.id===responses[i].target)?.label}</span></strong><small title={clip?.name}>{clip?.name??selected.layers[i]}</small></div><output aria-live="off" ref={node=>{readings.current[i]=node;}} aria-label={`${layer.name} measured audio level`}>0%</output><button className="tf-response-toggle" aria-label={`Edit ${layer.name} interaction`} aria-expanded={openResponse===i} aria-controls={`tf-response-${i}`} onClick={()=>setOpenResponse(openResponse===i?null:i)}><Icon name="arrow" size={18}/></button></div>
          <div className="tf-layer-controls"><input type="range" min="0" max="1" step="0.01" aria-label={`${layer.name} volume`} value={player.volumes[i]} onChange={e=>changeMix(()=>{player.volumes[i]=Number(e.target.value);})}/><button title={`Only hear ${layer.name.toLowerCase()}`} aria-label={`Solo ${layer.name}`} aria-pressed={player.solo===i} onClick={()=>changeMix(()=>{player.solo=player.solo===i?-1:i; if(player.solo===i)player.muted[i]=false;})}>Solo</button><button aria-label={`Mute ${layer.name}`} aria-pressed={player.muted[i]} onClick={()=>changeMix(()=>{player.muted[i]=!player.muted[i];})}>Mute</button></div>
          <div className="tf-upload-row"><input type="file" hidden accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac" aria-label={`Audio file for ${layer.name}`} ref={node=>{fileInputs.current[i]=node;}} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void uploadAudio(i,file);}}/><button aria-label={`Upload audio for ${layer.name}`} onClick={()=>fileInputs.current[i]?.click()} disabled={upload?.busy}><Icon name="upload" size={12}/>{upload?.busy?'Loading…':clip?'Replace audio':'Upload audio'}</button>{clip&&<><label>Clip BPM <BpmInput label={`${layer.name} clip BPM`} value={clip.bpm} onChange={value=>changeMix(()=>player.setClipBpm(selected,i,value))}/></label><button aria-label={`Restore original ${layer.name} audio`} title="Restore original sound" onClick={()=>changeMix(()=>player.restore(selected,i))}>↺</button></>}</div>
          {upload?.error&&<p className="tf-upload-error" role="alert">{upload.error}</p>}
          <meter ref={node=>{meters.current[i]=node;}} min="0" max="1" value="0" aria-label={`${layer.name} audio level`}/>
          {openResponse===i&&<div id={`tf-response-${i}`}><ResponseEditor name={layer.name} value={responses[i]} onChange={value=>setResponse(i,value)} onClose={()=>setOpenResponse(null)} onReset={()=>setResponse(i,defaultResponses()[i])} dotRef={node=>{responseDots.current[i]=node;}}/></div>}
        </div>;})}</div>
        <div className="tf-master"><label><span>Volume</span><input aria-label="Master volume" type="range" min="0" max="0.8" step="0.01" value={player.masterVolume} onChange={e=>changeMix(()=>{player.masterVolume=Number(e.target.value);})}/></label><label><span>Motion</span><input aria-label="Motion amount" type="range" min="0" max="1.5" step="0.05" value={motion} onChange={e=>setMotion(Number(e.target.value))}/></label></div>
        <div className="tf-mixer-foot"><span>Solo a layer to follow its movement.</span><button onClick={exportMix} disabled={player.preparedId!==selected.id||busy} title="Download one loop of the current mix">WAV ↓</button></div>
      </aside>
    </section>
    <section className="tf-selection" aria-label="Choose a feather">
      <div className="tf-section-title"><span>{continent==='All'?'The collection':continent}<small>{filtered.length} {filtered.length===1?'feather':'feathers'}</small></span><button aria-expanded={expanded} aria-controls="tf-atlas" onClick={()=>setExpanded(!expanded)}>{expanded?'Close pairings ×':'All pairings ↗'}</button></div>
      <div className="tf-feather-strip">{filtered.map(feather=><button key={feather.id} onClick={()=>choose(feather)} aria-label={`Select ${featherLabel(feather.id)}: ${feather.style}`} aria-pressed={selected.id===feather.id} title={`${feather.style} · ${feather.place}`} style={{'--feather-accent':CONTINENT_COLOURS[feather.continent]} as CSSProperties}><img src={`/feathers/thumbs/${feather.id}.png`} alt="" loading="lazy"/><span>{feather.id==='air-study'?'AIR':feather.id.slice(0,2)}</span><i/></button>)}</div>
    </section>
    <section className="tf-context">
      <div><span className="tf-note">Original electronic sketches</span><p>Colour and form inspire these pairings; bird species and origins are unverified.</p></div>
      <button aria-expanded={about} aria-controls="tf-about" onClick={()=>setAbout(!about)}>{about?'Close notes ×':'About this pairing +'}</button>
    </section>
    {about&&<section className="tf-about" id="tf-about" aria-label="Pairing notes">
      <div><h3>{selected.carries}</h3><p>{selected.pairing}</p>{selected.reference&&<a href={selected.reference.url} target="_blank" rel="noreferrer">{selected.reference.title} ↗</a>}</div>
      <div><h3>A proposal, ready for collaboration</h3><p>These are newly composed electronic studies, not traditional recordings or exact instrument models. Equal-tempered palettes simplify tuning and ornament. The associations and meanings are curatorial proposals, not cultural provenance.</p><p>For the installation, develop each voice with musicians from the named communities, with credit and permission. Antarctica carries an imagined ecology of wind and ice.</p></div>
      <div><h3>Sound → feather</h3><p>Each layer is measured after its volume and mute controls. Open its arrow to choose a feather part, movement and sensitivity. Uploading a sound keeps these settings. Small resting movements remain.</p><p>Set an uploaded clip’s original BPM to follow the master tempo. Clips loop at their own length; tempo changes speed and pitch. WAV exports four bars of the current mix. Uploads and edits stay in this tab until you reload.</p></div>
    </section>}
    {expanded&&<section className="tf-atlas" id="tf-atlas" aria-label="Full feather and music pairings">
      <div className="tf-section-title"><h2>The proposed atlas</h2><div><button onClick={()=>download(atlasCsv(),'text/csv;charset=utf-8','wingbeat-feather-sound-atlas.csv')}>Download CSV ↓</button><button onClick={()=>setExpanded(false)} aria-label="Close full pairings">Close ×</button></div></div>
      <div className="tf-table-scroll"><table><thead><tr><th>Feather</th><th>Place / study</th><th>It carries</th><th>Five sound layers</th><th/></tr></thead><tbody>{filtered.map(feather=><tr key={feather.id}><td><img src={`/feathers/thumbs/${feather.id}.png`} alt="" loading="lazy"/>{featherLabel(feather.id)}</td><td><small>{feather.continent} · {feather.place}</small><strong>{feather.style}</strong></td><td>{feather.carries}</td><td>{feather.layers.join(' · ')}</td><td><button onClick={()=>{choose(feather);document.querySelector('.tf-workbench')?.scrollIntoView({behavior:'auto',block:'start'});}}>Explore ↗</button></td></tr>)}</tbody></table></div>
    </section>}
    <footer className="tf-footer"><span>WING BEAT / A vessel of culture</span><span>Sound becomes movement. Movement becomes listening.</span></footer>
  </div>;
}
