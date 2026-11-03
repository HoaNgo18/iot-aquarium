<script setup lang="ts">
import { computed } from 'vue'
import { useSession } from '../app/session'
import { tankHref } from '../app/route'
import AppIcon from '../components/AppIcon.vue'
import DashboardView from './DashboardView.vue'
const props = defineProps<{ deviceId: string }>()
const session = useSession(), state = session.state
const tank = computed(() => state.tanks.find(item => item.device_id === props.deviceId))
function switchTank(event: Event) { location.hash = tankHref((event.target as HTMLSelectElement).value).slice(1) }
</script>
<template>
  <section class="shell-detail">
    <div class="shell-detail-header"><div><a href="#/tanks" class="shell-back"><AppIcon name="back" :size="18" />Bể của tôi</a><h1>{{ tank?.name ?? 'Chi tiết bể' }}</h1><p v-if="tank" class="shell-device-id">{{ tank.device_id }}</p></div><label v-if="tank && state.tanks.length > 1" class="shell-field shell-tank-switch">Chuyển bể<select :value="deviceId" @change="switchTank"><option v-for="item in state.tanks" :key="item.id" :value="item.device_id">{{ item.name }}</option></select></label></div>
    <div v-if="state.tanksError" class="shell-error-box" role="alert"><p>{{ state.tanksError }}</p><button type="button" class="shell-button" @click="session.refresh(true)">Thử lại</button></div>
    <p v-else-if="!state.loadedTanks" class="shell-loading" role="status">Đang tìm bể…</p>
    <div v-else-if="!tank" class="shell-empty"><h2>Không tìm thấy bể</h2><p>Bể này chưa được ghép nối với tài khoản của bạn.</p><a href="#/tanks" class="shell-button">Về Bể của tôi</a></div>
    <DashboardView v-else :key="deviceId" :device-id="deviceId" />
  </section>
</template>
