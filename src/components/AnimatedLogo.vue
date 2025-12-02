<script setup lang="ts">
defineProps<{
  compact?: boolean;
}>();
</script>

<template>
  <div class="logo-container" :class="{ 'compact': compact }">
    <div class="logo-text" :class="{ 'compact-text': compact }">C-Chat</div>
  </div>
</template>

<style scoped>
.logo-container {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem 0 1rem;
  user-select: none;
}

.logo-container.compact {
  padding: 0;
  justify-content: flex-start;
}

.logo-text {
  font-size: 3rem;
  font-weight: 900;
  letter-spacing: -0.05em;
  background: linear-gradient(to right, #22d3ee, #3b82f6, #8b5cf6, #22d3ee);
  background-size: 300% auto;
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: gradient-move 4s linear infinite;
}

.logo-text.compact-text {
  font-size: 1.2rem;
  font-weight: 800;
}

@keyframes gradient-move {
  0% {
    background-position: 0% center;
  }
  100% {
    background-position: 300% center;
  }
}
</style>
