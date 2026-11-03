<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount, useId } from 'vue'
import AppIcon from './AppIcon.vue'
const props = defineProps<{ open: boolean; title: string; busy?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)
const titleId = useId()
let opener: HTMLElement | null = null
watch(() => props.open, async open => {
  await nextTick()
  if (open && dialog.value && !dialog.value.open) {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.value.showModal()
  } else if (!open && dialog.value?.open) dialog.value.close()
}, { immediate: true })
function closed() { emit('close'); if (opener?.isConnected) opener.focus() }
onBeforeUnmount(() => { dialog.value?.close(); if (opener?.isConnected) opener.focus() })
</script>
<template>
  <dialog ref="dialog" class="shell-dialog" :aria-labelledby="titleId" :aria-busy="busy || undefined" @cancel="busy ? $event.preventDefault() : undefined" @close="closed">
    <header class="shell-dialog-header"><h2 :id="titleId">{{ title }}</h2><button type="button" class="shell-icon-button" aria-label="Đóng hộp thoại" :disabled="busy" @click="emit('close')"><AppIcon name="close" /></button></header>
    <slot />
  </dialog>
</template>
