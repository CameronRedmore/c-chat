<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { ChatSession } from '../stores/chat';
import { buildTree, calculateLayout, type TreeNode, type TreeLayout } from '../utils/treeLayout';

const props = defineProps<{
  session: ChatSession;
}>();

const emit = defineEmits<{
  (e: 'select-message', messageId: string): void;
}>();

const container = ref<HTMLElement | null>(null);
const layout = ref<TreeLayout | null>(null);
const scale = ref(1);
const translateX = ref(0);
const translateY = ref(0);
const isDragging = ref(false);
const startX = ref(0);
const startY = ref(0);

const treeData = computed(() => {
  if (!props.session.messages.length) return null;
  const roots = buildTree(props.session.messages);
  return calculateLayout(roots);
});

watch(treeData, (newData) => {
  if (newData) {
    layout.value = newData;
    centerTree();
  }
}, { immediate: true });

function centerTree() {
  if (!container.value || !layout.value) return;
  const { width, height } = container.value.getBoundingClientRect();
  const treeWidth = layout.value.width;
  const treeHeight = layout.value.height;
  
  // Fit to screen if too big, but min scale 0.5
  const scaleX = width / (treeWidth + 100);
  const scaleY = height / (treeHeight + 100);
  scale.value = Math.min(Math.max(Math.min(scaleX, scaleY), 0.5), 1.5);
  
  translateX.value = (width - treeWidth * scale.value) / 2;
  translateY.value = 50; // Start slightly from top
}

function handleWheel(e: WheelEvent) {
  if (e.ctrlKey) {
    e.preventDefault();
    const delta = -e.deltaY * 0.001;
    const newScale = Math.min(Math.max(scale.value + delta, 0.1), 3);
    scale.value = newScale;
  } else {
    translateX.value -= e.deltaX;
    translateY.value -= e.deltaY;
  }
}

function startDrag(e: MouseEvent) {
  isDragging.value = true;
  startX.value = e.clientX - translateX.value;
  startY.value = e.clientY - translateY.value;
  window.addEventListener('mousemove', onDrag);
  window.addEventListener('mouseup', stopDrag);
}

function onDrag(e: MouseEvent) {
  if (!isDragging.value) return;
  translateX.value = e.clientX - startX.value;
  translateY.value = e.clientY - startY.value;
}

function stopDrag() {
  isDragging.value = false;
  window.removeEventListener('mousemove', onDrag);
  window.removeEventListener('mouseup', stopDrag);
}

function selectNode(node: TreeNode) {
  emit('select-message', node.id);
}

function getConnectorPath(node: TreeNode) {
  // Draw lines to children
  if (!node.children.length) return '';
  
  const startX = node.x + node.width / 2;
  const startY = node.y + node.height;
  
  return node.children.map(child => {
    const endX = child.x + child.width / 2;
    const endY = child.y;
    
    // Cubic bezier curve
    const cp1x = startX;
    const cp1y = startY + 30;
    const cp2x = endX;
    const cp2y = endY - 30;
    
    return `M ${startX} ${startY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${endX} ${endY}`;
  }).join(' ');
}

// Check if a node is on the active path
const activePathIds = computed(() => {
  const ids = new Set<string>();
  if (!props.session.currentLeafId) return ids;
  
  let curr: string | undefined | null = props.session.currentLeafId;
  while (curr) {
    ids.add(curr);
    const msg = props.session.messages.find(m => m.id === curr);
    curr = msg?.parentId;
  }
  return ids;
});

</script>

<template>
  <div 
    ref="container" 
    class="w-full h-full overflow-hidden bg-gray-50 dark:bg-gray-900 relative cursor-grab active:cursor-grabbing"
    @wheel="handleWheel"
    @mousedown="startDrag"
  >
    <div 
      v-if="layout"
      class="absolute origin-top-left transition-transform duration-75 ease-out"
      :style="{ transform: `translate(${translateX}px, ${translateY}px) scale(${scale})` }"
    >
      <!-- Connections -->
      <svg :width="layout.width" :height="layout.height" class="absolute top-0 left-0 pointer-events-none">
        <path 
          v-for="node in layout.nodes" 
          :key="'path-' + node.id"
          :d="getConnectorPath(node)"
          stroke="#9ca3af"
          stroke-width="2"
          fill="none"
          class="opacity-50"
        />
      </svg>

      <!-- Nodes -->
      <div 
        v-for="node in layout.nodes" 
        :key="node.id"
        class="absolute flex flex-col items-center justify-center p-2 rounded-lg border shadow-sm transition-all hover:shadow-md cursor-pointer"
        :class="[
          activePathIds.has(node.id) ? 'ring-2 ring-blue-500 border-blue-500' : 'border-gray-200 dark:border-gray-700 hover:border-gray-400',
          node.message.role === 'user' ? 'bg-blue-50 dark:bg-blue-900/20' : 'bg-white dark:bg-gray-800'
        ]"
        :style="{
          width: node.width + 'px',
          height: node.height + 'px',
          left: node.x + 'px',
          top: node.y + 'px'
        }"
        @mousedown.stop
        @click="selectNode(node)"
      >
        <div class="text-[10px] uppercase font-bold mb-1 opacity-50">
          {{ node.message.role }}
        </div>
        <div class="text-xs text-center line-clamp-3 w-full px-1 overflow-hidden">
          {{ node.message.content || '(No content)' }}
        </div>
        <div v-if="node.message.toolCalls?.length" class="mt-1 flex gap-1">
           <span class="text-[10px] bg-purple-100 dark:bg-purple-900/30 text-purple-600 px-1 rounded">
             🛠️ {{ node.message.toolCalls.length }}
           </span>
        </div>
      </div>
    </div>
    
    <!-- Controls -->
    <div class="absolute bottom-4 right-4 flex flex-col gap-2">
      <button @click="centerTree" class="p-2 bg-white dark:bg-gray-800 rounded-full shadow border border-gray-200 dark:border-gray-700 hover:bg-gray-50">
        🎯
      </button>
    </div>
  </div>
</template>
