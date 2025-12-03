<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useSyncStore } from '../stores/sync';

const syncStore = useSyncStore();
const now = ref(Date.now());
let interval: number;

onMounted(() => {
  interval = window.setInterval(() => {
    now.value = Date.now();
  }, 1000); // Update every second
});

onUnmounted(() => {
  clearInterval(interval);
});

const timeAgo = computed(() => {
  if (!syncStore.lastSyncTime) return 'Never';
  const diff = Math.floor((now.value - syncStore.lastSyncTime) / 1000);
  
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
});

const statusText = computed(() => {
  if (syncStore.status === 'syncing') return 'Syncing...';
  if (syncStore.status === 'error') return 'Sync failed';
  if (syncStore.status === 'success') return `Synced ${timeAgo.value}`;
  return 'Sync ready';
});

const statusColor = computed(() => {
    if (syncStore.status === 'syncing') return 'text-blue-500';
    if (syncStore.status === 'error') return 'text-red-500';
    return 'text-gray-400 dark:text-gray-500';
});
</script>

<template>
  <div class="text-xs flex items-center gap-2 select-none" :class="statusColor">
    <div v-if="syncStore.status === 'syncing'" class="animate-spin h-3 w-3 border-2 border-current border-t-transparent rounded-full"></div>
    <div v-else-if="syncStore.status === 'error'" class="h-2 w-2 rounded-full bg-red-500"></div>
    <div v-else class="h-2 w-2 rounded-full bg-green-500/50"></div>
    <span>{{ statusText }}</span>
  </div>
</template>
