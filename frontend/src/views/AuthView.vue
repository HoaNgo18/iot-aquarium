<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { api, jsonBody } from '../app/api'
import { useSession } from '../app/session'
import type { User } from '../app/types'
import PasswordField from '../components/PasswordField.vue'
import AppIcon from '../components/AppIcon.vue'
const session = useSession()
const mode = ref<'login' | 'register'>('login')
const username = ref(''), name = ref(''), password = ref(''), confirmation = ref('')
const error = ref(''), busy = ref(false)
watch(mode, () => { password.value = confirmation.value = error.value = '' })
async function switchTab() { mode.value = mode.value === 'login' ? 'register' : 'login'; await nextTick(); document.getElementById(`auth-${mode.value}-tab`)?.focus() }
async function submit() {
  error.value = ''
  const normalized = username.value.trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(normalized)) { error.value = 'Tên đăng nhập gồm 3–32 ký tự: chữ thường, số, dấu chấm, gạch dưới hoặc gạch ngang.'; return }
  if (password.value.length < 8) { error.value = 'Mật khẩu cần ít nhất 8 ký tự.'; return }
  if (mode.value === 'register' && !name.value.trim()) { error.value = 'Nhập tên hiển thị của bạn.'; return }
  if (mode.value === 'register' && password.value !== confirmation.value) { error.value = 'Hai lần nhập mật khẩu chưa khớp.'; return }
  busy.value = true
  try {
    const user = await api<User>(`/auth/${mode.value}`, { method: 'POST', body: jsonBody({ username: normalized, password: password.value, ...(mode.value === 'register' ? { display_name: name.value.trim() } : {}) }) })
    password.value = confirmation.value = ''
    await session.authenticated(user)
  } catch (cause) { error.value = (cause as Error).message }
  finally { busy.value = false }
}
</script>
<template>
  <main class="shell-auth auth-with-intro">
    <section class="auth-introduction">    <div class="shell-auth-brand"><span class="shell-brand-mark"><AppIcon name="drop" :size="26" /></span><strong>AquaSense</strong></div>
    <h2>Hiểu bể cá. Chăm sóc tốt hơn.</h2>
    <p>ESP32 đo nhiệt độ, pH và độ trong của nước, gửi qua MQTT về máy chủ.</p>
    <p>AquaSense giúp theo dõi theo thời gian thực, nhận cảnh báo và nhắc việc chăm bể.</p>
    <h3>Hệ thống hoạt động thế nào</h3>
    <ol class="auth-flow"><li><AppIcon name="drop" /><strong>Cảm biến</strong><span>Đo 3 chỉ số nước.</span></li><li><AppIcon name="sensor" /><strong>ESP32</strong><span>Thu và gửi qua Wi-Fi.</span></li><li><AppIcon name="server" /><strong>MQTT & máy chủ</strong><span>Lưu dữ liệu, kiểm tra ngưỡng.</span></li><li><AppIcon name="chart" /><strong>Web & cảnh báo</strong><span>Theo dõi và nhận cảnh báo.</span></li></ol>
</section>
    <section class="shell-auth-card" aria-labelledby="auth-title">
      <p class="shell-eyebrow">CHĂM BỂ CÁ, THẢNH THƠI HƠN</p><h1 id="auth-title">{{ mode === 'login' ? 'Chào mừng trở lại' : 'Bắt đầu với AquaSense' }}</h1><p class="shell-muted">{{ mode === 'login' ? 'Đăng nhập để theo dõi bể cá của bạn.' : 'Tạo tài khoản để kết nối bể cá đầu tiên.' }}</p>
      <div class="shell-auth-tabs" role="tablist" aria-label="Tài khoản"><button id="auth-login-tab" type="button" role="tab" :aria-selected="mode === 'login'" aria-controls="auth-panel" :tabindex="mode === 'login' ? 0 : -1" :disabled="busy" @click="mode = 'login'" @keydown.right.prevent="switchTab" @keydown.left.prevent="switchTab">Đăng nhập</button><button id="auth-register-tab" type="button" role="tab" :aria-selected="mode === 'register'" aria-controls="auth-panel" :tabindex="mode === 'register' ? 0 : -1" :disabled="busy" @click="mode = 'register'" @keydown.left.prevent="switchTab" @keydown.right.prevent="switchTab">Tạo tài khoản</button></div>
      <form id="auth-panel" role="tabpanel" :aria-labelledby="mode === 'login' ? 'auth-login-tab' : 'auth-register-tab'" class="shell-form" novalidate :aria-busy="busy" @submit.prevent="submit">
        <label v-if="mode === 'register'" class="shell-field">Tên hiển thị<input v-model="name" autocomplete="name" maxlength="64" :disabled="busy" required placeholder="Tên của bạn" /></label>
        <label class="shell-field">Tên đăng nhập<input v-model="username" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="32" :disabled="busy" required placeholder="Ví dụ: hoa.ngo" /></label>
        <PasswordField v-model="password" label="Mật khẩu" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" :disabled="busy" />
        <PasswordField v-if="mode === 'register'" v-model="confirmation" label="Nhập lại mật khẩu" autocomplete="new-password" :disabled="busy" />
        <p v-if="error" class="shell-error" role="alert">{{ error }}</p><p v-else-if="session.state.expired" class="shell-muted" role="status">Phiên đã hết hạn. Đăng nhập lại để tiếp tục.</p>
        <button type="submit" class="shell-button is-primary shell-full" :disabled="busy">{{ busy ? 'Đang xử lý…' : mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản' }}<AppIcon v-if="!busy" name="arrow" :size="19" /></button>
      </form>
    </section>
  </main>
</template>
