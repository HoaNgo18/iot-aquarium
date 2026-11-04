<script setup lang="ts">
import { computed } from 'vue'
import { useSession } from '../app/session'
import DashboardView from './DashboardView.vue'
const props = defineProps<{ deviceId: string }>()
const session = useSession(), state = session.state
const tank = computed(() => state.tanks.find(item => item.device_id === props.deviceId))
</script>
<template>
  <section class="shell-detail">
    <div v-if="state.tanksError" class="shell-error-box" role="alert"><p>{{ state.tanksError }}</p><button type="button" class="shell-button" @click="session.refresh(true)">Thử lại</button></div>
    <p v-else-if="!state.loadedTanks" class="shell-loading" role="status">Đang tìm bể…</p>
    <div v-else-if="!tank" class="shell-empty"><h2>Không tìm thấy bể</h2><p>Bể này chưa được ghép nối với tài khoản của bạn.</p><a href="#/tanks" class="shell-button">Về Bể của tôi</a></div>
    <DashboardView v-else :key="deviceId" :device-id="deviceId" />
  </section>
</template>
