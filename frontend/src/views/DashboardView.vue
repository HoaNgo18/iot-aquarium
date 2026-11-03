<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import template from '../dashboard/template.html?raw'
import { mountDashboard } from '../dashboard/dashboard.js'
import { useRealtime } from '../composables/useRealtime'

const props = defineProps<{ deviceId: string }>()
const root = ref<HTMLElement | null>(null)
const deviceId = ref(props.deviceId)
let dashboard: ReturnType<typeof mountDashboard> | undefined
const { state: realtime } = useRealtime(deviceId, async () => { await dashboard?.refresh() })
const label = () => realtime.value === 'connected' ? 'Live' : 'Đang kết nối lại'
onMounted(() => {
  dashboard = mountDashboard(root.value!, id => { deviceId.value = id }, label, { deviceId: props.deviceId, embedded: true })
})
onBeforeUnmount(() => dashboard?.dispose())
</script>

<template>
  <!-- Trusted bundled markup. All server text is escaped by the dashboard renderer. -->
  <div ref="root" class="monitoring-dashboard" v-html="template"></div>
</template>
