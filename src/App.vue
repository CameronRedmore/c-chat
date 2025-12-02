<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useSettingsStore } from './stores/settings';
import { useChatStore } from './stores/chat';
import TitleBar from './components/TitleBar.vue';

const settingsStore = useSettingsStore();
const chatStore = useChatStore();
const isMobile = ref(false);

onMounted(async () => {
  // Simple mobile detection
  isMobile.value = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  
  await settingsStore.load();
  await chatStore.load();
});
</script>

<template>
  <div class="h-screen w-screen bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 overflow-hidden flex flex-col">
    <TitleBar v-if="!isMobile" />
    <!-- Status bar spacer for mobile -->
    <div 
      v-if="isMobile" 
      class="w-full bg-white dark:bg-gray-900 transition-colors shrink-0" 
      style="height: max(env(safe-area-inset-top, 0px), 30px);"
    ></div>
    <div class="flex-1 overflow-hidden relative">
      <router-view />
    </div>
  </div>
</template>

<style>
@import "tailwindcss";
/*
:root {
  font-family: Inter, Avenir, Helvetica, Arial, sans-serif;
  font-size: 16px;
  line-height: 24px;
  font-weight: 400;

  color: #0f0f0f;
  background-color: #f6f6f6;

  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  -webkit-text-size-adjust: 100%;
}

.container {
  margin: 0;
  padding-top: 10vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  text-align: center;
}

.logo {
  height: 6em;
  padding: 1.5em;
  will-change: filter;
  transition: 0.75s;
}

.logo.tauri:hover {
  filter: drop-shadow(0 0 2em #24c8db);
}

.row {
  display: flex;
  justify-content: center;
}

a {
  font-weight: 500;
  color: #646cff;
  text-decoration: inherit;
}

a:hover {
  color: #535bf2;
}

h1 {
  text-align: center;
}

input,
button {
  border-radius: 8px;
  border: 1px solid transparent;
  padding: 0.6em 1.2em;
  font-size: 1em;
  font-weight: 500;
  font-family: inherit;
  color: #0f0f0f;
  background-color: #ffffff;
  transition: border-color 0.25s;
  box-shadow: 0 2px 2px rgba(0, 0, 0, 0.2);
}

button {
  cursor: pointer;
}

button:hover {
  border-color: #396cd8;
}
button:active {
  border-color: #396cd8;
  background-color: #e8e8e8;
}

input,
button {
  outline: none;
}

#greet-input {
  margin-right: 5px;
}

@media (prefers-color-scheme: dark) {
  :root {
    color: #f6f6f6;
    background-color: #2f2f2f;
  }

  a:hover {
    color: #24c8db;
  }

  input,
  button {
    color: #ffffff;
    background-color: #0f0f0f98;
  }
  button:active {
    background-color: #0f0f0f69;
  }
}
*/

</style>