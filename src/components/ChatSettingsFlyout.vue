<script setup lang="ts">
import { useSettingsStore } from '../stores/settings';
import { useChatStore } from '../stores/chat';
import { storeToRefs } from 'pinia';

defineProps<{
  isOpen: boolean;
}>();

const emit = defineEmits(['close']);

const settingsStore = useSettingsStore();
const chatStore = useChatStore();
const { models, systemPrompts } = storeToRefs(settingsStore);
const { activeSession } = storeToRefs(chatStore);
</script>

<template>
  <div 
    v-if="isOpen" 
    class="absolute inset-y-0 right-0 w-full sm:w-80 bg-white/90 dark:bg-gray-800/90 backdrop-blur-md shadow-xl transform transition-transform duration-300 z-50 border-l border-gray-200 dark:border-gray-700 p-4"
  >
    <div class="flex justify-between items-center mb-6">
      <h3 class="text-lg font-bold">Chat Settings</h3>
      <button @click="$emit('close')" class="text-gray-500 hover:text-gray-700">✕</button>
    </div>

    <div v-if="activeSession" class="space-y-6">
      <div>
        <label class="block text-sm font-medium mb-1">Model</label>
        <select 
          v-model="activeSession.modelId" 
          @change="chatStore.save()"
          class="w-full px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600"
        >
          <option v-for="m in models" :key="m.id" :value="m.id">{{ m.name }}</option>
        </select>
      </div>

      <div>
        <label class="block text-sm font-medium mb-1">System Prompt</label>
        <select 
          v-model="activeSession.systemPromptId" 
          @change="chatStore.save()"
          class="w-full px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600"
        >
          <option :value="undefined">Default</option>
          <option v-for="p in systemPrompts" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </div>

      <div>
        <label class="block text-sm font-medium mb-1">Temperature: {{ activeSession.temperature ?? 'Default' }}</label>
        <input 
          type="range" 
          min="0" 
          max="2" 
          step="0.1" 
          :value="activeSession.temperature ?? 0.7"
          @input="e => { activeSession!.temperature = parseFloat((e.target as HTMLInputElement).value); chatStore.save(); }"
          class="w-full"
        />
      </div>

      <div>
        <label class="block text-sm font-medium mb-1">Top P: {{ activeSession.topP ?? 'Default' }}</label>
        <input 
          type="range" 
          min="0" 
          max="1" 
          step="0.01" 
          :value="activeSession.topP ?? 1"
          @input="e => { activeSession!.topP = parseFloat((e.target as HTMLInputElement).value); chatStore.save(); }"
          class="w-full"
        />
      </div>

      <div>
        <label class="block text-sm font-medium mb-1">Top K: {{ activeSession.topK ?? 'Default' }}</label>
        <input 
          type="number" 
          min="0" 
          step="1" 
          :value="activeSession.topK ?? 0"
          @input="e => { activeSession!.topK = parseInt((e.target as HTMLInputElement).value); chatStore.save(); }"
          class="w-full px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600"
        />
      </div>

      <div>
        <label class="block text-sm font-medium mb-1">Min P: {{ activeSession.minP ?? 'Default' }}</label>
        <input 
          type="range" 
          min="0" 
          max="1" 
          step="0.01" 
          :value="activeSession.minP ?? 0"
          @input="e => { activeSession!.minP = parseFloat((e.target as HTMLInputElement).value); chatStore.save(); }"
          class="w-full"
        />
      </div>
    </div>
    <div v-else class="text-gray-500">
      Select a chat to configure settings.
    </div>
  </div>
</template>
