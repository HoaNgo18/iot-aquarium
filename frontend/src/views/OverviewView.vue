<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { useSession } from '../app/session'
import { api } from '../app/api'
import { readStorage, writeStorage } from '../app/theme'
import { tankHref } from '../app/route'
import { numberText, formatStamp, formatDate } from '../app/format'
import { dueLabel } from '../app/reminders'
import { clarityLabel } from '../app/tanks'
import { sparkline, chooseOverviewTank, filterOverviewTanks, type SparkSample } from '../app/overview'
import type { Reminder } from '../app/types'
import AquariumScene from '../components/AquariumScene.vue'
import AppIcon from '../components/AppIcon.vue'
const session=useSession(), state=session.state
const selected=ref(readStorage('aquasense-overview-tank') ?? '')
watch(()=>state.tanks.map(t=>t.device_id).join('|'),()=>{
  if(!state.loadedTanks)return
  selected.value=chooseOverviewTank(state.tanks,selected.value)
},{immediate:true})
const tank=computed(()=>state.tanks.find(t=>t.device_id===selected.value))
const search=ref('')
const visibleTanks=computed(()=>filterOverviewTanks(state.tanks,search.value))
const rows=ref<SparkSample[]>([]), loading=ref(false), seriesError=ref('')
const defaults={temperature_min_c:22,temperature_max_c:30,ph_min:6.5,ph_max:8.5}
const thresholds=ref({...defaults})
let controller:AbortController|undefined, timer:ReturnType<typeof setInterval>|undefined
async function load(id:string, signal:AbortSignal) {
  loading.value=true; seriesError.value=''
  try {const data=await api<SparkSample[]>(`/devices/${encodeURIComponent(id)}/telemetry/series?minutes=1440`,{signal});if(!signal.aborted)rows.value=data}
  catch(e){if(!signal.aborted){rows.value=[];seriesError.value='Chưa tải được biểu đồ 24 giờ.'}}
  finally {if(!signal.aborted)loading.value=false}
}
watch(selected,id=>{
  controller?.abort(); clearInterval(timer); rows.value=[]; thresholds.value={...defaults};seriesError.value=''
  if(!id)return
  writeStorage('aquasense-overview-tank',id)
  controller=new AbortController();const signal=controller.signal
  void load(id,signal)
  void api<typeof defaults>(`/devices/${encodeURIComponent(id)}/thresholds`,{signal}).then(value=>{
    if(!signal.aborted && ['temperature_min_c','temperature_max_c','ph_min','ph_max'].every(k=>Number.isFinite(value[k as keyof typeof defaults])))thresholds.value=value
  }).catch(()=>{})
  timer=setInterval(()=>{if(!document.hidden&&!loading.value)void load(id,signal)},60000)
},{immediate:true})
onBeforeUnmount(()=>{controller?.abort();clearInterval(timer)})
const metrics=computed(()=>{
  const r=tank.value?.latest,t=thresholds.value
  function range(value:number|null|undefined,min:number,max:number,unit='') {
    if(value==null)return 'Chưa có số đo'
    return `${value<min?'Dưới':value>max?'Trên':'Trong'} ngưỡng ${numberText(min, min%1?1:0)}–${numberText(max,max%1?1:0)}${unit}`
  }
  return [
    {key:'temperature_c',label:'Nhiệt độ',value:r?.temperature_c,unit:'°C',decimals:1,status:range(r?.temperature_c,t.temperature_min_c,t.temperature_max_c,' °C')},
    {key:'ph',label:'pH',value:r?.ph,unit:'',decimals:2,status:r?.ph==null&&r?.ph_mv!=null?'Chưa hiệu chuẩn':range(r?.ph,t.ph_min,t.ph_max)},
    {key:'clarity_pct',label:'Độ trong',value:r?.clarity_pct,unit:'%',decimals:0,status:clarityLabel(r?.clarity_pct,r?.clarity_state)}
  ].map(m=>({...m,chart:sparkline(rows.value,m.key)}))
})
const busy=ref<number|null>(null),actionError=ref('')
async function complete(item:Reminder) {
  if(busy.value!=null)return
  busy.value=item.id;actionError.value=''
  try {
    const saved=await api<Reminder>(`/reminders/${item.id}/complete`,{method:'POST'})
    await session.refresh(true)
    session.notify(saved.repeat==='none'?'Đã đánh dấu xong.':`Đã xong · lần tới ${formatDate(saved.due_date,true)}`)
  }catch(e){actionError.value=(e as Error).message}finally{busy.value=null}
}
</script>
<template>
<section class="overview-dashboard">
  <div v-if="state.tanksError" class="shell-error-box" role="alert"><p>{{ state.tanksError }}</p><button class="shell-button" @click="session.refresh(true)">Thử lại</button></div>
  <p v-else-if="!state.loadedTanks" role="status">Đang tải…</p>
  <template v-else-if="!state.tanks.length">
    <div class="overview-onboarding"><div><h1>Kết nối bể cá đầu tiên</h1><ol><li><strong>Lấy mã ghép nối</strong><p>Mã được in trên nhãn thiết bị.</p></li><li><strong>Thêm bể</strong><p>Nhập mã thiết bị và mã ghép nối.</p><a href="#/tanks?add=1" class="shell-button is-primary">Thêm bể đầu tiên<AppIcon name="plus" /></a></li><li><strong>Xem số đo</strong><p>Số đo xuất hiện sau vài giây khi thiết bị đang gửi dữ liệu.</p></li></ol></div><div class="overview-demo"><span class="shell-chip">Minh họa</span><AquariumScene :temperature="27.1" :ph="7" :clarity="99" clarity-state="clear" :online="true" :alert="false" /><p>Số đo minh họa. Thêm bể để xem dữ liệu của bạn.</p></div></div>
  </template>
  <template v-else-if="tank">
    <header class="overview-summary"><h1>Chào {{ state.user?.display_name }}</h1></header>
    <div class="overview-grid">
      <section class="overview-main" aria-label="Bể đang chọn">
        <div class="overview-model-card"><header class="overview-selection"><h2>{{ tank.name }}</h2><div class="overview-selection-links"><span class="shell-chip" :class="{'is-warning':tank.open_alerts>0}">{{ tank.connectivity!=='online'?'Mất kết nối':tank.open_alerts?`${tank.open_alerts} cảnh báo`:'Trực tuyến' }}</span><a :href="tankHref(selected)">Xem chi tiết →</a></div></header>
        <div class="overview-scene"><AquariumScene compact :temperature="tank.latest?.temperature_c??null" :ph="tank.latest?.ph??null" :clarity="tank.latest?.clarity_pct??null" :clarity-state="tank.latest?.clarity_state" :online="tank.connectivity==='online'" :alert="tank.open_alerts>0" /></div>
        <p class="overview-measured">{{ tank.connectivity==='online'?'Số đo lúc':'Mất kết nối · giá trị cuối lúc' }} {{ formatStamp(tank.latest?.measured_at) }}</p>
        </div><div class="overview-metrics"><article v-for="metric in metrics" :key="metric.key" class="overview-metric"><h2>{{ metric.label }}</h2><p class="overview-value" :class="{'is-muted':tank.connectivity!=='online'}">{{ numberText(metric.value,metric.decimals) }} <small>{{ metric.unit }}</small></p><p class="overview-metric-status">{{ metric.status }}</p><p v-if="seriesError" class="shell-error" role="status">{{ seriesError }}</p><p v-else-if="loading&&!rows.length" role="status">Đang tải biểu đồ…</p><template v-else-if="metric.chart.count>=2"><svg viewBox="0 0 240 60" preserveAspectRatio="none" aria-hidden="true"><path :d="metric.chart.path" /></svg><span class="overview-spark-caption">24 giờ qua</span></template><p v-else>Chưa đủ dữ liệu 24 giờ</p></article></div>
      </section>
      <aside class="overview-side">
        <section class="overview-panel overview-attention"><h2>Cần chú ý</h2><div class="overview-panel-scroll"><p v-if="state.alertsError||state.remindersError" class="shell-error" role="alert">{{ state.alertsError||state.remindersError }} <button type="button" class="shell-text-button" @click="session.refresh(true)">Thử lại</button></p><p v-if="actionError" class="shell-error" role="alert">{{ actionError }}</p><div v-if="!state.alerts.length&&!session.dueReminders.value.length&&!state.alertsError&&!state.remindersError" class="overview-all-good"><AppIcon name="check" /><p>Mọi thứ ổn. Không có cảnh báo hay việc đến hạn.</p></div><ul class="overview-attention-list"><li v-for="alert in state.alerts" :key="`${alert.device_id}-${alert.id}`"><button type="button" class="overview-alert-button" @click="selected=alert.device_id"><strong>{{ alert.tank_name }}</strong><p>{{ alert.message }}</p><small>{{ formatStamp(alert.started_at) }}</small></button></li><li v-for="item in session.dueReminders.value" :key="`r-${item.id}`" class="overview-task"><button type="button" class="shell-complete" :aria-label="`Đánh dấu xong: ${item.title}`" :disabled="busy!=null" @click="complete(item)"><span aria-hidden="true"></span></button><div><strong>{{ item.title }}</strong><p>{{ item.tank_name||'Chung' }} · {{ dueLabel(item.due_date,state.now) }}</p></div></li></ul></div></section>
        <section class="overview-panel overview-tanks"><h2>Các bể</h2><div class="overview-search"><label class="sr-only" for="overview-search">Tìm bể</label><input id="overview-search" v-model="search" placeholder="Tìm theo tên hoặc mã thiết bị" @keydown.esc="search=''" /><button v-if="search" type="button" aria-label="Xoá tìm kiếm" @click="search=''">×</button></div><div class="overview-panel-scroll"><p v-if="!visibleTanks.length">Không tìm thấy bể phù hợp</p><button v-for="item in visibleTanks" :key="item.id" type="button" class="overview-tank-row" :aria-pressed="selected===item.device_id" @click="selected=item.device_id"><span class="overview-dot" :class="{'is-offline':item.connectivity!=='online'}"></span><span>{{ item.name }}<small>{{ item.device_id }}</small></span><strong>{{ numberText(item.latest?.temperature_c) }} °C</strong><AppIcon v-if="item.open_alerts" name="notifications" :size="18" /><span v-if="item.open_alerts" class="sr-only">{{ item.open_alerts }} cảnh báo</span></button></div></section>
      </aside>
    </div>
  </template>
</section>
</template>
