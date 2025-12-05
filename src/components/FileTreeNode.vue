<script setup lang="ts">
import { ref, computed } from 'vue';
import { Icon } from '@iconify/vue';
import type { Artifact } from '../stores/chat';

defineOptions({
  name: 'FileTreeNode'
});

export interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children: TreeNode[];
  artifact?: Artifact;
}

const props = defineProps<{
  node: TreeNode;
  activeArtifactId: string | null;
  depth?: number;
}>();

const emit = defineEmits<{
  (e: 'select', artifact: Artifact): void;
}>();

const isOpen = ref(false);



// Watch active ID to expand
// Ideally we pass "activePath" props.
// Let's rely on parent opening us? Or us checking?
// If we receive the activeArtifactId, we can't easily map it to path here without store access.
// But we assume the `node.path` is correct virtual path.
// If `activeArtifactId` corresponds to an artifact, we need to know ITS path.
// Let's assume the parent passes us `activePath` string instead of `activeArtifactId`?
// Or we look it up in the store? But this is a dumb component.
// Let's just create a `toggle` method and open manually for now.
// Users can click folders.

function toggle() {
  if (props.node.type === 'folder') {
    isOpen.value = !isOpen.value;
  } else if (props.node.artifact) {
    emit('select', props.node.artifact);
  }
}

// Icon selection
const icon = computed(() => {
  if (props.node.type === 'folder') {
    return isOpen.value ? 'lucide:folder-open' : 'lucide:folder';
  }
  // File icons based on extension
  const name = props.node.name.toLowerCase();
  if (name.endsWith('.html')) return 'vscode-icons:file-type-html';
  if (name.endsWith('.css')) return 'vscode-icons:file-type-css';
  if (name.endsWith('.js')) return 'vscode-icons:file-type-js';
  if (name.endsWith('.ts')) return 'vscode-icons:file-type-typescript';
  if (name.endsWith('.json')) return 'vscode-icons:file-type-json';
  if (name.endsWith('.vue')) return 'vscode-icons:file-type-vue';
  if (name.endsWith('.md')) return 'vscode-icons:file-type-markdown';
  return 'lucide:file';
});

// Check if this node itself is valid file
const isSelected = computed(() => {
  return props.node.type === 'file' && props.node.artifact?.id === props.activeArtifactId;
});

// Indent style
const indentStyle = computed(() => ({
  paddingLeft: `${(props.depth || 0) * 12 + 8}px`
}));
</script>

<template>
  <div>
    <div 
      class="flex items-center gap-1 py-1 px-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 transition-colors"
      :class="{ 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400': isSelected }"
      :style="indentStyle"
      @click="toggle"
    >
      <Icon :icon="icon" class="w-4 h-4 shrink-0" :class="node.type === 'folder' ? 'text-yellow-500' : ''" />
      <span class="truncate">{{ node.name }}</span>
    </div>

    <div v-if="node.type === 'folder' && isOpen">
      <FileTreeNode 
        v-for="child in node.children" 
        :key="child.path"
        :node="child"
        :active-artifact-id="activeArtifactId"
        :depth="(depth || 0) + 1"
        @select="(a) => emit('select', a)"
      />
    </div>
  </div>
</template>
