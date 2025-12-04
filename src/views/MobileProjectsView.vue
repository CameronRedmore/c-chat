<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useChatStore, type Project, type ChatSession } from '../stores/chat';
import { Icon } from '@iconify/vue';

const router = useRouter();
const chatStore = useChatStore();

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
      .filter(s => s.projectId === currentProjectId.value && !s.isTransient)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map(s => ({ ...s, type: 'session' as const }));
  } else {
    // Show root projects and root sessions
    const projs = chatStore.projects.map(p => ({ ...p, type: 'project' as const }));
    const sess = chatStore.sessions
      .filter(s => !s.projectId && !s.isTransient)
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
    router.push('/');
  }
}

function goBack() {
  if (currentProjectId.value) {
    currentProjectId.value = null;
  } else {
    router.push('/');
  }
}

function createNewChat() {
  // Logic from ChatView/Sidebar
  // We might need to access models from settings store, or just let ChatView handle the creation if we redirect?
  // Better to create it here so we can redirect to it.
  // But we need models. Let's import settings store.
  import('../stores/settings').then(({ useSettingsStore }) => {
    const settingsStore = useSettingsStore();
    if (settingsStore.models.length === 0) {
      alert('Please add a model in Settings first.');
      return;
    }
    chatStore.createSession(settingsStore.models[0].id);
    if (currentProjectId.value) {
        // If inside a project, move it there? 
        // The store createSession doesn't take a projectId.
        // We can update it after.
        const s = chatStore.sessions.find(s => s.id === chatStore.activeSessionId);
        if (s) {
            s.projectId = currentProjectId.value;
            chatStore.save();
        }
    }
    router.push('/');
  });
}

function createTransientChat() {
  import('../stores/settings').then(({ useSettingsStore }) => {
    const settingsStore = useSettingsStore();
    if (settingsStore.models.length === 0) {
      alert('Please add a model in Settings first.');
      return;
    }
    chatStore.createSession(settingsStore.models[0].id, undefined, undefined, { isTransient: true });
    router.push('/');
  });
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
    return lastMsg.content.substring(0, 100) + (lastMsg.content.length > 100 ? '...' : '');
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

</script>

<template>
  <div class="h-full flex flex-col bg-transparent text-gray-900 dark:text-gray-100">
    <!-- Header -->
    <div class="h-14 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 bg-transparent shrink-0">
      <div class="flex items-center gap-3">
        <button 
          @click="goBack"
          class="p-2 -ml-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
        >
          <Icon icon="lucide:arrow-left" class="w-5 h-5" />
        </button>
        <h2 class="font-bold text-lg truncate">
          {{ currentProject ? currentProject.name : 'Projects & Chats' }}
        </h2>
      </div>
      
      <div class="flex items-center gap-2">
        <button 
          @click="createProject"
          class="p-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
          title="New Project"
        >
          <Icon icon="lucide:folder-plus" class="w-5 h-5" />
        </button>
        <button 
            @click="createTransientChat"
            class="p-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
            :class="chatStore.activeSession?.isTransient ? 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20' : ''"
            title="New Transient Chat"
        >
            <Icon icon="lucide:ghost" class="w-5 h-5" />
        </button>
        <button 
          @click="createNewChat"
          class="p-2 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg"
          title="New Chat"
        >
          <Icon icon="lucide:plus" class="w-5 h-5" />
        </button>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto p-4">
      <div class="grid grid-cols-1 gap-3">
        <div 
          v-for="item in items" 
          :key="item.id"
          @click="handleItemClick(item)"
          class="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm active:scale-[0.98] transition-transform"
        >
          <div class="flex items-start gap-3">
            <div 
              class="p-3 rounded-lg shrink-0"
              :class="item.type === 'project' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'"
            >
              <Icon :icon="item.type === 'project' ? 'lucide:folder' : 'lucide:message-square'" class="w-6 h-6" />
            </div>
            
            <div class="flex-1 min-w-0">
              <div class="flex justify-between items-start">
                <h3 class="font-semibold truncate text-base mb-1">
                  {{ item.type === 'project' ? (item as Project).name : (item as ChatSession).title }}
                </h3>
                <span class="text-xs text-gray-400 shrink-0 ml-2">
                  {{ item.type === 'project' ? '' : new Date((item as ChatSession).createdAt).toLocaleDateString() }}
                </span>
              </div>
              
              <p class="text-sm text-gray-500 dark:text-gray-400 line-clamp-2">
                {{ item.type === 'project' 
                    ? `${getProjectItemCount(item.id)} items` 
                    : getSessionPreview(item as ChatSession) 
                }}
              </p>
            </div>
            
            <div class="self-center flex items-center gap-1">
                <button 
                    @click.stop="openMenu(item, $event)"
                    class="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                    <Icon icon="lucide:more-vertical" class="w-5 h-5" />
                </button>
                <Icon icon="lucide:chevron-right" class="w-5 h-5 text-gray-300 dark:text-gray-600" />
            </div>
          </div>
        </div>
        
        <div v-if="items.length === 0" class="text-center py-10 text-gray-500">
            No items found.
        </div>
      </div>
    </div>

    <!-- Menu Overlay -->
    <div v-if="menuOpen" class="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4" @click="closeMenu">
      <div class="bg-white dark:bg-gray-800 w-full max-w-sm rounded-xl overflow-hidden shadow-xl" @click.stop>
        <div class="p-4 border-b border-gray-200 dark:border-gray-700">
           <h3 class="font-semibold text-lg">
             {{ activeItem?.type === 'project' ? 'Project Options' : 'Chat Options' }}
           </h3>
        </div>
        <div class="flex flex-col">
          <button @click="handleRename" class="p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-3">
            <Icon icon="lucide:pencil" class="w-5 h-5" />
            Rename
          </button>
          <button 
            v-if="activeItem?.type === 'session'" 
            @click="openMoveModal" 
            class="p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-3"
          >
            <Icon icon="lucide:folder-input" class="w-5 h-5" />
            Move to Project
          </button>
          <button @click="handleDelete" class="p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-700 text-red-600 dark:text-red-400 flex items-center gap-3">
            <Icon icon="lucide:trash-2" class="w-5 h-5" />
            Delete
          </button>
        </div>
        <div class="p-2 bg-gray-50 dark:bg-gray-900/50">
            <button @click="closeMenu" class="w-full p-3 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 font-medium">
                Cancel
            </button>
        </div>
      </div>
    </div>

    <!-- Move Modal -->
    <div v-if="moveModalOpen" class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" @click="moveModalOpen = false">
      <div class="bg-white dark:bg-gray-800 w-full max-w-sm rounded-xl overflow-hidden shadow-xl flex flex-col max-h-[80vh]" @click.stop>
        <div class="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
           <h3 class="font-semibold text-lg">Move to Project</h3>
           <button @click="moveModalOpen = false" class="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700">
             <Icon icon="lucide:x" class="w-5 h-5" />
           </button>
        </div>
        <div class="flex-1 overflow-y-auto p-2">
            <button 
                @click="handleMove(null)"
                class="w-full p-3 text-left rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-3"
                :class="!(activeItem as any)?.projectId ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600' : ''"
            >
                <div class="p-2 bg-gray-100 dark:bg-gray-700 rounded-lg">
                    <Icon icon="lucide:layout-grid" class="w-5 h-5" />
                </div>
                <span>No Project (Root)</span>
                <Icon v-if="!(activeItem as any)?.projectId" icon="lucide:check" class="ml-auto w-4 h-4" />
            </button>
            
            <div class="h-px bg-gray-200 dark:bg-gray-700 my-2"></div>

            <button 
                v-for="proj in availableProjects"
                :key="proj.id"
                @click="handleMove(proj.id)"
                class="w-full p-3 text-left rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-3"
                :class="(activeItem as any)?.projectId === proj.id ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600' : ''"
            >
                <div class="p-2 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg">
                    <Icon icon="lucide:folder" class="w-5 h-5" />
                </div>
                <span class="truncate">{{ proj.name }}</span>
                <Icon v-if="(activeItem as any)?.projectId === proj.id" icon="lucide:check" class="ml-auto w-4 h-4" />
            </button>
             <div v-if="availableProjects.length === 0" class="text-center py-4 text-gray-500">
                No projects available
            </div>
        </div>
      </div>
    </div>
  </div>
</template>
