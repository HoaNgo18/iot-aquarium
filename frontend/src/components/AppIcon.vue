<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 22 })
const paths: Record<string, string[]> = {
  menu: ['M4 6h16M4 12h16M4 18h16'], close: ['m6 6 12 12M18 6 6 18'],
  overview: ['m3 10 9-7 9 7', 'M5 9v12h5v-7h4v7h5V9'],
  tanks: ['M3 5h18v15H3z', 'M3 10c3-3 6 3 9 0s6 3 9 0', 'M8 15h4m-2-2 3 2-3 2'],
  reminders: ['M9 3h6v4H9z', 'M9 5H5v16h14V5h-4', 'm8 14 2 2 5-5'],
  settings: ['M12 8.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4', 'M19.50 9.85 L21.85 10.26 L21.85 13.74 L19.50 14.15 L18.82 15.78 L20.19 17.74 L17.74 20.19 L15.78 18.82 L14.15 19.50 L13.74 21.85 L10.26 21.85 L9.85 19.50 L8.22 18.82 L6.26 20.19 L3.81 17.74 L5.18 15.78 L4.50 14.15 L2.15 13.74 L2.15 10.26 L4.50 9.85 L5.18 8.22 L3.81 6.26 L6.26 3.81 L8.22 5.18 L9.85 4.50 L10.26 2.15 L13.74 2.15 L14.15 4.50 L15.78 5.18 L17.74 3.81 L20.19 6.26 L18.82 8.22 Z'],
  notifications: ['M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9', 'M10 21h4'],
  sun: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8', 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5'],
  moon: ['M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z'],
  plus: ['M12 5v14M5 12h14'], arrow: ['M4 12h16m-6-6 6 6-6 6'], back: ['M20 12H4m6-6-6 6 6 6'],
  edit: ['m14 4 6 6M4 20l5-1L21 7l-4-4L5 15z'], trash: ['M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7'],
  check: ['m5 12 4 4L19 6'], eye: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6'],
  sensor: ['M7 7h10v10H7z', 'M9 2v5m6-5v5M9 17v5m6-5v5M2 9h5m-5 6h5m10-6h5m-5 6h5'],
  server: ['M3 3h18v7H3zM3 14h18v7H3z', 'M7 6h.01M7 17h.01M11 6h6m-6 11h6'],
  wifi: ['M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0m-11 4a6 6 0 0 1 8 0M12 20h.01'],
  chart: ['M4 3v17h17', 'M7 14l4-5 4 3 5-7'], download: ['M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5'],
  drop: ['M12 2S4 11 4 16a8 8 0 0 0 16 0c0-5-8-14-8-14Z'],
  logout: ['M10 4H4v16h6M9 12h12m-5-5 5 5-5 5'],
}
</script>
<template>
  <svg :width="size" :height="size" :style="{ '--icon-size': `${size}px` }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="shell-icon">
    <path v-for="(path, index) in paths[name] ?? paths.drop" :key="index" :d="path" />
  </svg>
</template>
