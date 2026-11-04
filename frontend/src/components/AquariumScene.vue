<script setup lang="ts">
import { computed, useId, ref, onMounted, onBeforeUnmount } from 'vue'
import { clarityLabel } from '../app/tanks'
import { numberText } from '../app/format'
const props = defineProps<{
  temperature: number | null; ph: number | null; clarity: number | null
  clarityState: 'clear' | 'slight' | 'cloudy' | null | undefined
  online: boolean; alert: boolean; stamp?: string; compact?: boolean
}>()
const effects=ref(document.documentElement.dataset.motion??'on')
const motionObserver=new MutationObserver(()=>{effects.value=document.documentElement.dataset.motion??'on'})
onMounted(()=>motionObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-motion']}))
onBeforeUnmount(()=>motionObserver.disconnect())
const paused=ref(document.hidden)
const visibility=()=>{paused.value=document.hidden}
onMounted(()=>document.addEventListener('visibilitychange',visibility))
onBeforeUnmount(()=>document.removeEventListener('visibilitychange',visibility))
const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
const waterId = `water-${id}`, phId = `ph-${id}`, clipId = `clip-${id}`
const finite = (value: number | null) => value != null && Number.isFinite(value)
const tempHeight = computed(() => finite(props.temperature) ? (Math.min(35, Math.max(15, props.temperature!)) - 15) / 20 * 250 : 0)
const phX = computed(() => finite(props.ph) ? 80 + Math.min(14, Math.max(0, props.ph!)) / 14 * 560 : null)
const tempColor = computed(() => !finite(props.temperature) ? 'var(--neutral)' : props.temperature! < 22 || props.temperature! > 30 ? 'var(--warning)' : 'var(--temperature)')
const clarityText = computed(() => clarityLabel(props.clarity, props.clarityState))
const mode = computed(() => !props.online ? 'offline' : props.clarity == null || props.clarity > 120 ? 'unknown' : props.clarityState === 'slight' ? 'slight' : props.clarityState === 'cloudy' ? 'cloudy' : 'normal')
const haze = computed(() => mode.value === 'cloudy' ? .55 : mode.value === 'slight' ? .25 : 0)
const particles = computed(() => mode.value === 'cloudy' ? .9 : mode.value === 'slight' ? .45 : 0)
const stampText = computed(() => props.stamp ?? (!props.online ? 'Mất kết nối · giá trị cuối' : ''))
const description = computed(() => `Mô hình bể cá. ${props.online ? 'Có kết nối' : 'Mất kết nối, số đo cuối'}. Nhiệt độ ${finite(props.temperature) ? `${numberText(props.temperature)} độ C` : 'chưa có số đo'}, pH ${numberText(props.ph, 2)}, độ trong ${clarityText.value.toLowerCase()} ${finite(props.clarity) ? `${numberText(props.clarity, 0)} phần trăm` : ''}.${props.alert ? ' Có cảnh báo.' : ''}`)
</script>
<template>
  <div class="aq-root" :data-effects="effects" :class="[`aq-${mode}`, { 'aq-alert': alert, 'is-paused': paused, 'aq-compact': compact }]">
    <svg class="aq-illustration" :viewBox="compact ? '30 16 620 354' : '0 0 760 460'" role="img" :aria-label="description">
      <defs>
        <linearGradient :id="waterId" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--aq-water-top)" /><stop offset="1" stop-color="var(--aq-water-bottom)" /></linearGradient>
        <linearGradient :id="phId" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="var(--danger)" /><stop offset=".25" stop-color="var(--warning)" /><stop offset=".5" stop-color="var(--clarity-clear)" /><stop offset=".75" stop-color="var(--temperature)" /><stop offset="1" stop-color="var(--ph)" /></linearGradient>
        <clipPath :id="clipId"><rect x="42" y="58" width="596" height="300" rx="6" /></clipPath>
      </defs>
      <rect x="34" y="22" width="612" height="10" rx="3" fill="var(--border-strong)" />
      <rect class="aq-glass" x="40" y="30" width="600" height="330" rx="8" fill="var(--surface-elevated)" stroke="var(--border-strong)" stroke-width="2" />
      <g :clip-path="`url(#${clipId})`">
        <rect x="42" y="58" width="596" height="300" :fill="`url(#${waterId})`" />
        <polygon class="aq-ray" points="150,58 210,58 140,358 60,358" fill="var(--text)" fill-opacity=".04" />
        <polygon class="aq-ray" style="animation-delay:-3s" points="330,58 370,58 330,358 270,358" fill="var(--text)" fill-opacity=".03" />
        <path class="aq-wave" d="M-58 62 q25 -6 50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 " fill="none" stroke="var(--text)" stroke-opacity=".2" stroke-width="2" />
        <path d="M42 330 Q200 310 340 326 T638 320 L638 360 L42 360 Z" fill="var(--aq-sand)" />
        <ellipse cx="470" cy="332" rx="34" ry="16" fill="var(--border-strong)" /><ellipse cx="505" cy="338" rx="20" ry="10" fill="var(--border)" /><ellipse cx="120" cy="336" rx="24" ry="10" fill="var(--border)" />
        <g class="aq-plant"><path d="M180 334 C170 290 196 262 182 214 M180 334 C196 296 208 280 204 240" fill="none" stroke="var(--clarity-clear)" stroke-width="7" stroke-linecap="round" /></g>
        <g class="aq-plant" style="animation-delay:-2s"><path d="M560 330 C548 280 574 250 560 190 M560 330 C578 292 586 270 584 230 M560 330 C544 300 536 286 540 256" fill="none" stroke="var(--clarity-clear)" stroke-width="7" stroke-linecap="round" /></g>
        <g class="aq-plant" style="animation-delay:-4s"><path d="M300 330 C296 304 310 290 304 262" fill="none" stroke="var(--clarity-clear)" stroke-width="6" stroke-linecap="round" /></g>
        <g transform="translate(110 150)"><g class="aq-bob"><g class="aq-f1"><polygon class="aq-tail" points="-26,0 -44,-13 -44,13" fill="var(--warning)" /><ellipse rx="28" ry="15" fill="var(--aq-fish-warm)" /><path d="M-6 -14 Q4 -24 14 -12" fill="var(--warning)" /><circle cx="15" cy="-4" r="3" fill="var(--background)" /></g></g></g>
        <g transform="translate(480 236)"><g class="aq-bob" style="animation-delay:-1.4s"><g class="aq-f2"><polygon class="aq-tail" points="-18,0 -32,-10 -32,10" fill="var(--temperature)" /><ellipse rx="20" ry="11" fill="var(--aq-fish-blue)" /><circle cx="10" cy="-3" r="2.4" fill="var(--background)" /></g></g></g>
        <g v-for="i in 4" :key="`school-${i}`" :transform="`translate(${160+i*30} ${190+i%2*16})`"><g class="aq-school" :style="{animationDelay:`${-i*2}s`}"><polygon class="aq-tail" points="-10,0 -18,-6 -18,6" fill="var(--temperature)"/><ellipse rx="12" ry="6" fill="var(--aq-fish-blue)"/><circle cx="6" cy="-2" r="1.3" fill="var(--background)"/></g></g>
        <circle v-for="(bubble, index) in [[598,330,4],[606,334,3],[592,336,5],[602,332,2.5]]" :key="index" class="aq-bubble" :style="{ animationDelay: `${index * -1.4}s` }" :cx="bubble[0]" :cy="bubble[1]" :r="bubble[2]" fill="none" stroke="var(--aq-fish-blue)" stroke-opacity=".8" stroke-width="1.5" />
        <rect x="42" y="58" width="596" height="300" fill="var(--aq-haze)" :opacity="haze" />
        <g fill="var(--aq-particles)" :opacity="particles"><circle v-for="(dot, index) in [[90,110],[160,200],[230,90],[270,250],[330,140],[390,210],[430,100],[500,170],[540,120],[600,230],[120,280],[360,290]]" :key="index" class="aq-particle" :style="{animationDelay:`${-index*1.7}s`}" :cx="dot[0]" :cy="dot[1]" :r="1.5 + index % 3 * .4" /></g>
      </g>
      <line x1="58" y1="110" x2="58" y2="310" stroke="var(--text)" stroke-opacity=".1" stroke-width="4" />
      <g v-if="!compact">
      <rect x="56" y="72" width="270" height="32" rx="16" fill="var(--surface)" />
      <circle cx="74" cy="88" r="5" :fill="mode === 'cloudy' ? 'var(--danger)' : mode === 'slight' ? 'var(--warning)' : 'var(--accent)'" />
      <text x="86" y="93" fill="var(--text)" font-size="14" font-weight="600">Độ trong · {{ clarityText }}<tspan v-if="finite(clarity)"> · {{ numberText(clarity, 0) }}%</tspan></text>
      <text x="698" y="46" text-anchor="middle" fill="var(--text)" font-size="16" font-weight="600">{{ numberText(temperature) }}{{ finite(temperature) ? ' °C' : '' }}</text>
      <rect x="690" y="58" width="16" height="256" rx="8" fill="var(--surface)" stroke="var(--border-strong)" stroke-width="1.5" />
      <rect v-if="finite(temperature)" x="694" :y="310 - tempHeight" width="8" :height="tempHeight + 6" rx="4" :fill="tempColor" />
      <circle cx="698" cy="328" r="14" :fill="tempColor" stroke="var(--border-strong)" stroke-width="1.5" />
      <path d="M710 122.5h12m-12 100h12" fill="none" stroke="var(--text-muted)" stroke-width="1.5" />
      <text x="726" y="127" fill="var(--text-muted)" font-size="13">30</text><text x="726" y="227" fill="var(--text-muted)" font-size="13">22</text>
      <text x="40" y="400" fill="var(--text-secondary)" font-size="15" font-weight="600">pH</text>
      <rect x="80" y="390" width="560" height="10" rx="5" :fill="`url(#${phId})`" />
      <rect x="340" y="385" width="80" height="20" rx="4" fill="none" stroke="var(--text)" stroke-opacity=".7" stroke-dasharray="3 3" />
      <polygon v-if="phX != null" :points="`${phX},386 ${phX - 6},375 ${phX + 6},375`" fill="var(--text)" />
      <text :x="phX ?? 360" y="366" text-anchor="middle" fill="var(--text)" font-size="15" font-weight="600">{{ numberText(ph, 2) }}</text>
      <text v-for="value in [0,7,14]" :key="value" :x="80 + value * 40" y="422" text-anchor="middle" fill="var(--text-muted)" font-size="13">{{ value }}</text>
      <text x="380" y="445" text-anchor="middle" fill="var(--text-muted)" font-size="13">Khung nét đứt: mốc tham khảo 6,5–8,5</text>
      </g>
    </svg>
    <span v-if="stampText" class="aq-stamp">{{ stampText }}</span>
    <dl v-if="!compact" class="aq-mobile-values"><div><dt>Nhiệt độ</dt><dd>{{ numberText(temperature) }} °C</dd></div><div><dt>pH</dt><dd>{{ numberText(ph, 2) }}</dd></div><div><dt>Độ trong</dt><dd>{{ numberText(clarity, 0) }} %</dd></div></dl>
  </div>
</template>
<style scoped>
.aq-root { position:relative; width:100%; --aq-water-top:color-mix(in srgb,var(--temperature) 45%,var(--background)); --aq-water-bottom:color-mix(in srgb,var(--temperature) 15%,var(--background)); --aq-sand:color-mix(in srgb,var(--warning) 22%,var(--surface)); --aq-fish-warm:color-mix(in srgb,var(--warning) 78%,var(--text)); --aq-fish-blue:color-mix(in srgb,var(--temperature) 70%,var(--text)); --aq-haze:color-mix(in srgb,var(--warning) 60%,var(--surface)); --aq-particles:color-mix(in srgb,var(--warning) 65%,var(--text)); }
.aq-illustration { display:block; width:100%; height:auto; stroke:none; font-family:var(--font-sans); }
.aq-f1,.aq-f2 { transform-box:fill-box; transform-origin:center; animation:aq-swim1 16s ease-in-out infinite; }
.aq-f2 { animation-name:aq-swim2; animation-duration:12s; }
.aq-bob { animation:aq-bob 3.2s ease-in-out infinite; }
.aq-bubble { transform-box:fill-box; animation:aq-rise 5s linear infinite; }
.aq-plant { transform-box:fill-box; transform-origin:50% 100%; animation:aq-sway 6s ease-in-out infinite; }
.aq-cloudy .aq-f1,.aq-cloudy .aq-f2 { animation-duration:28s; }
.aq-alert .aq-glass { stroke:var(--danger); animation:aq-pulse 2s ease-in-out infinite; }
.aq-offline .aq-illustration { filter:grayscale(1); opacity:.55; }
.aq-offline * { animation-play-state:paused!important; }
.aq-stamp { position:absolute; top:9%; right:17%; padding:6px 10px; border:1px solid var(--border-strong); border-radius:20px; background:var(--surface); color:var(--text); font-size:13px; font-weight:600; }
.aq-alert .aq-stamp { border-color:var(--danger); }
.aq-mobile-values { display:none; }
@keyframes aq-swim1 { 0% {transform:translateX(0) scaleX(1)} 46% {transform:translateX(320px) scaleX(1)} 50% {transform:translateX(320px) scaleX(-1)} 96% {transform:translateX(0) scaleX(-1)} 100% {transform:translateX(0) scaleX(1)} }
@keyframes aq-swim2 { 0% {transform:translateX(0) scaleX(-1)} 46% {transform:translateX(-260px) scaleX(-1)} 50% {transform:translateX(-260px) scaleX(1)} 96% {transform:translateX(0) scaleX(1)} 100% {transform:translateX(0) scaleX(-1)} }
@keyframes aq-bob { 0%,100% {transform:translateY(0)} 50% {transform:translate(6px,-10px)} }
@keyframes aq-rise { 0% {transform:translateY(0);opacity:0} 10% {opacity:.75} 85% {opacity:.5} 50% {transform:translate(7px,-130px)} 100% {transform:translate(-4px,-265px);opacity:0} }
@keyframes aq-sway { 0%,100% {transform:rotate(-3deg)} 50% {transform:rotate(3deg)} }
@keyframes aq-pulse { 0%,100% {opacity:1} 50% {opacity:.6} }
 .is-paused *,.aq-root[data-effects="off"] * {animation-play-state:paused!important}
@media(prefers-reduced-motion:reduce) { .aq-root[data-effects="off"] * {animation-play-state:paused!important} }
.aq-wave{animation:aq-wave 8s linear infinite}
.aq-ray{opacity:.04;animation:aq-ray 7s ease-in-out infinite;fill-opacity:1}
.aq-tail{transform-box:fill-box;transform-origin:100% 50%;animation:aq-tail .8s ease-in-out infinite}
.aq-school{animation:aq-school 24s ease-in-out infinite}
.aq-cloudy .aq-school{animation-duration:38s}
.aq-particle{animation:aq-drift 17s ease-in-out infinite alternate}
@keyframes aq-wave{to{transform:translateX(-100px)}}
@keyframes aq-ray{0%,100%{opacity:.02}50%{opacity:.06}}
@keyframes aq-tail{0%,100%{transform:rotate(-9deg)}50%{transform:rotate(9deg)}}
@keyframes aq-school{0%,100%{transform:translate(0,0) scaleX(1)}45%{transform:translate(180px,-15px) scaleX(1)}50%{transform:translate(180px,-15px) scaleX(-1)}95%{transform:translate(0,8px) scaleX(-1)}}
@keyframes aq-drift{0%{transform:translate(-5px,9px)}50%{transform:translate(9px,-7px)}100%{transform:translate(-8px,-15px)}}

@media(max-width:600px) { .aq-mobile-values { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; margin:0; padding:0 12px 12px; font-size:13px; } .aq-mobile-values dt {color:var(--text-muted)} .aq-mobile-values dd {margin:4px 0 0;font-weight:600} .aq-stamp {font-size:12px;top:3%;right:10%;padding:4px 8px} }
</style>
