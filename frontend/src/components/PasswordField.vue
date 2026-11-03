<script setup lang="ts">
import { ref, useId } from 'vue'
import AppIcon from './AppIcon.vue'
withDefaults(defineProps<{ modelValue: string; label: string; autocomplete?: string; disabled?: boolean }>(), { autocomplete: 'current-password' })
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const id = useId(), shown = ref(false)
</script>
<template>
  <div class="shell-field"><label :for="id">{{ label }}</label><div class="shell-password"><input :id="id" :value="modelValue" :type="shown ? 'text' : 'password'" :autocomplete="autocomplete" required maxlength="128" :disabled="disabled" @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)" /><button type="button" class="shell-icon-button" :aria-label="`${shown ? 'Ẩn' : 'Hiện'} ${label.toLocaleLowerCase('vi-VN')}`" :aria-pressed="shown" :disabled="disabled" @click="shown = !shown"><AppIcon name="eye" :size="20" /></button></div></div>
</template>
