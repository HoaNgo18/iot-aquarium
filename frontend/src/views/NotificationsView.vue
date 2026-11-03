<script setup lang="ts">
import { computed } from 'vue'
import { useSession } from '../app/session'
import { tankHref } from '../app/route'
import { formatStamp } from '../app/format'
import { dueLabel } from '../app/reminders'
import AppIcon from '../components/AppIcon.vue'
const session = useSession(), state = session.state
const alerts = computed(() => [...state.alerts].sort((a, b) => b.started_at.localeCompare(a.started_at)))
</script>
<template>
  <section class="shell-page"><header class="shell-page-heading"><div><p class="shell-eyebrow">ĐIỀU CẦN CHÚ Ý</p><h1>Thông báo</h1><p class="shell-muted">Cảnh báo của các bể và những việc sắp đến hạn.</p></div><button type="button" class="shell-button" @click="session.refresh(true)">Làm mới</button></header>
    <div v-if="state.tanksError || state.alertsError || state.remindersError" class="shell-error-box" role="alert"><p>{{ state.tanksError || state.alertsError || state.remindersError }}</p><button type="button" class="shell-button" @click="session.refresh(true)">Thử lại</button></div>
    <p v-if="(state.loadingTanks || state.loadingReminders || state.loadingAlerts) && !alerts.length" class="shell-loading" role="status">Đang tải thông báo…</p>
    <div v-else-if="!alerts.length && !session.dueReminders.value.length && !state.tanksError && !state.alertsError && !state.remindersError" class="shell-empty"><AppIcon name="notifications" :size="42" /><h2>Không có thông báo</h2><p>Các cảnh báo và việc đến hạn sẽ xuất hiện ở đây.</p></div>
    <div class="shell-list-scroll">
    <section v-if="alerts.length" class="shell-notification-section"><h2>Cảnh báo đang mở</h2><ul class="shell-notification-list"><li v-for="alert in alerts" :key="`${alert.device_id}-${alert.id}`"><span class="shell-notice-icon"><AppIcon name="notifications" /></span><div class="shell-grow"><h3>{{ alert.tank_name }}</h3><p>{{ alert.message }}</p><small>Bắt đầu {{ formatStamp(alert.started_at) }}</small></div><a class="shell-button" :href="tankHref(alert.device_id)">Xem bể<AppIcon name="arrow" :size="17" /></a></li></ul></section>
    <section v-if="session.dueReminders.value.length" class="shell-notification-section"><h2>Nhắc việc đến hạn</h2><ul class="shell-notification-list"><li v-for="item in session.dueReminders.value" :key="item.id"><span class="shell-notice-icon"><AppIcon name="reminders" /></span><div class="shell-grow"><h3>{{ item.title }}</h3><p>{{ item.tank_name || 'Chung' }} · {{ dueLabel(item.due_date, state.now) }}</p></div><a href="#/reminders" class="shell-button">Xem việc<AppIcon name="arrow" :size="17" /></a></li></ul></section>
    </div>
  </section>
</template>
