<script setup lang="ts">
import { computed, ref, provide, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { createSession, SessionKey } from './app/session'
import { parseRoute, PAGE_TITLES } from './app/route'
import { readStorage, writeStorage, applyTheme, THEME_KEY } from './app/theme'
import AppSidebar from './components/AppSidebar.vue'
import AppIcon from './components/AppIcon.vue'
import AuthView from './views/AuthView.vue'
import OverviewView from './views/OverviewView.vue'
import TanksView from './views/TanksView.vue'
import TankDetailView from './views/TankDetailView.vue'
import RemindersView from './views/RemindersView.vue'
import NotificationsView from './views/NotificationsView.vue'
import SettingsView from './views/SettingsView.vue'

const session = createSession(), state = session.state
provide(SessionKey, session)
const hash = ref(location.hash), route = computed(() => parseRoute(hash.value))
const collapsed = ref(readStorage('aquasense-sidebar-collapsed') === 'true'), mobileOpen = ref(false)
const dark = ref(document.documentElement.dataset.theme === 'dark')
const main = ref<HTMLElement | null>(null)
const title = computed(() => route.value.page === 'tank' ? state.tanks.find(tank => tank.device_id === route.value.deviceId)?.name ?? PAGE_TITLES.tank : PAGE_TITLES[route.value.page])
const dateLabel = computed(() => new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' }).format(state.now))
const addOnOpen = computed(() => new URLSearchParams(hash.value.split('?')[1]).get('add') === '1')
function changedRoute() { hash.value = location.hash; mobileOpen.value = false }
function toggleSidebar() { collapsed.value = !collapsed.value; writeStorage('aquasense-sidebar-collapsed', String(collapsed.value)) }
function themeChanged() { dark.value = document.documentElement.dataset.theme === 'dark' }
function toggleTheme() { const next = dark.value ? 'light' : 'dark'; writeStorage(THEME_KEY, next); applyTheme(next) }
watch([title, () => state.user], () => { document.title = `${state.user ? title.value : 'Đăng nhập'} · AquaSense` }, { immediate: true })
watch(hash, async () => { await nextTick(); main.value?.focus({ preventScroll: true }); window.scrollTo({ top: 0 }) })
watch(mobileOpen, value => { document.body.classList.toggle('shell-nav-open', value) })
onMounted(() => {
  window.addEventListener('hashchange', changedRoute)
  window.addEventListener('aquasense:theme', themeChanged)
  void session.initialize()
})
onBeforeUnmount(() => {
  session.dispose(); window.removeEventListener('hashchange', changedRoute); window.removeEventListener('aquasense:theme', themeChanged)
  document.body.classList.remove('shell-nav-open')
})
</script>

<template>
  <div v-if="state.checking" class="shell-boot" role="status"><AppIcon name="drop" :size="32" /><p>Đang mở AquaSense…</p></div>
  <main v-else-if="state.authError && !state.user" class="shell-boot"><h1>Không kết nối được AquaSense</h1><p class="shell-error" role="alert">{{ state.authError }}</p><button type="button" class="shell-button" @click="session.initialize()">Thử lại</button></main>
  <AuthView v-else-if="!state.user" />
  <div v-else class="shell-layout" :class="{ 'is-collapsed': collapsed }">
    <a class="shell-skip" href="#shell-main" @click.prevent="main?.focus()">Bỏ qua điều hướng</a>
    <AppSidebar :collapsed="collapsed" :mobile-open="mobileOpen" :user="state.user" :active="route.page" :count="session.notificationCount.value" @toggle="toggleSidebar" @close="mobileOpen = false" />
    <div class="shell-workspace"><header class="shell-mobile-header"><button type="button" class="shell-icon-button" aria-label="Mở điều hướng" aria-controls="app-sidebar" :aria-expanded="mobileOpen" @click="mobileOpen = true"><AppIcon name="menu" /></button><a href="#/" class="shell-mobile-brand">AquaSense</a><a href="#/notifications" class="shell-icon-button" aria-label="Thông báo"><AppIcon name="notifications" /><span v-if="session.notificationCount.value" class="shell-count">{{ session.notificationCount.value }}</span></a><button type="button" class="shell-icon-button" :title="dark ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'" :aria-label="dark ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'" @click="toggleTheme"><AppIcon :name="dark ? 'sun' : 'moon'" /></button></header>
      <div class="shell-desktop-heading"><span>{{ title }}</span><div class="shell-header-actions"><span class="shell-muted">{{ dateLabel }}</span><button type="button" class="shell-icon-button" :title="dark ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'" :aria-label="dark ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'" @click="toggleTheme"><AppIcon :name="dark ? 'sun' : 'moon'" /></button></div></div>
      <main id="shell-main" ref="main" tabindex="-1" class="shell-main">
        <OverviewView v-if="route.page === 'overview'" />
        <TanksView v-else-if="route.page === 'tanks'" :key="hash" :add-on-open="addOnOpen" />
        <TankDetailView v-else-if="route.page === 'tank'" :key="route.deviceId" :device-id="route.deviceId!" />
        <RemindersView v-else-if="route.page === 'reminders'" />
        <NotificationsView v-else-if="route.page === 'notifications'" />
        <SettingsView v-else-if="route.page === 'settings'" />
        <div v-else class="shell-page shell-empty"><h1>Không tìm thấy trang</h1><a href="#/" class="shell-button">Về Tổng quan</a></div>
      </main>
    </div>
    <div v-if="state.notice" class="shell-notice" role="status">{{ state.notice }}</div>
  </div>
</template>
