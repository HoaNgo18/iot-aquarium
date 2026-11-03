<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import AppIcon from './AppIcon.vue'
import type { Page } from '../app/route'
import type { User } from '../app/types'
const props = defineProps<{ collapsed: boolean; mobileOpen: boolean; user: User; active: Page; count: number }>()
const emit = defineEmits<{ toggle: []; close: [] }>()
const mobile = ref(window.matchMedia('(max-width: 759px)').matches)
const surface = ref<HTMLElement | null>(null)
const expanded = computed(() => mobile.value || !props.collapsed)
const primary = [{ key: 'overview', href: '#/', label: 'Tổng quan' }, { key: 'tanks', href: '#/tanks', label: 'Bể của tôi' }, { key: 'reminders', href: '#/reminders', label: 'Nhắc việc' }]
const secondary = [{ key: 'settings', href: '#/settings', label: 'Cài đặt' }, { key: 'notifications', href: '#/notifications', label: 'Thông báo' }]
const active = (key: string) => props.active === key || key === 'tanks' && props.active === 'tank'
const initial = computed(() => Array.from(props.user.display_name.trim())[0]?.toLocaleUpperCase('vi-VN') || 'A')
const media = window.matchMedia('(max-width: 759px)')
function resize(event: MediaQueryListEvent) { mobile.value = event.matches; emit('close') }
function closeMobile() { if (mobile.value) emit('close') }
watch([mobile, () => props.mobileOpen], async () => {
  await nextTick()
  if (!(surface.value instanceof HTMLDialogElement)) return
  if (props.mobileOpen && !surface.value.open) surface.value.showModal()
  else if (!props.mobileOpen && surface.value.open) surface.value.close()
}, { immediate: true })
function outside(event: MouseEvent) {
  if (!mobile.value || event.target !== surface.value) return
  const box = surface.value!.getBoundingClientRect()
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) emit('close')
}
onMounted(() => media.addEventListener('change', resize))
onBeforeUnmount(() => { media.removeEventListener('change', resize); if (surface.value instanceof HTMLDialogElement) surface.value.close() })
</script>
<template>
  <component :is="mobile ? 'dialog' : 'aside'" id="app-sidebar" ref="surface" class="shell-sidebar" :class="{ 'is-collapsed': !expanded, 'is-mobile': mobile }" aria-label="Điều hướng AquaSense" @cancel="emit('close')" @close="closeMobile" @click="outside">
    <div class="shell-sidebar-top"><button type="button" class="shell-icon-button" :aria-label="mobile ? 'Đóng điều hướng' : expanded ? 'Thu gọn thanh bên' : 'Mở rộng thanh bên'" :aria-expanded="expanded" @click="mobile ? emit('close') : emit('toggle')"><AppIcon :name="mobile ? 'close' : 'menu'" /></button><strong v-if="expanded">AquaSense</strong></div>
    <nav class="shell-nav" aria-label="Điều hướng chính"><a v-for="item in primary" :key="item.key" :href="item.href" :title="item.label" :aria-label="item.label" :aria-current="active(item.key) ? 'page' : undefined" @click="closeMobile"><AppIcon :name="item.key" /><span v-if="expanded">{{ item.label }}</span></a></nav>
    <div class="shell-sidebar-bottom">
      <nav class="shell-nav" aria-label="Tài khoản và thông báo"><a v-for="item in secondary" :key="item.key" :href="item.href" :title="item.label" :aria-label="item.label" :aria-current="active(item.key) ? 'page' : undefined" @click="closeMobile"><AppIcon :name="item.key" /><span v-if="expanded">{{ item.label }}</span><span v-if="item.key === 'notifications' && count > 0" class="shell-count" :aria-label="`${count} thông báo`">{{ count > 99 ? '99+' : count }}</span></a></nav>
      <a href="#/settings" class="shell-profile" :title="user.display_name" :aria-label="`Hồ sơ ${user.display_name}`" @click="closeMobile"><span class="shell-avatar" aria-hidden="true">{{ initial }}</span><span v-if="expanded"><strong>{{ user.display_name }}</strong><small>@{{ user.username }}</small></span></a>
    </div>
  </component>
</template>
