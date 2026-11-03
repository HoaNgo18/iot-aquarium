export interface SparkSample {measured_at:string;[key:string]:unknown}
export function sparkline(rows:SparkSample[],key:string) {
 const samples=rows.map(r=>({time:Date.parse(r.measured_at),value:typeof r[key]==='number'&&Number.isFinite(r[key])?r[key] as number:null})).filter(r=>Number.isFinite(r.time)).sort((a,b)=>a.time-b.time)
 const values=samples.flatMap(r=>r.value==null?[]:[r.value]);if(values.length<2)return {path:'',count:values.length}
 const min=Math.min(...values),max=Math.max(...values),start=samples[0].time,span=samples.at(-1)!.time-start
 let path='',previous:number|null=null
 for(const r of samples){if(r.value==null){previous=null;continue}const x=4+(span?(r.time-start)/span*232:116),y=max===min?30:54-(r.value-min)/(max-min)*48;path+=`${previous==null||r.time-previous>600000?'M':'L'}${x.toFixed(2)},${y.toFixed(2)} `;previous=r.time}
 return {path:path.trim(),count:values.length}
}
export function chooseOverviewTank(tanks:{device_id:string}[],saved:string|null){return tanks.some(t=>t.device_id===saved)?saved!:tanks[0]?.device_id??''}
export function overviewSummary(name:string,tanks:number,alerts:number,due:number){return {greeting:`Chào ${name}`,tanks:`${tanks} bể`,alerts:alerts?`${alerts} cảnh báo`:'Không có cảnh báo',due:due?`${due} việc quá hạn/hôm nay`:'Không có việc hôm nay'}}
export function filterOverviewTanks<T extends {name:string;device_id:string;open_alerts:number}>(tanks:T[],query:string):T[]{
 const normalize=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/gi,'d').toLowerCase()
 const needle=normalize(query.trim())
 return tanks.filter(t=>normalize(`${t.name} ${t.device_id}`).includes(needle)).sort((a,b)=>Number(b.open_alerts>0)-Number(a.open_alerts>0)||a.name.localeCompare(b.name,'vi'))
}
