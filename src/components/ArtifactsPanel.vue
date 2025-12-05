<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useChatStore, type ChatSession, type Artifact } from '../stores/chat';
import { Icon } from '@iconify/vue';
import { renderMarkdown } from '../utils/markdown';
import hljs from 'highlight.js';
import { throttle } from '../utils/throttle';
import { resolveArtifactLinks } from '../utils/artifact-resolver';
import FileTree from './FileTree.vue';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

const props = defineProps<{
  session: ChatSession;
  isOpen: boolean;
}>();

defineEmits<{
  (e: 'close'): void;
}>();

const store = useChatStore();
const sessionArtifacts = computed(() => store.getArtifactsForSession(props.session.id));

const activeArtifactId = ref<string | null>(null);
const showRaw = ref(false);
const isSidebarOpen = ref(true); // Toggle for file tree

// Watch for new artifacts to auto-select the latest one
watch(() => sessionArtifacts.value.length, (newLen, oldLen) => {
  if (newLen && newLen > (oldLen || 0)) {
    // Select the latest if added
    const latest = sessionArtifacts.value[0];
    if (latest && latest.id !== activeArtifactId.value) {
      activeArtifactId.value = latest.id;
    }
  }
}, { immediate: true });

const activeArtifact = computed(() => {
  if (!sessionArtifacts.value || sessionArtifacts.value.length === 0) return null;

  if (activeArtifactId.value) {
    return sessionArtifacts.value.find(a => a.id === activeArtifactId.value) || null;
  }
  return sessionArtifacts.value[0] || null;
});

const displayContent = ref('');
const lastSeenId = ref<string | null>(null);


watch(() => activeArtifact.value, (newArt) => {
  if (!newArt) {
    displayContent.value = '';
    lastSeenId.value = null;
    return;
  }

  if (newArt.id !== lastSeenId.value) {
    if (newArt.type === 'text/html' || newArt.path?.endsWith('.html')) {
      // Resolve links for HTML
      if (cleanupFn.value) cleanupFn.value();
      const { html, cleanup } = resolveArtifactLinks(newArt.content, newArt.path || '', sessionArtifacts.value);
      displayContent.value = html;
      cleanupFn.value = cleanup;
    } else {
      displayContent.value = newArt.content;
    }
    lastSeenId.value = newArt.id;
  } else {
    // Throttled update
    // Note: Re-resolving links on every keystroke might be expensive + flicker?
    // But if they edit the HTML to add a link, we need to resolve it.
    // For now, let's just resolve it.
    if (newArt.type === 'text/html' || newArt.path?.endsWith('.html')) {
      updateContentThrottled(newArt.content, true);
    } else {
      updateContentThrottled(newArt.content, false);
    }
  }
}, { immediate: true, deep: true });

const cleanupFn = ref<(() => void) | null>(null);

// Override the throttled function to handle HTML resolution
const updateContentThrottled = throttle((content: string, isHtml: boolean) => {
  if (isHtml) {
    if (cleanupFn.value) cleanupFn.value();
    const { html, cleanup } = resolveArtifactLinks(content, activeArtifact.value?.path || '', sessionArtifacts.value);
    displayContent.value = html;
    cleanupFn.value = cleanup;
  } else {
    displayContent.value = content;
  }
}, 200);

const isHtml = computed(() => {
  return activeArtifact.value?.type === 'text/html';
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

  const type = activeArtifact.value.type;
  const path = activeArtifact.value.path || '';

  if (type === 'text/html' || path.endsWith('.html')) language = 'xml';
  else if (type.includes('javascript') || path.endsWith('.js') || path.endsWith('.mjs')) language = 'javascript';
  else if (type === 'text/css' || path.endsWith('.css')) language = 'css';
  else if (type === 'text/markdown' || path.endsWith('.md')) language = 'markdown';
  else if (type.includes('json') || path.endsWith('.json')) language = 'json';
  else if (type.includes('python') || path.endsWith('.py')) language = 'python';
  else if (type.includes('java') || path.endsWith('.java')) language = 'java';
  else if (type.includes('c++') || type.includes('cpp') || path.endsWith('.cpp') || path.endsWith('.h')) language = 'cpp';
  else if (type.includes('c#') || type.includes('csharp') || path.endsWith('.cs')) language = 'csharp';
  else if (type.includes('typescript') || path.endsWith('.ts') || path.endsWith('.tsx')) language = 'typescript';
  else if (type.includes('sql') || path.endsWith('.sql')) language = 'sql';
  else if (type.includes('xml') || path.endsWith('.xml')) language = 'xml';
  else if (path.endsWith('.vue')) language = 'xml';

  if (language && hljs.getLanguage(language)) {
    try {
      return hljs.highlight(content, { language }).value;
    } catch (e) {
      console.warn('Highlighting failed:', e);
    }
  }

  try {
    return hljs.highlightAuto(content).value;
  } catch (e) {
    return content;
  }
});

function copyContent() {
  if (activeArtifact.value) {
    navigator.clipboard.writeText(activeArtifact.value.content);
  }
}

function handleSelect(artifact: Artifact) {
  activeArtifactId.value = artifact.id;
}

async function downloadZip() {
  const zip = new JSZip();
  const artifacts = sessionArtifacts.value;

  if (!artifacts || artifacts.length === 0) return;

  artifacts.forEach(artifact => {
    let path = artifact.path || artifact.title || artifact.id;
    // Remove leading slash if present to avoid absolute path issues in zip
    if (path.startsWith('/') || path.startsWith('\\')) {
      path = path.slice(1);
    }
    zip.file(path, artifact.content);
  });

  try {
    const blob = await zip.generateAsync({ type: 'blob' });
    saveAs(blob, `artifacts-${props.session.id.slice(0, 8)}.zip`);
  } catch (e) {
    console.error('Failed to generate zip:', e);
  }
}
</script>

<template>
  <div class="h-full flex flex-col bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700">
    <!-- Header -->
    <div
      class="h-14 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 bg-gray-50 dark:bg-gray-800/50">
      <div class="flex items-center gap-2 overflow-hidden">
        <button @click="isSidebarOpen = !isSidebarOpen" class="hover:bg-gray-200 dark:hover:bg-gray-700 p-1 rounded"
          title="Toggle File Tree">
          <Icon icon="lucide:sidebar" class="w-5 h-5 text-gray-500" />
        </button>
        <div class="flex items-center gap-2">
          <Icon icon="lucide:box" class="w-5 h-5 text-blue-600" />
          <span class="font-bold truncate">Artifacts</span>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <button v-if="sessionArtifacts.length > 0" @click="downloadZip"
          class="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg" title="Download Artifacts as Zip">
          <Icon icon="lucide:download" class="w-5 h-5" />
        </button>
        <button @click="showRaw = !showRaw" class="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg"
          :class="{ 'bg-gray-200 dark:bg-gray-700': showRaw }" title="Toggle raw source">
          <Icon icon="lucide:code" class="w-5 h-5" />
        </button>
        <button @click="$emit('close')" class="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg">
          <Icon icon="lucide:x" class="w-5 h-5" />
        </button>
      </div>
    </div>

    <!-- Main Body: Split View -->
    <div class="flex-1 flex overflow-hidden relative">
      <!-- Sidebar: File Tree -->
      <div v-if="isSidebarOpen"
        class="w-64 border-r border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30 flex-shrink-0 flex flex-col transition-all duration-300">
        <div class="p-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Explorer</div>
        <FileTree :artifacts="sessionArtifacts" :active-artifact-id="activeArtifactId" @select="handleSelect" />
      </div>

      <!-- Content -->
      <div class="flex-1 overflow-hidden relative flex flex-col">
        <div v-if="!activeArtifact"
          class="h-full flex flex-col items-center justify-center text-gray-500 p-8 text-center">
          <Icon icon="lucide:box-select" class="w-12 h-12 mb-4 opacity-50" />
          <p>No file selected.</p>
        </div>

        <template v-else>
          <!-- HTML Preview -->
          <div v-if="isHtml && !showRaw" class="h-full w-full bg-white">
            <iframe :srcdoc="displayContent" class="w-full h-full border-none"
              sandbox="allow-scripts allow-same-origin"></iframe>
          </div>

          <!-- Code/Text View -->
          <div v-else class="h-full flex flex-col">
            <div
              class="flex justify-between items-center px-4 py-2 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 text-xs">
              <span class="font-mono opacity-70 truncate max-w-[300px]">{{ activeArtifact.path || activeArtifact.title
                }}</span>
              <button @click="copyContent" class="flex items-center gap-1 hover:text-blue-500">
                <Icon icon="lucide:copy" class="w-3 h-3" /> Copy
              </button>
            </div>
            <div class="flex-1 overflow-auto p-4 bg-gray-50 dark:bg-gray-900">
              <div v-if="!showRaw && activeArtifact.type === 'text/markdown'" class="prose dark:prose-invert max-w-none"
                v-html="renderedContent"></div>
              <pre v-else
                class="font-mono text-sm whitespace-pre-wrap text-gray-800 dark:text-gray-200"><code class="hljs bg-transparent !p-0 !border-0" v-html="rawHighlightedContent"></code></pre>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
