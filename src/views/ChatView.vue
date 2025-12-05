<script setup lang="ts">
import { ref, nextTick, watch, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useChatStore, type Message, type Attachment } from '../stores/chat';
import { useSettingsStore } from '../stores/settings';
import { storeToRefs } from 'pinia';
import SidebarNavigation from '../components/SidebarNavigation.vue';
import ToolsSelector from '../components/ToolsSelector.vue';
import MessageBubble from '../components/MessageBubble.vue';
import ChatSettingsFlyout from '../components/ChatSettingsFlyout.vue';
import ConversationTree from '../components/ConversationTree.vue';
import ArtifactsPanel from '../components/ArtifactsPanel.vue';
import { Icon } from '@iconify/vue';

const router = useRouter();
const chatStore = useChatStore();
const settingsStore = useSettingsStore();
const { activeSession, activeThread, isGenerating } = storeToRefs(chatStore);
const { models } = storeToRefs(settingsStore);

const userInput = ref('');
const isFlyoutOpen = ref(false);
const isTreeViewOpen = ref(false);
const isArtifactsOpen = ref(false);
const messagesContainer = ref<HTMLElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const selectedAttachments = ref<Attachment[]>([]);
const isDragging = ref(false);
const isSidebarOpen = ref(false);

const currentModel = computed(() => {
  if (!activeSession.value) return null;
  return models.value.find(m => m.id === activeSession.value!.modelId);
});

const isVisionSupported = computed(() => {
  return currentModel.value?.supportsVision ?? false;
});

function triggerFileInput() {
  if (!isVisionSupported.value) return;
  fileInput.value?.click();
}

async function processFiles(files: FileList | File[]) {
  if (!isVisionSupported.value) return;

  for (const file of Array.from(files)) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      selectedAttachments.value.push({
        name: file.name,
        type: file.type,
        content: content
      });
    };

    if (file.type.startsWith('image/')) {
      reader.readAsDataURL(file);
    } else {
      reader.readAsText(file);
    }
  }
}

async function handleFileSelect(event: Event) {
  if (!isVisionSupported.value) return;
  const input = event.target as HTMLInputElement;
  if (!input.files?.length) return;

  processFiles(input.files);
  input.value = '';
}

function handleDragOver() {
  if (!isVisionSupported.value) return;
  isDragging.value = true;
}

function handleDrop(event: DragEvent) {
  isDragging.value = false;
  if (!isVisionSupported.value) return;

  const files = event.dataTransfer?.files;
  if (files && files.length > 0) {
    processFiles(files);
  }
}

function handleDragLeave(event: DragEvent) {
  const relatedTarget = event.relatedTarget as Node | null;
  const currentTarget = event.currentTarget as Node | null;

  if (currentTarget instanceof Node && relatedTarget instanceof Node && currentTarget.contains(relatedTarget)) {
    return;
  }
  isDragging.value = false;
}

function handlePaste(event: ClipboardEvent) {
  if (!isVisionSupported.value) return;

  const items = event.clipboardData?.items;
  if (!items) return;

  const files: File[] = [];
  for (const item of items) {
    if (item.kind === 'file') {
      const itemFile = item.getAsFile();
      if (itemFile) files.push(itemFile);
    }
  }

  if (files.length > 0) {
    processFiles(files);
  }
}

function removeAttachment(index: number) {
  selectedAttachments.value.splice(index, 1);
}

async function handleSend() {
  if ((!userInput.value.trim() && selectedAttachments.value.length === 0) || !activeSession.value || isGenerating.value) return;

  const sessionId = activeSession.value.id;
  const content = userInput.value;
  const attachments = [...selectedAttachments.value];

  userInput.value = '';
  selectedAttachments.value = [];

  await chatStore.sendUserMessage(sessionId, content, attachments, () => {
    scrollToBottom();
  });
}

function stopGeneration() {
  chatStore.stopGeneration();
}

async function handleRegenerate(messageId: string) {
  if (!activeSession.value || isGenerating.value) return;

  await chatStore.regenerateMessage(activeSession.value.id, messageId, () => {
    scrollToBottom();
  });
}

function scrollToBottom() {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
}

function handleDeleteMessage(messageId: string) {
  if (activeSession.value && confirm('Delete this message?')) {
    chatStore.deleteMessage(activeSession.value.id, messageId);
  }
}

function handleEditMessage(messageId: string, newContent: string) {
  if (activeSession.value) {
    chatStore.editMessage(activeSession.value.id, messageId, newContent);
  }
}

function handleNavigateBranch(messageId: string, direction: 'prev' | 'next') {
  if (activeSession.value) {
    chatStore.navigateBranch(activeSession.value.id, messageId, direction);
  }
}

function updateModel(event: Event) {
  if (!activeSession.value) return;
  const select = event.target as HTMLSelectElement;
  chatStore.updateSessionSettings(activeSession.value.id, { modelId: select.value });
}

function getBranchInfo(message: Message) {
  if (!activeSession.value) return { index: 0, count: 0 };

  const session = activeSession.value;
  let siblings: string[] = [];

  if (message.parentId) {
    const parent = session.messages.find(m => m.id === message.parentId);
    if (parent && parent.childrenIds) {
      siblings = parent.childrenIds;
    }
  } else {
    siblings = session.messages
      .filter(m => !m.parentId)
      .map(m => m.id!);
  }

  if (siblings.length <= 1) return { index: 0, count: 0 };

  const index = siblings.indexOf(message.id!) + 1;
  return { index, count: siblings.length };
}

function handleTreeSelection(messageId: string) {
  if (!activeSession.value) return;
  chatStore.setCurrentLeaf(activeSession.value.id, messageId);
  isTreeViewOpen.value = false;
}

watch(() => activeThread.value.length, () => {
  nextTick(scrollToBottom);
});

// Auto-open artifacts panel when a new artifact is added
watch(() => activeSession.value?.artifacts?.length, (newLen, oldLen) => {
  if (newLen && newLen > (oldLen || 0)) {
    isArtifactsOpen.value = true;
  }
});

// Auto-close artifacts panel when switching to a chat without artifacts
watch(() => activeSession.value?.id, () => {
  if (activeSession.value && (!activeSession.value.artifacts || activeSession.value.artifacts.length === 0)) {
    isArtifactsOpen.value = false;
  }
});
</script>

<template>
  <div class="flex h-full relative">
    <!-- Mobile Overlay -->
    <div v-if="isSidebarOpen" class="md:hidden absolute inset-0 z-20 bg-black/50" @click="isSidebarOpen = false"></div>

    <!-- Sidebar -->
    <div class="w-64 bg-transparent border-r border-gray-200 dark:border-gray-700 flex flex-col
             absolute md:relative z-30 h-full transition-transform duration-300 ease-in-out"
      :class="isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'">
      <SidebarNavigation @session-selected="isSidebarOpen = false" />
    </div>

    <!-- Main Chat Area -->
    <div class="flex-1 flex flex-col h-full relative w-full">
      <!-- Header -->
      <div
        class="h-14 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 bg-transparent">
        <div class="flex items-center gap-3">
          <button @click="router.push('/projects')"
            class="md:hidden p-2 -ml-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
            <Icon icon="lucide:menu" class="w-5 h-5" />
          </button>
          <h2 class="font-bold truncate max-w-[150px] sm:max-w-none">{{ activeSession?.title || 'Select a chat' }}</h2>
        </div>

        <div v-if="activeSession" class="flex items-center gap-2">
          <button @click="isTreeViewOpen = !isTreeViewOpen"
            class="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg flex items-center gap-2"
            :class="{ 'bg-gray-100 dark:bg-gray-800 text-blue-600': isTreeViewOpen }" title="Toggle Tree View">
            <Icon icon="lucide:git-branch" class="w-5 h-5" />
          </button>
          <button @click="isArtifactsOpen = !isArtifactsOpen"
            class="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg flex items-center gap-2"
            :class="{ 'bg-gray-100 dark:bg-gray-800 text-blue-600': isArtifactsOpen }" title="Toggle Artifacts">
            <Icon icon="lucide:box" class="w-5 h-5" />
          </button>
          <button @click="isFlyoutOpen = !isFlyoutOpen"
            class="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg flex items-center gap-2"
            title="Chat Settings">
            <Icon icon="lucide:sliders-horizontal" class="w-5 h-5" />
          </button>
        </div>
      </div>

      <!-- Tree View Overlay -->
      <div v-if="isTreeViewOpen && activeSession"
        class="flex-1 relative overflow-hidden bg-gray-50 dark:bg-gray-900 z-10">
        <ConversationTree :session="activeSession" @select-message="handleTreeSelection" />
      </div>

      <!-- Messages -->
      <div v-else ref="messagesContainer" class="flex-1 overflow-y-auto p-4 space-y-4">
        <div v-if="!activeSession" class="h-full flex items-center justify-center text-gray-500">
          Select or create a chat to start messaging.
        </div>
        <template v-else>
          <MessageBubble v-for="(msg, index) in activeThread" :key="msg.id || index" :message="msg"
            :branch-index="getBranchInfo(msg).index" :branch-count="getBranchInfo(msg).count"
            @delete="handleDeleteMessage(msg.id!)" @edit="handleEditMessage(msg.id!, $event)"
            @regenerate="handleRegenerate(msg.id!)" @navigate="handleNavigateBranch(msg.id!, $event)" />
        </template>
      </div>

      <!-- Input Area -->
      <div v-if="activeSession" class="p-4 border-t border-gray-200 dark:border-gray-700 bg-transparent">
        <div
          class="max-w-4xl mx-auto relative rounded-xl border border-gray-300 dark:border-gray-600 bg-gray-50/80 dark:bg-gray-800/60 backdrop-blur-sm transition-colors focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500"
          :class="{ 'bg-blue-50 dark:bg-blue-900/20 ring-2 ring-blue-500': isDragging }"
          @dragover.prevent="handleDragOver" @dragleave.prevent="handleDragLeave" @drop.prevent="handleDrop">
          <!-- Attachments Preview -->
          <div v-if="selectedAttachments.length > 0"
            class="p-2 flex gap-2 overflow-x-auto border-b border-gray-200 dark:border-gray-700">
            <div v-for="(file, index) in selectedAttachments" :key="index"
              class="relative group shrink-0 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2 w-24 h-24 flex flex-col items-center justify-center">
              <button @click="removeAttachment(index)"
                class="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                ✕
              </button>
              <img v-if="file.type.startsWith('image/')" :src="file.content"
                class="w-full h-full object-cover rounded" />
              <div v-else class="text-3xl">📄</div>
              <div class="text-xs truncate w-full text-center mt-1">{{ file.name }}</div>
            </div>
          </div>

          <textarea v-model="userInput" @keydown.enter.exact.prevent="handleSend" @paste="handlePaste"
            placeholder="Type a message..." class="w-full p-3 bg-transparent outline-none resize-none max-h-64"
            rows="3"></textarea>

          <!-- Toolbar -->
          <div class="flex justify-between items-center p-2 pl-3">
            <div class="flex items-center gap-2">
              <!-- File Input Button -->
              <button @click="triggerFileInput"
                class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                :title="isVisionSupported ? 'Attach files' : 'Model does not support vision'"
                :disabled="!isVisionSupported">
                <Icon icon="lucide:paperclip" class="w-5 h-5" />
              </button>
              <input ref="fileInput" type="file" multiple class="hidden" @change="handleFileSelect" />

              <!-- Tools Selector -->
              <ToolsSelector v-if="activeSession" :session-id="activeSession.id" />

              <!-- Model Selector -->
              <div class="relative group">
                <select :value="activeSession.modelId" @change="updateModel"
                  class="appearance-none pl-2 pr-8 py-1 rounded-lg text-xs font-medium bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-[150px] truncate"
                  title="Select Model">
                  <option v-for="model in models" :key="model.id" :value="model.id">
                    {{ model.name }}
                  </option>
                </select>
                <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-500">
                  <Icon icon="lucide:chevron-down" class="w-3 h-3" />
                </div>
              </div>
            </div>

            <!-- Send Button -->
            <button v-if="isGenerating" @click="stopGeneration"
              class="p-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors" title="Stop generating">
              <Icon icon="lucide:square" class="w-4 h-4 fill-current" />
            </button>
            <button v-else @click="handleSend" :disabled="(!userInput.trim() && selectedAttachments.length === 0)"
              class="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              <Icon icon="lucide:send" class="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Artifacts Panel (Desktop: Side, Mobile: Overlay) -->
    <div v-if="activeSession && isArtifactsOpen"
      class="fixed inset-0 z-40 md:static md:z-0 md:w-1/2 lg:w-2/5 border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 transition-all duration-300 ease-in-out shadow-xl md:shadow-none">
      <ArtifactsPanel :session="activeSession" :is-open="isArtifactsOpen" @close="isArtifactsOpen = false" />
    </div>

    <!-- Flyout -->
    <ChatSettingsFlyout :is-open="isFlyoutOpen" @close="isFlyoutOpen = false" />
  </div>
</template>
