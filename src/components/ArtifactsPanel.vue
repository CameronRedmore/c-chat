<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { ChatSession, Artifact } from '../stores/chat';
import { Icon } from '@iconify/vue';
import { renderMarkdown } from '../utils/markdown';
import hljs from 'highlight.js';
import { throttle } from '../utils/throttle';

const props = defineProps<{
  session: ChatSession;
  isOpen: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const activeArtifactId = ref<string | null>(null);
const showRaw = ref(false);

// Watch for new artifacts to auto-select the latest one
watch(() => props.session.artifacts?.length, (newLen, oldLen) => {
  if (newLen && newLen > (oldLen || 0)) {
    const latest = props.session.artifacts![newLen - 1];
    activeArtifactId.value = latest.id;
  }
}, { immediate: true });

const activeArtifact = computed(() => {
  if (!props.session.artifacts) return null;
  if (activeArtifactId.value) {
    return props.session.artifacts.find(a => a.id === activeArtifactId.value) || null;
  }
  return props.session.artifacts[props.session.artifacts.length - 1] || null;
});

const displayContent = ref('');
const lastSeenId = ref<string | null>(null);

const updateContentThrottled = throttle((content: string) => {
  displayContent.value = content;
}, 200);

watch(() => activeArtifact.value, (newArt) => {
  if (!newArt) {
    displayContent.value = '';
    lastSeenId.value = null;
    return;
  }

  if (newArt.id !== lastSeenId.value) {
    // New artifact selected, update immediately
    displayContent.value = newArt.content;
    lastSeenId.value = newArt.id;
  } else {
    // Same artifact, content update, throttle it
    updateContentThrottled(newArt.content);
  }
}, { immediate: true, deep: true });

const isHtml = computed(() => {
  return activeArtifact.value?.type === 'text/html';
});

const isCode = computed(() => {
  return !isHtml.value; // Treat everything else as code/text for now
});

const renderedContent = computed(() => {
  if (!activeArtifact.value) return '';
  if (activeArtifact.value.type === 'text/markdown') {
    return renderMarkdown(displayContent.value);
  }
  return displayContent.value;
});

const rawHighlightedContent = computed(() => {
  if (!activeArtifact.value) return '';
  
  const content = displayContent.value;
  let language = '';

  // Map MIME types to highlight.js languages
  const type = activeArtifact.value.type;
  if (type === 'text/html') language = 'xml';
  else if (type === 'application/javascript' || type === 'text/javascript') language = 'javascript';
  else if (type === 'text/css') language = 'css';
  else if (type === 'text/markdown') language = 'markdown';
  else if (type === 'application/json') language = 'json';
  else if (type.includes('python')) language = 'python';
  else if (type.includes('java')) language = 'java';
  else if (type.includes('c++') || type.includes('cpp')) language = 'cpp';
  else if (type.includes('c#') || type.includes('csharp')) language = 'csharp';
  else if (type.includes('typescript')) language = 'typescript';
  else if (type.includes('sql')) language = 'sql';
  else if (type.includes('xml')) language = 'xml';
  
  if (language && hljs.getLanguage(language)) {
    try {
      return hljs.highlight(content, { language }).value;
    } catch (e) {
      console.warn('Highlighting failed:', e);
    }
  }
  
  // Fallback to auto-detection or plain text
  try {
    return hljs.highlightAuto(content).value;
  } catch (e) {
    return content; // Fallback to raw content if highlighting fails
  }
});

function copyContent() {
  if (activeArtifact.value) {
    navigator.clipboard.writeText(activeArtifact.value.content);
  }
}
</script>

<template>
  <div class="h-full flex flex-col bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700">
    <!-- Header -->
    <div class="h-14 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 bg-gray-50 dark:bg-gray-800/50">
      <div class="flex items-center gap-2 overflow-hidden">
        <Icon icon="lucide:box" class="w-5 h-5 text-blue-600" />
        <h2 class="font-bold truncate">Artifacts</h2>
      </div>
      <div class="flex items-center gap-2">
        <select 
          v-if="session.artifacts && session.artifacts.length > 0"
          v-model="activeArtifactId"
          class="text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-transparent max-w-[150px]"
        >
          <option v-for="art in session.artifacts" :key="art.id" :value="art.id">
            {{ art.title }}
          </option>
        </select>
        <button 
          @click="showRaw = !showRaw"
          class="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg"
          :class="{ 'bg-gray-200 dark:bg-gray-700': showRaw }"
          title="Toggle raw source"
        >
          <Icon icon="lucide:code" class="w-5 h-5" />
        </button>
        <button 
          @click="$emit('close')"
          class="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg"
        >
          <Icon icon="lucide:x" class="w-5 h-5" />
        </button>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-hidden relative">
      <div v-if="!activeArtifact" class="h-full flex flex-col items-center justify-center text-gray-500 p-8 text-center">
        <Icon icon="lucide:box-select" class="w-12 h-12 mb-4 opacity-50" />
        <p>No artifacts created yet.</p>
        <p class="text-xs mt-2 opacity-70">Ask the AI to create an HTML page or a code snippet to see it here.</p>
      </div>

      <template v-else>
        <!-- HTML Preview -->
        <div v-if="isHtml && !showRaw" class="h-full w-full bg-white">
          <iframe 
            :srcdoc="displayContent"
            class="w-full h-full border-none"
            sandbox="allow-scripts"
          ></iframe>
        </div>

        <!-- Code/Text View -->
        <div v-else class="h-full flex flex-col">
          <div class="flex justify-between items-center px-4 py-2 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 text-xs">
            <span class="font-mono opacity-70">{{ showRaw ? 'Raw Source' : activeArtifact.type }}</span>
            <button @click="copyContent" class="flex items-center gap-1 hover:text-blue-500">
              <Icon icon="lucide:copy" class="w-3 h-3" /> Copy
            </button>
          </div>
          <div class="flex-1 overflow-auto p-4 bg-gray-50 dark:bg-gray-900">
            <div v-if="!showRaw && activeArtifact.type === 'text/markdown'" class="prose dark:prose-invert max-w-none" v-html="renderedContent"></div>
            <pre v-else class="font-mono text-sm whitespace-pre-wrap text-gray-800 dark:text-gray-200"><code class="hljs bg-transparent !p-0 !border-0" v-html="rawHighlightedContent"></code></pre>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
