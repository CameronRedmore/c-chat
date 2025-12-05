<script setup lang="ts">
import { computed, ref } from 'vue';
import { renderMarkdown } from '../utils/markdown';
import type { Message } from '../stores/chat';

const props = defineProps<{
  message: Message;
  branchIndex?: number;
  branchCount?: number;
}>();

const emit = defineEmits<{
  (e: 'delete'): void;
  (e: 'edit', content: string): void;
  (e: 'regenerate'): void;
  (e: 'navigate', direction: 'prev' | 'next'): void;
}>();

const showRaw = ref(false);
const isEditing = ref(false);
const editContent = ref('');

const renderedContent = computed(() => {
  return renderMarkdown(props.message.content || '');
});



const getResult = (callId: string) => {
  return props.message.toolResults?.find(r => r.callId === callId);
};

function startEditing() {
  editContent.value = props.message.content;
  isEditing.value = true;
}

function cancelEditing() {
  isEditing.value = false;
}

function saveEdit() {
  emit('edit', editContent.value);
  isEditing.value = false;
}

function handleCopy(event: MouseEvent) {
  const target = (event.target as HTMLElement).closest('.copy-code-btn');
  if (!target) return;

  const wrapper = target.closest('.group');
  if (!wrapper) return;

  const code = wrapper.querySelector('code')?.innerText;
  if (!code) return;

  navigator.clipboard.writeText(code).then(() => {
    // Visual feedback
    const originalContent = target.innerHTML;
    target.innerHTML = '<span class="text-lg text-green-500">✓</span><span class="text-green-500">Copied!</span>';
    setTimeout(() => {
      target.innerHTML = originalContent;
    }, 2000);
  });
}
</script>

<template>
  <div class="p-4 rounded-lg max-w-3xl overflow-x-auto relative group backdrop-blur-sm" :class="[
    message.role === 'user' ? 'bg-blue-100/80 dark:bg-blue-900/60 ml-auto' : 'bg-gray-100/80 dark:bg-gray-800/60 mr-auto'
  ]">
    <div class="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
      <button v-if="!isEditing" @click="$emit('regenerate')"
        class="p-1 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400"
        title="Regenerate">
        🔄
      </button>
      <button v-if="!isEditing" @click="startEditing"
        class="p-1 hover:bg-black/10 dark:hover:bg-white/10 rounded text-gray-500 dark:text-gray-400" title="Edit">
        ✎
      </button>
      <button v-if="!isEditing" @click="$emit('delete')"
        class="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400"
        title="Delete">
        🗑️
      </button>
      <button @click="showRaw = !showRaw"
        class="text-[10px] uppercase tracking-wider font-semibold bg-black/10 dark:bg-white/10 px-2 py-1 rounded ml-1">
        {{ showRaw ? 'Rendered' : 'Raw' }}
      </button>
    </div>

    <!-- Interleaved Rendering -->
    <template v-if="!isEditing && message.parts && message.parts.length > 0">
      <div v-for="(part, index) in message.parts" :key="part.id || index" class="mb-2">

        <!-- Reasoning -->
        <div v-if="part.type === 'reasoning'" class="mb-3">
          <details
            class="group border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50 overflow-hidden">
            <summary
              class="flex items-center gap-2 p-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50 select-none text-xs font-medium text-gray-500 uppercase tracking-wider">
              <span class="transform group-open:rotate-90 transition-transform">▶</span>
              Reasoning Process
            </summary>
            <div
              class="p-3 border-t border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-900/30 whitespace-pre-wrap font-mono">
              {{ part.content }}
            </div>
          </details>
        </div>

        <!-- Tool Call -->
        <div v-else-if="part.type === 'tool-call' && part.toolCall" class="mb-3">
          <div class="border border-gray-300 dark:border-gray-600 rounded overflow-hidden bg-white/50 dark:bg-black/20">
            <details class="group">
              <summary
                class="flex items-center justify-between p-2 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 select-none">
                <div class="flex items-center gap-2 font-mono text-sm">
                  <span class="text-purple-600 dark:text-purple-400">🛠️ {{ part.toolCall.name }}</span>
                  <span class="opacity-50 text-xs">({{ part.toolCall.id.slice(0, 8) }})</span>
                </div>
                <div class="flex items-center gap-2">
                  <span v-if="getResult(part.toolCall.id)" class="text-xs px-1.5 py-0.5 rounded"
                    :class="getResult(part.toolCall.id)?.isError ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'">
                    {{ getResult(part.toolCall.id)?.isError ? 'Error' : 'Success' }}
                  </span>
                  <span class="transform group-open:rotate-180 transition-transform text-xs">▼</span>
                </div>
              </summary>

              <div class="p-2 border-t border-gray-200 dark:border-gray-700 text-xs font-mono overflow-x-auto">
                <div class="mb-2">
                  <div class="font-semibold text-gray-500 mb-1">Arguments:</div>
                  <pre
                    class="bg-gray-50 dark:bg-gray-900 p-2 rounded">{{ JSON.stringify(part.toolCall.arguments, null, 2) }}</pre>
                </div>

                <div v-if="getResult(part.toolCall.id)">
                  <div class="font-semibold text-gray-500 mb-1">Result:</div>
                  <pre
                    class="bg-gray-50 dark:bg-gray-900 p-2 rounded max-h-60 overflow-y-auto">{{ getResult(part.toolCall.id)?.result }}</pre>
                </div>
                <div v-else class="text-gray-500 italic">
                  Waiting for result...
                </div>
              </div>
            </details>
          </div>
        </div>

        <!-- Text -->
        <div v-else-if="part.type === 'text' && part.content">
          <div v-if="!showRaw" class="prose dark:prose-invert max-w-none" @click="handleCopy"
            v-html="renderMarkdown(part.content)"></div>
          <pre v-else
            class="whitespace-pre-wrap font-mono text-sm text-gray-800 dark:text-gray-200">{{ part.content }}</pre>
        </div>

      </div>
    </template>

    <!-- Legacy Rendering -->
    <template v-else>

      <!-- Reasoning -->
      <div v-if="message.reasoning" class="mb-3">
        <details
          class="group border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50 overflow-hidden">
          <summary
            class="flex items-center gap-2 p-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50 select-none text-xs font-medium text-gray-500 uppercase tracking-wider">
            <span class="transform group-open:rotate-90 transition-transform">▶</span>
            Reasoning Process
          </summary>
          <div
            class="p-3 border-t border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-900/30 whitespace-pre-wrap font-mono">
            {{ message.reasoning }}
          </div>
        </details>
      </div>

      <!-- Tool Calls -->
      <div v-if="message.toolCalls?.length" class="mb-3 space-y-2">
        <div v-for="call in message.toolCalls" :key="call.id"
          class="border border-gray-300 dark:border-gray-600 rounded overflow-hidden bg-white/50 dark:bg-black/20">
          <details class="group">
            <summary
              class="flex items-center justify-between p-2 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 select-none">
              <div class="flex items-center gap-2 font-mono text-sm">
                <span class="text-purple-600 dark:text-purple-400">🛠️ {{ call.name }}</span>
                <span class="opacity-50 text-xs">({{ call.id.slice(0, 8) }})</span>
              </div>
              <div class="flex items-center gap-2">
                <span v-if="getResult(call.id)" class="text-xs px-1.5 py-0.5 rounded"
                  :class="getResult(call.id)?.isError ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'">
                  {{ getResult(call.id)?.isError ? 'Error' : 'Success' }}
                </span>
                <span class="transform group-open:rotate-180 transition-transform text-xs">▼</span>
              </div>
            </summary>

            <div class="p-2 border-t border-gray-200 dark:border-gray-700 text-xs font-mono overflow-x-auto">
              <div class="mb-2">
                <div class="font-semibold text-gray-500 mb-1">Arguments:</div>
                <pre class="bg-gray-50 dark:bg-gray-900 p-2 rounded">{{ JSON.stringify(call.arguments, null, 2) }}</pre>
              </div>

              <div v-if="getResult(call.id)">
                <div class="font-semibold text-gray-500 mb-1">Result:</div>
                <pre
                  class="bg-gray-50 dark:bg-gray-900 p-2 rounded max-h-60 overflow-y-auto">{{ getResult(call.id)?.result }}</pre>
              </div>
              <div v-else class="text-gray-500 italic">
                Waiting for result...
              </div>
            </div>
          </details>
        </div>
      </div>

      <!-- Loading Indicator -->
      <div v-if="message.role === 'assistant' && !message.content && !message.toolCalls?.length"
        class="flex items-center gap-1 h-6 px-2">
        <div class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 0ms"></div>
        <div class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 150ms"></div>
        <div class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 300ms"></div>
      </div>

      <!-- Content -->
      <div v-if="message.content">
        <div v-if="isEditing" class="mt-2">
          <textarea v-model="editContent"
            class="w-full p-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-black/20 focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[100px]"></textarea>
          <div class="flex justify-end gap-2 mt-2">
            <button @click="cancelEditing"
              class="px-3 py-1 text-sm rounded hover:bg-black/5 dark:hover:bg-white/5">Cancel</button>
            <button @click="saveEdit"
              class="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">Save</button>
          </div>
        </div>
        <template v-else>
          <div v-if="!showRaw" class="prose dark:prose-invert max-w-none" @click="handleCopy" v-html="renderedContent">
          </div>
          <pre v-else
            class="whitespace-pre-wrap font-mono text-sm text-gray-800 dark:text-gray-200">{{ message.content }}</pre>
        </template>
      </div>
    </template>

    <!-- Attachments -->
    <div v-if="message.attachments?.length" class="mt-3 flex flex-wrap gap-2">
      <div v-for="(att, i) in message.attachments" :key="i"
        class="border border-gray-300 dark:border-gray-600 rounded p-2 bg-white/50 dark:bg-black/20 max-w-full">
        <img v-if="att.type.startsWith('image/')" :src="att.content" class="max-w-xs max-h-64 rounded object-contain"
          :alt="att.name" />
        <div v-else class="flex items-center gap-2 text-sm p-1">
          <span class="text-xl">📄</span>
          <div class="flex flex-col overflow-hidden">
            <span class="font-medium truncate max-w-[200px]">{{ att.name }}</span>
            <span class="text-xs opacity-70">{{ att.type }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Footer Info -->
    <div class="mt-2 text-xs text-gray-400 dark:text-gray-500 flex flex-wrap justify-between items-center gap-3">
      <!-- Branch Navigation -->
      <div v-if="branchCount && branchCount > 1"
        class="flex items-center gap-1 bg-black/5 dark:bg-white/5 rounded px-1.5 py-0.5">
        <button @click="$emit('navigate', 'prev')"
          class="hover:text-gray-700 dark:hover:text-gray-300 px-1 disabled:opacity-30" :disabled="branchIndex === 1">
          &lt;
        </button>
        <span class="font-medium">{{ branchIndex }} / {{ branchCount }}</span>
        <button @click="$emit('navigate', 'next')"
          class="hover:text-gray-700 dark:hover:text-gray-300 px-1 disabled:opacity-30"
          :disabled="branchIndex === branchCount">
          &gt;
        </button>
      </div>
      <div v-else></div> <!-- Spacer -->

      <div class="flex items-center gap-3">
        <template v-if="message.role === 'assistant'">
          <div v-if="message.model" class="flex items-center gap-1">
            <span>🤖</span> {{ message.model }}
          </div>
          <div v-if="message.generationTime" class="flex items-center gap-1" title="Generation Time">
            <span>⏱️</span> {{ (message.generationTime / 1000).toFixed(2) }}s
          </div>
          <div v-if="message.tokensPerSecond" class="flex items-center gap-1" title="Tokens per second (estimated)">
            <span>⚡</span> {{ message.tokensPerSecond.toFixed(1) }} t/s
          </div>
        </template>
        <div class="flex items-center gap-1" title="Message Timestamp">
          <span>🕒</span> {{ new Date(message.timestamp).toLocaleTimeString() }}
        </div>
      </div>
    </div>
  </div>
</template>
