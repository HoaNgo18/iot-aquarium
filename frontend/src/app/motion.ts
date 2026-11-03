function readStorage(key:string):string|null {try{return localStorage.getItem(key)}catch{return null}}
export type MotionPreference='on'|'off'|'system'
export function motionPreference(value:string|null):MotionPreference {return value==='on'||value==='off'?value:'system'}
export function resolveMotion(value:MotionPreference,reduced:boolean):'on'|'off' {return value==='system'?(reduced?'off':'on'):value}
export function applyMotion(value:MotionPreference){document.documentElement.dataset.motion=resolveMotion(value,window.matchMedia('(prefers-reduced-motion: reduce)').matches)}
export function initMotion(){const update=()=>applyMotion(motionPreference(readStorage('aquasense-motion')));update();window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',update)}
