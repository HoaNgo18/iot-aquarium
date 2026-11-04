<script setup lang="ts">
import AquariumScene from '../components/AquariumScene.vue'
</script>
<template>
  <section class="intro-overview">
    <div class="intro-overview-copy">
      <h1>Hiểu bể cá.<br/>Chăm sóc tốt hơn.</h1>
      <p>Theo dõi nhiệt độ, pH và độ trong của nước trong cùng một nơi.</p>
      <p>AquaSense giúp bạn nắm tình trạng bể, nhận cảnh báo và nhớ những việc cần chăm sóc mỗi ngày.</p>
    </div>
    <div class="intro-overview-scene" aria-label="Bể cá minh họa">
      <AquariumScene compact :temperature="null" :ph="null" :clarity="99" clarity-state="clear" :online="true" :alert="false" />
    </div>
  </section>
</template>
