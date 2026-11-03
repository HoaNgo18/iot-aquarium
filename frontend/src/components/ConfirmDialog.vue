<script setup lang="ts">
import AppDialog from './AppDialog.vue'
withDefaults(defineProps<{ open: boolean; title: string; message: string; busy?: boolean; error?: string; confirmLabel?: string }>(), { confirmLabel: 'Xoá' })
const emit = defineEmits<{ close: []; confirm: [] }>()
</script>
<template>
  <AppDialog :open="open" :title="title" :busy="busy" @close="emit('close')">
    <p class="shell-muted">{{ message }}</p><p v-if="error" class="shell-error" role="alert">{{ error }}</p>
    <div class="shell-actions"><button type="button" class="shell-button" :disabled="busy" @click="emit('close')">Hủy</button><button type="button" class="shell-button is-danger" :disabled="busy" @click="emit('confirm')">{{ busy ? 'Đang xử lý…' : confirmLabel }}</button></div>
  </AppDialog>
</template>
