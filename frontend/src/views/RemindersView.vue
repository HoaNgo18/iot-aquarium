<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { api, jsonBody } from '../app/api'
import { useSession } from '../app/session'
import { groupReminders, dueLabel, REPEAT_LABELS } from '../app/reminders'
import { todayVN, validDate, formatDate } from '../app/format'
import type { Reminder, Repeat } from '../app/types'
import AppIcon from '../components/AppIcon.vue'
import AppDialog from '../components/AppDialog.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
const session = useSession(), state = session.state
const groups = computed(() => groupReminders(state.reminders, state.now))
const formOpen = ref(false), editing = ref<Reminder | null>(null), deleting = ref<Reminder | null>(null)
const busy = ref(false), activeId = ref<number | null>(null), error = ref(''), deleteError = ref(''), actionError = ref('')
const form = reactive({ title: '', tank_id: '', due_date: todayVN(), repeat: 'none' as Repeat, note: '' })
function open(item: Reminder | null = null) {
  editing.value = item; error.value = ''
  Object.assign(form, { title: item?.title ?? '', tank_id: item?.tank_id == null ? '' : String(item.tank_id), due_date: item?.due_date ?? todayVN(), repeat: item?.repeat ?? 'none', note: item?.note ?? '' })
  formOpen.value = true
}
async function save() {
  error.value = ''
  if (!form.title.trim()) { error.value = 'Nhập việc cần làm.'; return }
  if (!validDate(form.due_date)) { error.value = 'Chọn ngày đến hạn hợp lệ.'; return }
  busy.value = true
  try {
    await api<Reminder>(editing.value ? `/reminders/${editing.value.id}` : '/reminders', { method: editing.value ? 'PATCH' : 'POST', body: jsonBody({ title: form.title.trim(), note: form.note.trim() || null, tank_id: form.tank_id ? Number(form.tank_id) : null, repeat: form.repeat, due_date: form.due_date }) })
    formOpen.value = false; session.notify(editing.value ? 'Đã cập nhật nhắc việc.' : 'Đã thêm nhắc việc.'); await session.refresh(true)
  } catch (cause) { error.value = (cause as Error).message }
  finally { busy.value = false }
}
async function complete(item: Reminder) {
  if (activeId.value != null) return
  activeId.value = item.id; actionError.value = ''
  try {
    const saved = await api<Reminder>(`/reminders/${item.id}/${item.done_at ? 'reopen' : 'complete'}`, { method: 'POST' })
    session.notify(item.done_at ? 'Đã mở lại nhắc việc.' : saved.repeat === 'none' ? 'Đã đánh dấu xong.' : `Đã xong · lần tới ${formatDate(saved.due_date, true)}`)
    await session.refresh(true)
  } catch (cause) { actionError.value = (cause as Error).message }
  finally { activeId.value = null }
}
async function remove() {
  if (!deleting.value) return
  busy.value = true; deleteError.value = ''
  try { await api<void>(`/reminders/${deleting.value.id}`, { method: 'DELETE' }); deleting.value = null; session.notify('Đã xoá nhắc việc.'); await session.refresh(true) }
  catch (cause) { deleteError.value = (cause as Error).message }
  finally { busy.value = false }
}
</script>
<template>
  <section class="shell-page">
    <header class="shell-page-heading"><div><p class="shell-eyebrow">MỖI VIỆC ĐÚNG LÚC</p><h1>Nhắc việc</h1><p class="shell-muted">Lịch chăm sóc bể, theo giờ Việt Nam.</p></div><button type="button" class="shell-button is-primary" @click="open()"><AppIcon name="plus" />Thêm nhắc việc</button></header>
    <div v-if="state.remindersError" class="shell-error-box" role="alert"><p>{{ state.remindersError }}</p><button type="button" class="shell-button" @click="session.refresh(true)">Thử lại</button></div>
    <p v-if="actionError" role="alert" class="shell-error">{{ actionError }}</p>
    <p v-if="state.loadingReminders && !state.loadedReminders" class="shell-loading" role="status">Đang tải nhắc việc…</p>
    <div v-else-if="!state.reminders.length && !state.remindersError" class="shell-empty"><AppIcon name="reminders" :size="42" /><h2>Một lịch chăm bể gọn gàng</h2><p>Thêm việc thay nước, vệ sinh lọc hoặc kiểm tra cảm biến.</p><button type="button" class="shell-button is-primary" @click="open()">Thêm nhắc việc đầu tiên</button></div>
    <div class="shell-list-scroll">
    <template v-for="group in groups" :key="group.key"><section v-if="group.items.length" class="shell-reminder-group" :aria-labelledby="`group-${group.key}`"><h2 :id="`group-${group.key}`">{{ group.label }} <span>{{ group.items.length }}</span></h2><ul class="shell-reminder-list"><li v-for="item in group.items" :key="item.id" :class="{ 'is-done': item.done_at }"><button type="button" class="shell-complete" :class="{ 'is-complete': item.done_at }" :aria-label="`${item.done_at ? 'Mở lại' : 'Đánh dấu xong'}: ${item.title}`" :disabled="activeId != null" @click="complete(item)"><AppIcon v-if="item.done_at" name="check" :size="19" /><span v-else aria-hidden="true"></span></button><div class="shell-grow"><h3>{{ item.title }}</h3><p>{{ item.tank_name || 'Chung' }} <span aria-hidden="true">·</span> {{ REPEAT_LABELS[item.repeat] }} <span aria-hidden="true">·</span> <span :class="{ 'shell-overdue': group.key === 'overdue' }">{{ dueLabel(item.due_date, state.now) }}</span></p><p v-if="item.note" class="shell-reminder-note">{{ item.note }}</p></div><div class="shell-row-actions"><button type="button" class="shell-icon-button" :aria-label="`Sửa nhắc việc ${item.title}`" @click="open(item)"><AppIcon name="edit" :size="19" /></button><button type="button" class="shell-icon-button" :aria-label="`Xoá nhắc việc ${item.title}`" @click="deleting = item; deleteError = ''"><AppIcon name="trash" :size="19" /></button></div></li></ul></section></template>
    </div>
    <AppDialog :open="formOpen" :title="editing ? 'Sửa nhắc việc' : 'Thêm nhắc việc'" :busy="busy" @close="formOpen = false"><form class="shell-form" novalidate @submit.prevent="save"><label class="shell-field">Việc cần làm<input v-model="form.title" maxlength="120" required :disabled="busy" placeholder="Ví dụ: Vệ sinh lọc" /></label><label class="shell-field">Bể (tuỳ chọn)<select v-model="form.tank_id" :disabled="busy || !!state.tanksError"><option value="">Chung</option><option v-for="tank in state.tanks" :key="tank.id" :value="String(tank.id)">{{ tank.name }}</option></select></label><p v-if="state.tanksError" class="shell-error" role="alert">Chưa tải được danh sách bể. Đóng hộp thoại và thử tải lại trước khi sửa liên kết bể.</p><div class="shell-form-pair"><label class="shell-field">Ngày đến hạn<input v-model="form.due_date" type="date" required :disabled="busy" /></label><label class="shell-field">Lặp lại<select v-model="form.repeat" :disabled="busy"><option v-for="(label, key) in REPEAT_LABELS" :key="key" :value="key">{{ label }}</option></select></label></div><label class="shell-field">Ghi chú (tuỳ chọn)<textarea v-model="form.note" rows="3" maxlength="500" :disabled="busy"></textarea></label><p v-if="error" role="alert" class="shell-error">{{ error }}</p><div class="shell-actions"><button type="button" class="shell-button" :disabled="busy" @click="formOpen = false">Hủy</button><button type="submit" class="shell-button is-primary" :disabled="busy">{{ busy ? 'Đang lưu…' : 'Lưu nhắc việc' }}</button></div></form></AppDialog>
    <ConfirmDialog :open="!!deleting" title="Xoá nhắc việc?" :message="`Xoá “${deleting?.title ?? ''}” khỏi lịch của bạn?`" :busy="busy" :error="deleteError" @close="deleting = null" @confirm="remove" />
  </section>
</template>
