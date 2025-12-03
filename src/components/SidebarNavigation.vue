<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useChatStore, type Project, type ChatSession } from '../stores/chat';
import { useSettingsStore } from '../stores/settings';
import { Icon } from '@iconify/vue';

const router = useRouter();
const chatStore = useChatStore();
const settingsStore = useSettingsStore();

const currentProjectId = ref<string | null>(null);
const menuOpen = ref(false);
const moveModalOpen = ref(false);
const activeItem = ref<(Project | ChatSession) & { type: 'project' | 'session' } | null>(null);

const currentProject = computed(() => {
  if (!currentProjectId.value) return null;
  return chatStore.projects.find(p => p.id === currentProjectId.value);
});

const items = computed(() => {
  if (currentProjectId.value) {
    // Show sessions in this project
    return chatStore.sessions
      .filter(s => s.projectId === currentProjectId.value)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map(s => ({ ...s, type: 'session' as const }));
  } else {
    // Show root projects and root sessions
    const projs = chatStore.projects.map(p => ({ ...p, type: 'project' as const }));
    const sess = chatStore.sessions
      .filter(s => !s.projectId)
      .map(s => ({ ...s, type: 'session' as const }));
    
    return [...projs, ...sess].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
});

const availableProjects = computed(() => {
  return chatStore.projects.sort((a, b) => a.name.localeCompare(b.name));
});

function handleItemClick(item: (Project | ChatSession) & { type: 'project' | 'session' }) {
  if (item.type === 'project') {
    currentProjectId.value = item.id;
  } else {
    chatStore.activeSessionId = item.id;
    // If on mobile, we might want to close the sidebar, but this component doesn't control that directly.
    // We can emit an event.
    emit('sessionSelected');
  }
}

const emit = defineEmits<{
  (e: 'sessionSelected'): void;
}>();

function goBack() {
  if (currentProjectId.value) {
    currentProjectId.value = null;
  }
}

function createNewChat() {
  if (settingsStore.models.length === 0) {
    alert('Please add a model in Settings first.');
    return;
  }
  chatStore.createSession(settingsStore.models[0].id);
  if (currentProjectId.value) {
      const s = chatStore.sessions.find(s => s.id === chatStore.activeSessionId);
      if (s) {
          s.projectId = currentProjectId.value;
          chatStore.save();
      }
  }
  emit('sessionSelected');
}

function createProject() {
  const name = prompt("Project Name:");
  if (name) {
    chatStore.createProject(name);
  }
}

function getSessionPreview(session: ChatSession) {
  if (session.messages.length > 0) {
    const lastMsg = session.messages[session.messages.length - 1];
    return lastMsg.content.substring(0, 50) + (lastMsg.content.length > 50 ? '...' : '');
  }
  return 'No messages yet';
}

function getProjectItemCount(projectId: string) {
    return chatStore.sessions.filter(s => s.projectId === projectId).length;
}

function openMenu(item: (Project | ChatSession) & { type: 'project' | 'session' }, event: Event) {
  event.stopPropagation();
  activeItem.value = item;
  menuOpen.value = true;
}

function closeMenu() {
  menuOpen.value = false;
  if (!moveModalOpen.value) {
     activeItem.value = null;
  }
}

function handleRename() {
  if (!activeItem.value) return;
  const isProject = activeItem.value.type === 'project';
  const oldName = isProject ? (activeItem.value as Project).name : (activeItem.value as ChatSession).title;
  const newName = prompt(isProject ? "Rename Project" : "Rename Chat", oldName);
  
  if (newName && newName !== oldName) {
    if (isProject) {
      chatStore.updateProject(activeItem.value.id, { name: newName });
    } else {
      chatStore.updateSessionSettings(activeItem.value.id, { title: newName });
    }
  }
  closeMenu();
  activeItem.value = null;
}

function handleDelete() {
  if (!activeItem.value) return;
  const isProject = activeItem.value.type === 'project';
  if (confirm(`Are you sure you want to delete this ${isProject ? 'project' : 'chat'}?`)) {
    if (isProject) {
      chatStore.deleteProject(activeItem.value.id);
      if (currentProjectId.value === activeItem.value.id) {
        currentProjectId.value = null;
      }
    } else {
      chatStore.deleteSession(activeItem.value.id);
    }
  }
  closeMenu();
  activeItem.value = null;
}

function openMoveModal() {
  menuOpen.value = false;
  moveModalOpen.value = true;
}

function handleMove(targetProjectId: string | null) {
  if (activeItem.value && activeItem.value.type === 'session') {
    chatStore.updateSessionSettings(activeItem.value.id, { projectId: targetProjectId || undefined });
  }
  moveModalOpen.value = false;
  activeItem.value = null;
}

function openFullView() {
  router.push('/projects');
}

</script>

<template>
  <div class="h-full flex flex-col bg-transparent text-gray-900 dark:text-gray-100">
    <!-- Header -->
    <div class="p-2 border-b border-gray-200 dark:border-gray-700 flex flex-col gap-2 shrink-0">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2 min-w-0">
          <button 
            v-if="currentProjectId"
            @click="goBack"
            class="p-1.5 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg"
            title="Back"
          >
            <Icon icon="lucide:arrow-left" class="w-4 h-4" />
          </button>
          <h2 class="font-bold text-sm truncate">
            {{ currentProject ? currentProject.name : 'Projects & Chats' }}
          </h2>
        </div>
        <button 
            @click="openFullView"
            class="p-1.5 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700"
            title="Open Full View"
        >
            <Icon icon="lucide:maximize-2" class="w-4 h-4" />
        </button>
      </div>

      <div class="flex gap-2">
        <button 
          @click="createNewChat"
          class="flex-1 py-1.5 px-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-1.5"
        >
          <Icon icon="lucide:plus" class="w-4 h-4" /> New Chat
        </button>
        <button 
          @click="createProject"
          class="py-1.5 px-2 bg-gray-200/60 dark:bg-gray-700/60 text-gray-800 dark:text-white text-sm rounded-lg hover:bg-gray-300/60 dark:hover:bg-gray-600/60 transition-colors flex items-center justify-center"
          title="New Project"
        >
          <Icon icon="lucide:folder-plus" class="w-4 h-4" />
        </button>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto p-2">
      <div class="space-y-1">
        <div 
          v-for="item in items" 
          :key="item.id"
          @click="handleItemClick(item)"
          class="group flex items-center gap-2 p-2 rounded-lg cursor-pointer border border-transparent hover:bg-gray-200/60 dark:hover:bg-gray-700/60 transition-colors"
          :class="{
            'bg-gray-200/60 dark:bg-gray-700/60 border-gray-300/50 dark:border-gray-600/50': item.type === 'session' && chatStore.activeSessionId === item.id
          }"
        >
          <div 
            class="shrink-0"
            :class="item.type === 'project' ? 'text-blue-600 dark:text-blue-400' : 'text-purple-600 dark:text-purple-400'"
          >
            <Icon :icon="item.type === 'project' ? 'lucide:folder' : 'lucide:message-square'" class="w-4 h-4" />
          </div>
          
          <div class="flex-1 min-w-0">
            <div class="flex justify-between items-center">
              <span class="font-medium text-sm truncate">
                {{ item.type === 'project' ? (item as Project).name : (item as ChatSession).title }}
              </span>
            </div>
            <div class="text-xs text-gray-500 dark:text-gray-400 truncate">
                {{ item.type === 'project' 
                    ? `${getProjectItemCount(item.id)} items` 
                    : getSessionPreview(item as ChatSession) 
                }}
            </div>
          </div>
          
          <button 
            @click.stop="openMenu(item, $event)"
            class="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
          >
            <Icon icon="lucide:more-vertical" class="w-3 h-3" />
          </button>
          
          <Icon v-if="item.type === 'project'" icon="lucide:chevron-right" class="w-3 h-3 text-gray-400" />
        </div>
        
        <div v-if="items.length === 0" class="text-center py-8 text-gray-500 text-sm">
            No items found.
        </div>
      </div>
    </div>

    <!-- Menu Overlay -->
    <div v-if="menuOpen" class="fixed inset-0 z-50 flex items-center justify-center p-4" @click="closeMenu">
      <div class="absolute inset-0 bg-black/20" @click="closeMenu"></div>
      <div class="bg-white dark:bg-gray-800 w-64 rounded-xl overflow-hidden shadow-xl relative z-10" @click.stop>
        <div class="p-3 border-b border-gray-200 dark:border-gray-700">
           <h3 class="font-semibold text-sm">
             {{ activeItem?.type === 'project' ? 'Project Options' : 'Chat Options' }}
           </h3>
        </div>
        <div class="flex flex-col text-sm">
          <button @click="handleRename" class="p-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2">
            <Icon icon="lucide:pencil" class="w-4 h-4" />
            Rename
          </button>
          <button 
            v-if="activeItem?.type === 'session'" 
            @click="openMoveModal" 
            class="p-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
          >
            <Icon icon="lucide:folder-input" class="w-4 h-4" />
            Move to Project
          </button>
          <button @click="handleDelete" class="p-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700 text-red-600 dark:text-red-400 flex items-center gap-2">
            <Icon icon="lucide:trash-2" class="w-4 h-4" />
            Delete
          </button>
        </div>
      </div>
    </div>

    <!-- Move Modal -->
    <div v-if="moveModalOpen" class="fixed inset-0 z-50 flex items-center justify-center p-4" @click="moveModalOpen = false">
      <div class="absolute inset-0 bg-black/50" @click="moveModalOpen = false"></div>
      <div class="bg-white dark:bg-gray-800 w-full max-w-xs rounded-xl overflow-hidden shadow-xl flex flex-col max-h-[80vh] relative z-10" @click.stop>
        <div class="p-3 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
           <h3 class="font-semibold text-sm">Move to Project</h3>
           <button @click="moveModalOpen = false" class="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700">
             <Icon icon="lucide:x" class="w-4 h-4" />
           </button>
        </div>
        <div class="flex-1 overflow-y-auto p-2 text-sm">
            <button 
                @click="handleMove(null)"
                class="w-full p-2 text-left rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
                :class="!(activeItem as any)?.projectId ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600' : ''"
            >
                <div class="p-1.5 bg-gray-100 dark:bg-gray-700 rounded-lg">
                    <Icon icon="lucide:layout-grid" class="w-4 h-4" />
                </div>
                <span>No Project (Root)</span>
                <Icon v-if="!(activeItem as any)?.projectId" icon="lucide:check" class="ml-auto w-3 h-3" />
            </button>
            
            <div class="h-px bg-gray-200 dark:bg-gray-700 my-2"></div>

            <button 
                v-for="proj in availableProjects"
                :key="proj.id"
                @click="handleMove(proj.id)"
                class="w-full p-2 text-left rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
                :class="(activeItem as any)?.projectId === proj.id ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600' : ''"
            >
                <div class="p-1.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg">
                    <Icon icon="lucide:folder" class="w-4 h-4" />
                </div>
                <span class="truncate">{{ proj.name }}</span>
                <Icon v-if="(activeItem as any)?.projectId === proj.id" icon="lucide:check" class="ml-auto w-3 h-3" />
            </button>
             <div v-if="availableProjects.length === 0" class="text-center py-4 text-gray-500">
                No projects available
            </div>
        </div>
      </div>
    </div>
  </div>
</template>
