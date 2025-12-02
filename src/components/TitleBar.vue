<script setup lang="ts">
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ref, onMounted, onUnmounted } from 'vue';
import AnimatedLogo from './AnimatedLogo.vue';

const appWindow = getCurrentWindow();
const isMaximized = ref(false);

const updateMaximizedState = async () => {
  isMaximized.value = await appWindow.isMaximized();
};

const minimize = () => appWindow.minimize();
const maximize = async () => {
  if (isMaximized.value) {
    await appWindow.unmaximize();
  } else {
    await appWindow.maximize();
  }
};
const close = () => appWindow.close();

let unlisten: () => void;

onMounted(async () => {
  await updateMaximizedState();
  unlisten = await appWindow.listen('tauri://resize', updateMaximizedState);
});

onUnmounted(() => {
  if (unlisten) {
    unlisten();
  }
});
</script>

<template>
  <div class="titlebar flex justify-between items-center bg-gray-100 dark:bg-gray-800 select-none h-8">
    <div data-tauri-drag-region class="flex-1 flex items-center pl-4 h-full">
      <AnimatedLogo compact class="pointer-events-none" />
    </div>
    <div class="flex h-full">
      <button @click="minimize" class="titlebar-button hover:bg-gray-200 hover:text-white dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400">
        <svg width="10" height="10" viewBox="0 0 10 10" class="fill-current">
          <path d="M1,5 L9,5" stroke="currentColor" stroke-width="1" />
        </svg>
      </button>
      <button @click="maximize" class="titlebar-button hover:bg-gray-200 hover:text-white dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400">
        <svg v-if="!isMaximized" width="10" height="10" viewBox="0 0 10 10" class="fill-current">
          <rect x="2" y="2" width="6" height="6" stroke="currentColor" stroke-width="1" fill="none" />
        </svg>
        <svg v-else width="10" height="10" viewBox="0 0 10 10" class="fill-current">
          <path d="M3,3 L3,1 L9,1 L9,7 L 7,7 M 1,3 L 7,3 L 7,9 L 1,9 L 1,3" stroke="currentColor" stroke-width="1" fill="none" />
        </svg>
      </button>
      <button @click="close" class="titlebar-button hover:bg-red-500 hover:text-white text-gray-600 dark:text-gray-400">
        <svg width="10" height="10" viewBox="0 0 10 10" class="fill-current">
          <path d="M1,1 L9,9 M9,1 L1,9" stroke="currentColor" stroke-width="1" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.titlebar {
  z-index: 1000;
}

.titlebar-button {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  width: 46px;
  height: 100%;
  border: none;
  outline: none;
}
</style>
