<script setup lang="ts">
import { computed } from 'vue'
import type { Tank } from '../app/types'
import { tankStatus, clarityLabel } from '../app/tanks'
import { tankHref } from '../app/route'
import { numberText, relativeTime, formatStamp } from '../app/format'
import AppIcon from './AppIcon.vue'
const props = defineProps<{ tank: Tank; now: number; compact?: boolean }>()
const emit = defineEmits<{ edit: [tank: Tank]; remove: [tank: Tank] }>()
const status = computed(() => tankStatus(props.tank))
</script>
<template>
  <article class="shell-tank-card" :class="{ 'is-compact': compact, 'is-offline': tank.connectivity !== 'online' }">
    <header><span class="shell-tank-symbol"><AppIcon name="tanks" /></span><div class="shell-grow"><h3><a :href="tankHref(tank.device_id)">{{ tank.name }}</a></h3><p v-if="!compact" class="shell-device-id">{{ tank.device_id }}</p></div><span class="shell-chip" :class="`is-${status.tone}`">{{ status.label }}</span></header>
    <dl class="shell-readings"><div><dt>Nhiệt độ</dt><dd>{{ numberText(tank.latest?.temperature_c) }}<small> °C</small></dd></div><div><dt>pH</dt><dd>{{ numberText(tank.latest?.ph, 2) }}</dd><small v-if="tank.latest?.ph == null && tank.latest?.ph_mv != null">Chưa hiệu chuẩn</small></div><div><dt>Độ trong</dt><dd>{{ numberText(tank.latest?.clarity_pct, 0) }}<small> %</small></dd><small v-if="tank.latest?.clarity_pct != null">{{ clarityLabel(tank.latest.clarity_pct, tank.latest.clarity_state) }}</small></div></dl>
    <p class="shell-card-time" :title="formatStamp(tank.latest?.measured_at)">{{ tank.connectivity !== 'online' && tank.latest ? 'Giá trị cuối · ' : 'Cập nhật ' }}{{ relativeTime(tank.latest?.measured_at, now) }}</p>
    <template v-if="!compact"><p class="shell-tank-meta">{{ tank.volume_l == null ? 'Chưa đặt thể tích' : `${numberText(tank.volume_l, 0)} lít` }} · {{ tank.species || 'Chưa đặt loài cá' }}</p><footer class="shell-card-actions"><a class="shell-button" :href="tankHref(tank.device_id)">Xem <AppIcon name="arrow" :size="17" /></a><button type="button" class="shell-icon-button" :aria-label="`Sửa bể ${tank.name}`" title="Sửa bể" @click="emit('edit', tank)"><AppIcon name="edit" :size="19" /></button><button type="button" class="shell-icon-button" :aria-label="`Xoá bể ${tank.name}`" title="Xoá bể" @click="emit('remove', tank)"><AppIcon name="trash" :size="19" /></button></footer></template>
    <a v-else :href="tankHref(tank.device_id)" class="shell-card-link">Xem bể <AppIcon name="arrow" :size="17" /></a>
  </article>
</template>
