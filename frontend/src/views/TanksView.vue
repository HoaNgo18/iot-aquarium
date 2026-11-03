<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useSession } from '../app/session'
import { api, jsonBody } from '../app/api'
import type { Tank } from '../app/types'
import TankCard from '../components/TankCard.vue'
import AppIcon from '../components/AppIcon.vue'
import AppDialog from '../components/AppDialog.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
const props = defineProps<{ addOnOpen?: boolean }>()
const session = useSession(), state = session.state
const formOpen = ref(false), editing = ref<Tank | null>(null), deleting = ref<Tank | null>(null)
const busy = ref(false), error = ref(''), deleteError = ref('')
const form = reactive({ name: '', device_id: '', pairing_code: '', volume_l: '', species: '' })
function open(tank: Tank | null = null) {
  editing.value = tank; error.value = ''
  Object.assign(form, { name: tank?.name ?? '', device_id: tank?.device_id ?? '', pairing_code: '', volume_l: tank?.volume_l == null ? '' : String(tank.volume_l), species: tank?.species ?? '' })
  formOpen.value = true
}
async function save() {
  error.value = ''
  const volume = String(form.volume_l).trim() ? Number(form.volume_l) : null
  if (!form.name.trim()) { error.value = 'Nhập tên bể.'; return }
  if (volume != null && (!Number.isFinite(volume) || volume <= 0 || volume > 100000)) { error.value = 'Thể tích phải lớn hơn 0 và không quá 100.000 lít.'; return }
  if (!editing.value && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(form.device_id.trim())) { error.value = 'Mã thiết bị chỉ gồm chữ, số, gạch ngang và gạch dưới, tối đa 64 ký tự.'; return }
  if (!editing.value && !/^[A-Z2-7]{4}-?[A-Z2-7]{4}$/.test(form.pairing_code.trim().toUpperCase())) { error.value = 'Mã ghép nối gồm 8 ký tự trên nhãn, dạng XXXX-XXXX.'; return }
  busy.value = true
  try {
    const body = { name: form.name.trim(), volume_l: volume, species: form.species.trim() || null,
      ...(!editing.value ? { device_id: form.device_id.trim(), pairing_code: form.pairing_code.trim().toUpperCase() } : {}) }
    await api<Tank>(editing.value ? `/tanks/${editing.value.id}` : '/tanks', { method: editing.value ? 'PATCH' : 'POST', body: jsonBody(body) })
    formOpen.value = false; session.notify(editing.value ? 'Đã cập nhật bể.' : 'Đã thêm bể. Có thể bắt đầu theo dõi.'); await session.refresh(true)
  } catch (cause) { error.value = (cause as Error).message }
  finally { busy.value = false }
}
async function remove() {
  if (!deleting.value) return
  busy.value = true; deleteError.value = ''
  try { await api<void>(`/tanks/${deleting.value.id}`, { method: 'DELETE' }); deleting.value = null; session.notify('Đã bỏ ghép nối bể. Dữ liệu đo vẫn được giữ.'); await session.refresh(true) }
  catch (cause) { deleteError.value = (cause as Error).message }
  finally { busy.value = false }
}
onMounted(() => { if (props.addOnOpen) open() })
</script>
<template>
  <section class="shell-page">
    <header class="shell-page-heading"><div><p class="shell-eyebrow">KHÔNG GIAN CỦA BẠN</p><h1>Bể của tôi</h1><p class="shell-muted">Theo dõi từng bể, chăm sóc theo cách của bạn.</p></div><button type="button" class="shell-button is-primary" @click="open()"><AppIcon name="plus" />Thêm bể</button></header>
    <div v-if="state.tanksError" class="shell-error-box" role="alert"><p>{{ state.tanksError }}</p><button type="button" class="shell-button" @click="session.refresh(true)">Thử lại</button></div>
    <p v-if="state.loadingTanks && !state.loadedTanks" class="shell-loading" role="status">Đang tải các bể của bạn…</p>
    <div v-else-if="!state.tanks.length && !state.tanksError" class="shell-empty"><AppIcon name="tanks" :size="42" /><h2>Bể cá đầu tiên đang chờ bạn</h2><p>Thêm mã thiết bị và mã ghép nối để bắt đầu nhận số đo.</p><button type="button" class="shell-button is-primary" @click="open()">Thêm bể đầu tiên</button></div>
    <div v-else class="shell-tank-grid"><TankCard v-for="tank in state.tanks" :key="tank.id" :tank="tank" :now="state.now.getTime()" @edit="open" @remove="deleting = $event; deleteError = ''" /></div>
    <AppDialog :open="formOpen" :title="editing ? 'Sửa thông tin bể' : 'Thêm bể mới'" :busy="busy" @close="formOpen = false">
      <form class="shell-form" novalidate @submit.prevent="save"><label class="shell-field">Tên bể<input v-model="form.name" maxlength="64" required :disabled="busy" placeholder="Ví dụ: Bể phòng khách" /></label>
        <template v-if="!editing"><label class="shell-field">Mã thiết bị<input v-model="form.device_id" maxlength="64" required :disabled="busy" autocapitalize="none" spellcheck="false" placeholder="tank-ds18b20-001" /></label><label class="shell-field">Mã ghép nối<input v-model="form.pairing_code" maxlength="12" required :disabled="busy" autocomplete="off" spellcheck="false" aria-describedby="pairing-hint" placeholder="XXXX-XXXX" /></label><p id="pairing-hint" class="shell-hint">In trên nhãn thiết bị, dạng XXXX-XXXX. Liên hệ người cài đặt nếu chưa có mã.</p></template>
        <div class="shell-form-pair"><label class="shell-field">Thể tích (lít, tuỳ chọn)<input v-model="form.volume_l" type="number" min="0.1" max="100000" step="any" inputmode="decimal" :disabled="busy" /></label><label class="shell-field">Loài cá (tuỳ chọn)<input v-model="form.species" maxlength="64" :disabled="busy" placeholder="Ví dụ: Cá vàng" /></label></div>
        <p v-if="error" class="shell-error" role="alert">{{ error }}</p><div class="shell-actions"><button type="button" class="shell-button" :disabled="busy" @click="formOpen = false">Hủy</button><button type="submit" class="shell-button is-primary" :disabled="busy">{{ busy ? 'Đang lưu…' : editing ? 'Lưu thay đổi' : 'Thêm bể' }}</button></div>
      </form>
    </AppDialog>
    <ConfirmDialog :open="!!deleting" title="Xoá bể khỏi tài khoản?" :message="`Bể “${deleting?.name ?? ''}” sẽ được bỏ ghép nối. Dữ liệu đo vẫn được giữ; các nhắc việc của bể sẽ bị xoá.`" :busy="busy" :error="deleteError" @close="deleting = null" @confirm="remove" />
  </section>
</template>
