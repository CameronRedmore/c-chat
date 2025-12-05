<script setup lang="ts">
import { computed } from 'vue';
import type { Artifact } from '../stores/chat';
import FileTreeNode, { type TreeNode } from './FileTreeNode.vue';

const props = defineProps<{
  artifacts: Artifact[];
  activeArtifactId: string | null;
}>();

const emit = defineEmits<{
  (e: 'select', artifact: Artifact): void;
}>();

const rootNodes = computed(() => {
  if (!props.artifacts) return [];

  const root: any = { children: {} };

  for (const artifact of props.artifacts) {
    const path = artifact.path || artifact.id;
    // Normalize path
    const parts = path.split('/').filter(p => p.trim() !== '');
    if (parts.length === 0) continue;

    let current = root;
    let currentPath = '';

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isFile = i === parts.length - 1;
        currentPath = currentPath ? `${currentPath}/${part}` : part;

        if (!current.children[part]) {
            current.children[part] = {
                name: part,
                path: currentPath,
                type: isFile ? 'file' : 'folder',
                children: {},
                artifact: isFile ? artifact : undefined
            };
        }
        current = current.children[part];
    }
  }

  const nodeToArray = (map: any): TreeNode[] => {
      return Object.values(map).sort((a: any, b: any) => {
          if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
          return a.name.localeCompare(b.name);
      }).map((node: any) => ({
          ...node,
          children: node.type === 'folder' ? nodeToArray(node.children) : []
      }));
  };

  return nodeToArray(root.children);
});
</script>

<template>
  <div class="h-full overflow-y-auto py-2 text-xs">
    <div v-if="rootNodes.length === 0" class="p-4 text-center text-gray-500">
      No files
    </div>
    <div v-else>
      <FileTreeNode 
        v-for="node in rootNodes" 
        :key="node.path" 
        :node="node" 
        :active-artifact-id="activeArtifactId"
        @select="(a) => emit('select', a)"
      />
    </div>
  </div>
</template>
