import type { PlayChannel } from '../feather2/play.ts';
export type Target = 'shaft' | 'vane' | 'down' | 'markings' | 'colour';
export type Effect = 'wave' | 'breathe' | 'lift' | 'swirl' | 'pulse' | 'shift' | 'off';
export interface LayerResponse { target: Target; effect: Effect; sensitivity: number; amount: number; speed: number }
export const TARGETS: {id:Target;label:string;icon:string}[] = [
  {id:'shaft',label:'Shaft',icon:'pulse'}, {id:'vane',label:'Vane',icon:'feather'},
  {id:'down',label:'Down',icon:'air'}, {id:'markings',label:'Markings',icon:'dots'}, {id:'colour',label:'Colour',icon:'sun'},
];
export const EFFECTS: {id:Effect;label:string;icon:string;mode:number}[] = [
  {id:'wave',label:'Wave',icon:'wave',mode:6}, {id:'breathe',label:'Breathe',icon:'air',mode:1},
  {id:'lift',label:'Lift',icon:'upload',mode:2}, {id:'swirl',label:'Swirl',icon:'swirl',mode:3},
  {id:'pulse',label:'Pulse',icon:'pulse',mode:5}, {id:'shift',label:'Colour shift',icon:'sun',mode:0},
  {id:'off',label:'Off',icon:'stop',mode:0},
];
export const availableEffects = (target: Target) => EFFECTS.filter(e => target === 'shaft' ? ['wave','off'].includes(e.id) : target === 'colour' ? ['shift','off'].includes(e.id) : !['shift'].includes(e.id));
export const defaultResponses = (): LayerResponse[] => TARGETS.map((t,i) => ({target:t.id,effect:(['wave','wave','breathe','pulse','shift'] as Effect[])[i],sensitivity:1,amount:[0.9,0.9,0.8,0.6,1][i],speed:[0.65,0.7,0.7,0.8,0.4][i]}));
export const responseLevel = (input: number, sensitivity: number) => 1 - (1 - Math.max(0,Math.min(1,input))) ** Math.max(0,Math.min(4,sensitivity));
export function changeTarget(response: LayerResponse, target: Target): LayerResponse {
  const effect = availableEffects(target).some(e=>e.id===response.effect) ? response.effect : target==='colour'?'shift':'wave';
  return {...response,target,effect};
}
export function playChannel(response: LayerResponse, motion: number): PlayChannel {
  const part = ({shaft:'rachis',vane:'barbs',down:'down',markings:'patterns',colour:'colours'} as const)[response.target];
  return {part,mode:EFFECTS.find(e=>e.id===response.effect)?.mode??0,strength:response.amount*motion,speed:response.speed,attack:45,release:180};
}
/** Only the colour shader supplements the selected movement, never a hidden fixed route. */
export function colourDrive(responses: LayerResponse[], levels: number[], motion: number): number {
  return Math.min(1,Math.max(0,...responses.map((r,i)=>r.target==='colour'&&r.effect==='shift'?levels[i]*r.amount*motion:0)));
}
