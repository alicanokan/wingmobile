import { useEffect, useState } from 'react';
import { clampBpm, MIN_BPM, MAX_BPM } from './audioTiming.ts';
/** Commit a complete number, so typing "120" never clamps the initial "1". */
export function BpmInput({value,onChange,label,id}:{value:number;onChange:(value:number)=>void;label:string;id?:string}) {
  const [text,setText]=useState(String(value));
  useEffect(()=>setText(String(value)),[value]);
  const commit=()=>{const next=text.trim()&&Number.isFinite(Number(text))?clampBpm(Number(text)):value;setText(String(next));onChange(next);};
  return <input id={id} aria-label={label} type="number" min={MIN_BPM} max={MAX_BPM} step="1" value={text} onChange={e=>setText(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/>;
}
