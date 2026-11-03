<script setup lang="ts">
import {applyMotion,motionPreference,type MotionPreference} from '../app/motion'
import { ref, reactive, watch, onBeforeUnmount } from 'vue'
import { api, jsonBody } from '../app/api'
import { useSession } from '../app/session'
import { applyTheme, readStorage, writeStorage, themePreference, THEME_KEY, type ThemePreference } from '../app/theme'
import type { User } from '../app/types'
import PasswordField from '../components/PasswordField.vue'
import AppIcon from '../components/AppIcon.vue'
const session = useSession(), state = session.state
const preference = ref(themePreference(readStorage(THEME_KEY)))
const themeOptions: { value: ThemePreference; label: string }[] = [{ value: 'light', label: 'Sáng' }, { value: 'dark', label: 'Tối' }, { value: 'system', label: 'Theo hệ thống' }]
function changeTheme(value: ThemePreference) { preference.value = value; writeStorage(THEME_KEY, value); applyTheme(value) }
const themeChanged = () => { preference.value = themePreference(readStorage(THEME_KEY)) }
window.addEventListener('aquasense:theme', themeChanged)
onBeforeUnmount(() => window.removeEventListener('aquasense:theme', themeChanged))
const motion=ref(motionPreference(readStorage('aquasense-motion')))
const motionOptions=[{value:'on',label:'Bật'},{value:'off',label:'Tắt'},{value:'system',label:'Theo hệ thống'}] as const
function changeMotion(value:MotionPreference){motion.value=value;writeStorage('aquasense-motion',value);applyMotion(value)}
const displayName = ref(state.user?.display_name ?? '')
watch(() => state.user?.display_name, value => { displayName.value = value ?? '' })
const profileBusy = ref(false), profileError = ref(''), profileMessage = ref('')
const passwords = reactive({ current: '', next: '', confirm: '' })
const passwordBusy = ref(false), passwordError = ref(''), passwordMessage = ref('')
const logoutBusy = ref(false), logoutError = ref('')
async function saveProfile() {
  profileError.value = profileMessage.value = ''
  if (!displayName.value.trim()) { profileError.value = 'Tên hiển thị không được trống.'; return }
  profileBusy.value = true
  try { state.user = await api<User>('/auth/me', { method: 'PATCH', body: jsonBody({ display_name: displayName.value.trim() }) }); profileMessage.value = 'Đã lưu tên hiển thị.' }
  catch (cause) { profileError.value = (cause as Error).message }
  finally { profileBusy.value = false }
}
async function savePassword() {
  passwordError.value = passwordMessage.value = ''
  if (!passwords.current) { passwordError.value = 'Nhập mật khẩu hiện tại.'; return }
  if (passwords.next.length < 8) { passwordError.value = 'Mật khẩu mới cần ít nhất 8 ký tự.'; return }
  if (passwords.next !== passwords.confirm) { passwordError.value = 'Hai lần nhập mật khẩu mới chưa khớp.'; return }
  passwordBusy.value = true
  try { await api<User>('/auth/password', { method: 'POST', body: jsonBody({ current_password: passwords.current, new_password: passwords.next }) }); Object.assign(passwords, { current: '', next: '', confirm: '' }); passwordMessage.value = 'Đã đổi mật khẩu. Các phiên trên thiết bị khác đã đăng xuất.' }
  catch (cause) { passwordError.value = (cause as Error).message }
  finally { passwordBusy.value = false }
}
async function logout() {
  logoutBusy.value = true; logoutError.value = ''
  try { await session.logout() }
  catch (cause) { logoutError.value = (cause as Error).message }
  finally { logoutBusy.value = false }
}
</script>
<template>
  <section class="shell-page shell-settings-page"><header class="shell-page-heading"><div><p class="shell-eyebrow">THEO CÁCH CỦA BẠN</p><h1>Cài đặt</h1><p class="shell-muted">Giao diện và tài khoản AquaSense.</p></div></header>
    <div class="shell-settings-columns"><div class="shell-settings-column"><section class="shell-settings-section"><div><h2>Giao diện</h2><p class="shell-muted">Chọn màu nền dễ chịu cho mắt.</p></div><fieldset class="shell-theme-options"><legend class="sr-only">Chọn giao diện</legend><label v-for="option in themeOptions" :key="option.value" :class="{ 'is-selected': preference === option.value }"><input type="radio" name="app-theme" :value="option.value" :checked="preference === option.value" @change="changeTheme(option.value)" />{{ option.label }}</label></fieldset><fieldset class="shell-theme-options"><legend>Hiệu ứng chuyển động</legend><label v-for="option in motionOptions" :key="option.value"><input type="radio" name="app-motion" :value="option.value" :checked="motion===option.value" @change="changeMotion(option.value)" />{{ option.label }}</label></fieldset><p class="shell-muted motion-note">Nếu bể cá đứng yên, có thể Windows đang tắt hiệu ứng động (Cài đặt → Trợ năng → Hiệu ứng hình ảnh).</p></section>
    <section class="shell-settings-section"><div><h2>Hồ sơ</h2><p class="shell-muted">Tên hiển thị xuất hiện trên thanh bên.</p></div><form class="shell-form" novalidate @submit.prevent="saveProfile"><label class="shell-field">Tên đăng nhập<input :value="state.user?.username" readonly autocomplete="username" /></label><label class="shell-field">Tên hiển thị<input v-model="displayName" required maxlength="64" autocomplete="name" :disabled="profileBusy" /></label><p v-if="profileError" role="alert" class="shell-error">{{ profileError }}</p><p v-if="profileMessage" role="status" class="shell-success">{{ profileMessage }}</p><div><button type="submit" class="shell-button is-primary" :disabled="profileBusy">{{ profileBusy ? 'Đang lưu…' : 'Lưu hồ sơ' }}</button></div></form></section>
    </div><div class="shell-settings-column"><section class="shell-settings-section"><div><h2>Đổi mật khẩu</h2><p class="shell-muted">Dùng ít nhất 8 ký tự.</p></div><form class="shell-form" novalidate @submit.prevent="savePassword"><PasswordField v-model="passwords.current" label="Mật khẩu hiện tại" :disabled="passwordBusy" /><PasswordField v-model="passwords.next" label="Mật khẩu mới" autocomplete="new-password" :disabled="passwordBusy" /><PasswordField v-model="passwords.confirm" label="Nhập lại mật khẩu mới" autocomplete="new-password" :disabled="passwordBusy" /><p v-if="passwordError" role="alert" class="shell-error">{{ passwordError }}</p><p v-if="passwordMessage" role="status" class="shell-success">{{ passwordMessage }}</p><div><button type="submit" class="shell-button is-primary" :disabled="passwordBusy">{{ passwordBusy ? 'Đang lưu…' : 'Đổi mật khẩu' }}</button></div></form></section>
    <section class="shell-settings-section"><div><h2>Phiên đăng nhập</h2><p class="shell-muted">Đăng xuất tài khoản trên trình duyệt này.</p></div><div><button type="button" class="shell-button" :disabled="logoutBusy" @click="logout"><AppIcon name="logout" />{{ logoutBusy ? 'Đang đăng xuất…' : 'Đăng xuất' }}</button><p v-if="logoutError" role="alert" class="shell-error">{{ logoutError }}</p></div></section>
    </div></div>
  </section>
</template>
