import { useId } from 'react';
import { TARGETS, availableEffects, changeTarget, responseLevel, type LayerResponse } from './response.ts';
import { Icon } from './icons.tsx';
interface Props { name:string; value:LayerResponse; onChange:(value:LayerResponse)=>void; onClose:()=>void; onReset:()=>void; dotRef:(node:SVGCircleElement|null)=>void }
export default function ResponseEditor({name,value,onChange,onClose,onReset,dotRef}:Props) {
  const id=useId();
  const curve=Array.from({length:41},(_,i)=>`${i?'L':'M'}${12+i*4.4},${88-responseLevel(i/40,value.sensitivity)*76}`).join(' ');
  return <section className="tf-response" aria-label={`${name} interaction`}>
    <div className="tf-response-heading"><strong>Sound → movement</strong><button onClick={onClose} aria-label={`Close ${name} interaction`}>Close ×</button></div>
    <div className="tf-target-picker">
      <svg viewBox="0 0 90 155" role="img" aria-label={`${TARGETS.find(t=>t.id===value.target)?.label} selected on the feather`}>
        <defs><linearGradient id={id}><stop stopColor="var(--tf-accent)"/><stop offset="1" stopColor="#8679c0"/></linearGradient></defs>
        <path d="M44 139C5 114 6 42 55 9C90 50 81 105 44 139Z" fill={value.target==='colour'?`url(#${id})`:'#202b23'} stroke="currentColor" opacity={value.target==='vane'||value.target==='colour'?1:0.45}/>
        {[36,51,66,81,96,111].map((y,i)=><path key={y} d={`M${49-i} ${y+13}l-22 -15m22 15 22-26`} fill="none" stroke="currentColor" opacity={value.target==='vane'?1:0.25}/>)}
        <path d="M42 149Q47 80 55 9" fill="none" stroke={value.target==='shaft'?'var(--tf-accent)':'#737e70'} strokeWidth={value.target==='shaft'?4:1.5}/>
        {[60,82,103].map(y=><ellipse key={y} cx="62" cy={y} rx="6" ry="3" fill="currentColor" opacity={value.target==='markings'?1:0.2}/>)}
        <path d="M43 137q-23-10-20-25m20 25q-18-4-17 3m17-3q20-12 18-25m-18 25q19-4 18 3" fill="none" stroke="currentColor" strokeWidth={value.target==='down'?2.5:1} opacity={value.target==='down'?1:0.25}/>
      </svg>
      <div className="tf-target-buttons" role="group" aria-label={`${name} feather part`}>{TARGETS.map(t=><button key={t.id} aria-pressed={value.target===t.id} onClick={()=>onChange(changeTarget(value,t.id))}><Icon name={t.icon} size={16}/>{t.label}</button>)}</div>
    </div>
    <div className="tf-effect-buttons" role="group" aria-label={`${name} movement`}>{availableEffects(value.target).map(e=><button key={e.id} aria-pressed={value.effect===e.id} onClick={()=>onChange({...value,effect:e.id})}><Icon name={e.icon} size={18}/><span>{e.label}</span></button>)}</div>
    <div className="tf-sensitivity-graph">
      <svg viewBox="0 0 200 102" role="img" aria-label={`Audio response curve at ${value.sensitivity.toFixed(1)} times sensitivity`}><path d="M12 12V88H188M12 50H188M100 12V88" fill="none" stroke="#354034" strokeWidth=".7"/><path d="M12 88 188 12" fill="none" stroke="#50604a" strokeDasharray="3 4"/><path d={curve} fill="none" stroke="var(--tf-accent)" strokeWidth="2"/><circle ref={dotRef} cx="12" cy="88" r="3.5" fill="var(--tf-accent)"/><text x="12" y="100">Quiet</text><text x="164" y="100">Loud</text></svg>
      <label><span>Sensitivity <output>{value.sensitivity.toFixed(1)}×</output></span><input type="range" min="0" max="4" step="0.1" aria-label={`${name} sensitivity`} value={value.sensitivity} onChange={e=>onChange({...value,sensitivity:Number(e.target.value)})}/></label>
    </div>
    <div className="tf-response-sliders"><label><span>Amount <output>{Math.round(value.amount*100)}%</output></span><input type="range" min="0" max="1.5" step="0.05" aria-label={`${name} response amount`} value={value.amount} onChange={e=>onChange({...value,amount:Number(e.target.value)})}/></label>{!['off','shift'].includes(value.effect)&&<label><span>Speed</span><input type="range" min="0.1" max="2" step="0.05" aria-label={`${name} movement speed`} value={value.speed} onChange={e=>onChange({...value,speed:Number(e.target.value)})}/></label>}</div>
    <button className="tf-reset-response" onClick={onReset}>Reset this response ↺</button>
  </section>;
}
