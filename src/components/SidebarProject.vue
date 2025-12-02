<script setup lang="ts">
import { computed, ref, nextTick } from 'vue';
import draggable from 'vuedraggable';
import { useChatStore, type Project } from '../stores/chat';
import { Icon } from '@iconify/vue';

const props = defineProps<{
  project: Project;
  activeSessionId: string | null;
}>();

const emit = defineEmits<{
  (e: 'selectSession', id: string): void;
  (e: 'deleteSession', id: string, event: Event): void;
  (e: 'deleteProject', id: string, event: Event): void;
  (e: 'toggleProject', project: Project): void;
  (e: 'renameProject', id: string, name: string): void;
  (e: 'renameSession', id: string, title: string): void;
}>();

const chatStore = useChatStore();
const isEditing = ref(false);
const editName = ref('');
const nameInput = ref<HTMLInputElement | null>(null);

const editingSessionId = ref<string | null>(null);
const editSessionTitle = ref('');
const sessionInput = ref<HTMLInputElement | null>(null);

function startEditing() {
  editName.value = props.project.name;
  isEditing.value = true;
  nextTick(() => {
    nameInput.value?.focus();
  });
}

function saveName() {
  if (isEditing.value && editName.value.trim()) {
    emit('renameProject', props.project.id, editName.value.trim());
  }
  isEditing.value = false;
}

function startEditingSession(session: any) {
  editingSessionId.value = session.id;
  editSessionTitle.value = session.title;
  nextTick(() => {
    sessionInput.value?.focus();
  });
}

function saveSessionTitle(sessionId: string) {
  if (editingSessionId.value === sessionId && editSessionTitle.value.trim()) {
    emit('renameSession', sessionId, editSessionTitle.value.trim());
  }
  editingSessionId.value = null;
}

const projectSessions = computed({
  get: () => {
    return chatStore.sessions
      .filter(s => s.projectId === props.project.id)
      .map(s => ({ ...s, type: 'session' }))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  },
  set: (items) => {
    items.forEach((item, index) => {
      const s = chatStore.sessions.find(s => s.id === item.id);
      if (s) {
        s.order = index;
        s.projectId = props.project.id;
      }
    });
    chatStore.save();
  }
});

function checkMove(evt: any) {
  // Prevent dropping projects into projects
  if (evt.draggedContext.element.type === 'project') {
    return false;
  }
  return true;
}
</script>

<template>
  <div class="mb-1">
    <!-- Project Header -->
    <div 
      class="flex items-center px-2 py-1 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 rounded group"
      @click="emit('toggleProject', project)"
    >
      <span class="mr-2 text-xs text-gray-500 transform transition-transform" :class="{ 'rotate-90': project.isExpanded }">▶</span>
      
      <div v-if="isEditing" class="flex-1 mr-2">
        <input
          ref="nameInput"
          v-model="editName"
          @blur="saveName"
          @keydown.enter="saveName"
          @click.stop
          class="w-full px-1 py-0.5 text-sm border rounded dark:bg-gray-800 dark:border-gray-600"
        />
      </div>
      <span 
        v-else 
        @dblclick.stop="startEditing" 
        class="font-semibold text-sm flex-1 truncate select-none"
        title="Double click to rename"
      >
        {{ project.name }}
      </span>

      <div v-if="!isEditing" class="opacity-0 group-hover:opacity-100 flex gap-1">
        <button 
          @click.stop="startEditing"
          class="text-gray-400 hover:text-blue-500 p-1"
          title="Rename"
        >
          <Icon icon="lucide:pencil" class="w-3 h-3" />
        </button>
        <button 
          @click="(e) => emit('deleteProject', project.id, e)"
          class="text-gray-400 hover:text-red-500 p-1"
          title="Delete"
        >
          <Icon icon="lucide:trash-2" class="w-3 h-3" />
        </button>
      </div>
    </div>

    <!-- Project Sessions -->
    <div v-if="project.isExpanded" class="ml-4 border-l-2 border-gray-200 dark:border-gray-700 pl-1">
      <draggable
        v-model="projectSessions"
        group="sidebar"
        item-key="id"
        :move="checkMove"
        class="min-h-[10px]"
      >
        <template #item="{ element }">
          <div 
            @click.stop="emit('selectSession', element.id)"
            class="p-2 rounded-lg cursor-pointer group relative text-sm"
            :class="activeSessionId === element.id ? 'bg-gray-200 dark:bg-gray-700' : 'hover:bg-gray-100 dark:hover:bg-gray-700'"
          >
            <div v-if="editingSessionId === element.id" class="pr-6">
              <input
                ref="sessionInput"
                v-model="editSessionTitle"
                @blur="saveSessionTitle(element.id)"
                @keydown.enter="saveSessionTitle(element.id)"
                @click.stop
                class="w-full px-1 py-0.5 text-sm border rounded dark:bg-gray-800 dark:border-gray-600"
              />
            </div>
            <div 
              v-else
              @dblclick.stop="startEditingSession(element)"
              class="truncate pr-6 select-none"
              title="Double click to rename"
            >
              {{ element.title }}
            </div>
            <div v-if="editingSessionId !== element.id" class="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 flex gap-1">
              <button 
                @click.stop="startEditingSession(element)"
                class="text-gray-400 hover:text-blue-500 p-1"
                title="Rename"
              >
                <Icon icon="lucide:pencil" class="w-3 h-3" />
              </button>
              <button 
                @click.stop="(e) => emit('deleteSession', element.id, e)"
                class="text-gray-400 hover:text-red-500 p-1"
                title="Delete"
              >
                <Icon icon="lucide:trash-2" class="w-3 h-3" />
              </button>
            </div>
          </div>
        </template>
      </draggable>
    </div>
  </div>
</template>
