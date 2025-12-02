<script setup lang="ts">
import { ref, nextTick, watch, computed } from 'vue';
import { useChatStore, type Message, type Project, type Attachment } from '../stores/chat';
import { useSettingsStore } from '../stores/settings';
import { storeToRefs } from 'pinia';
import draggable from 'vuedraggable';
import MessageBubble from '../components/MessageBubble.vue';
import ChatSettingsFlyout from '../components/ChatSettingsFlyout.vue';
import SidebarProject from '../components/SidebarProject.vue';
import ToolsSelector from '../components/ToolsSelector.vue';
import { sendMessage } from '../services/llm';
import { Icon } from '@iconify/vue';

const chatStore = useChatStore();
const settingsStore = useSettingsStore();
const { activeSession, activeSessionId } = storeToRefs(chatStore);
const { models, endpoints, systemPrompts } = storeToRefs(settingsStore);

const userInput = ref('');
const isFlyoutOpen = ref(false);
const isGenerating = ref(false);
const messagesContainer = ref<HTMLElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const selectedAttachments = ref<Attachment[]>([]);
const isDragging = ref(false);
const isSidebarOpen = ref(false);

const editingSessionId = ref<string | null>(null);
const editSessionTitle = ref('');
const sessionInput = ref<HTMLInputElement | null>(null);

function startEditingSession(session: any) {
  editingSessionId.value = session.id;
  editSessionTitle.value = session.title;
  nextTick(() => {
    sessionInput.value?.focus();
  });
}

function saveSessionTitle(sessionId: string) {
  if (editingSessionId.value === sessionId && editSessionTitle.value.trim()) {
    chatStore.updateSessionSettings(sessionId, { title: editSessionTitle.value.trim() });
  }
  editingSessionId.value = null;
}

function renameProject(id: string, name: string) {
  chatStore.updateProject(id, { name });
}

function renameSession(id: string, title: string) {
  chatStore.updateSessionSettings(id, { title });
}

const currentModel = computed(() => {
  if (!activeSession.value) return null;
  return models.value.find(m => m.id === activeSession.value!.modelId);
});

const isVisionSupported = computed(() => {
  return currentModel.value?.supportsVision ?? false;
});

const rootItems = computed({
  get: () => {
    const projs = chatStore.projects.map(p => ({ ...p, type: 'project' }));
    const sess = chatStore.sessions
      .filter(s => !s.projectId)
      .map(s => ({ ...s, type: 'session' }));
    
    return [...projs, ...sess].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  },
  set: (items) => {
    items.forEach((item, index) => {
      if (item.type === 'project') {
        const p = chatStore.projects.find(p => p.id === item.id);
        if (p) p.order = index;
      } else {
        const s = chatStore.sessions.find(s => s.id === item.id);
        if (s) {
          s.order = index;
          s.projectId = undefined;
        }
      }
    });
    chatStore.save();
  }
});

function createNewChat() {
  if (models.value.length === 0) {
    alert('Please add a model in Settings first.');
    return;
  }
  chatStore.createSession(models.value[0].id);
  isSidebarOpen.value = false;
}

function createProject() {
  const name = prompt("Project Name:");
  if (name) {
    chatStore.createProject(name);
  }
}

function toggleProject(project: Project) {
  chatStore.updateProject(project.id, { isExpanded: !project.isExpanded });
}

function deleteProject(id: string) {
  // event.stopPropagation(); // Handled in component
  if(confirm("Delete project? Chats will be moved to root.")) {
    chatStore.deleteProject(id);
  }
}

function selectSession(id: string) {
  activeSessionId.value = id;
  isSidebarOpen.value = false;
}

function deleteSession(id: string, event: Event) {
  event.stopPropagation();
  chatStore.deleteSession(id);
}

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
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  
  if (files.length > 0) {
    processFiles(files);
  }
}

function removeAttachment(index: number) {
  selectedAttachments.value.splice(index, 1);
}

async function generateChatTitle(sessionId: string, userContent: string, assistantContent: string) {
  const session = chatStore.sessions.find(s => s.id === sessionId);
  if (!session) return;

  const model = models.value.find(m => m.id === session.modelId);
  if (!model) return;
  
  const endpoint = endpoints.value.find(e => e.id === model.endpointId);
  if (!endpoint) return;

  const titlePrompt = `Generate a short, concise title (max 5-6 words) for a chat that starts with this exchange. Do not use quotes.
User: ${userContent.substring(0, 500)}
Assistant: ${assistantContent.substring(0, 500)}
Title:`;

  const messages: Message[] = [
    { role: 'user', content: titlePrompt, timestamp: Date.now() }
  ];

  let title = '';
  try {
    await sendMessage(endpoint, model, messages, 0.7, (payload) => {
       if (payload.content) title += payload.content;
    });
    
    if (title.trim()) {
       chatStore.updateSessionSettings(sessionId, { title: title.trim().replace(/^["']|["']$/g, '') });
    }
  } catch (e) {
    console.error('Failed to generate title', e);
  }
}

async function triggerAssistantResponse(sessionId: string, checkTitleGeneration: boolean = false, userContentForTitle: string = '') {
  const session = chatStore.sessions.find(s => s.id === sessionId);
  if (!session) return;

  const model = models.value.find(m => m.id === session.modelId);
  if (!model) {
    isGenerating.value = false;
    return;
  }
  const endpoint = endpoints.value.find(e => e.id === model.endpointId);
  if (!endpoint) {
    isGenerating.value = false;
    return;
  }

  isGenerating.value = true;
  const startTime = Date.now();
  const initialAssistantMsg: Message = {
    role: 'assistant',
    content: '',
    timestamp: startTime,
    model: model.name,
    parts: []
  };
  const assistantMsg = chatStore.addMessage(sessionId, initialAssistantMsg);

  if (!assistantMsg) {
    isGenerating.value = false;
    return;
  }

  let systemPromptContent = '';
  if (session.systemPromptId) {
    const prompt = systemPrompts.value.find(p => p.id === session.systemPromptId);
    if (prompt) systemPromptContent = prompt.content;
  }

  const apiMessages = [];
  if (systemPromptContent) {
    apiMessages.push({ role: 'system', content: systemPromptContent, timestamp: 0 } as Message);
  }
  apiMessages.push(...session.messages.slice(0, -1));

  try {
    await sendMessage(
      endpoint,
      model,
      apiMessages,
      session.temperature ?? model.temperature ?? 0.7,
      (payload) => {
        if (!assistantMsg.parts) assistantMsg.parts = [];
        const parts = assistantMsg.parts;
        const lastPart = parts[parts.length - 1];

        if (payload.reasoning) {
          if (lastPart && lastPart.type === 'reasoning') {
            lastPart.content = (lastPart.content || '') + payload.reasoning;
          } else {
            parts.push({
              id: crypto.randomUUID(),
              type: 'reasoning',
              content: payload.reasoning
            });
          }
          assistantMsg.reasoning = (assistantMsg.reasoning || '') + payload.reasoning;
        }
        if (payload.content) {
          if (lastPart && lastPart.type === 'text') {
            lastPart.content = (lastPart.content || '') + payload.content;
          } else {
            parts.push({
              id: crypto.randomUUID(),
              type: 'text',
              content: payload.content
            });
          }
          assistantMsg.content += payload.content;
        }
        if (payload.toolCalls) {
          for (const tc of payload.toolCalls) {
            parts.push({
              id: crypto.randomUUID(),
              type: 'tool-call',
              toolCall: tc
            });
          }
          assistantMsg.toolCalls = [...(assistantMsg.toolCalls || []), ...payload.toolCalls];
        }
        if (payload.toolResults) {
          for (const tr of payload.toolResults) {
            parts.push({
              id: crypto.randomUUID(),
              type: 'tool-result',
              toolResult: tr
            });
          }
          assistantMsg.toolResults = [...(assistantMsg.toolResults || []), ...payload.toolResults];
        }
        scrollToBottom();
      },
      session.enabledMcpTools
    );
  } catch (e) {
    assistantMsg.content += `\n\nError: ${e}`;
    if (assistantMsg.parts) {
      assistantMsg.parts.push({
        id: crypto.randomUUID(),
        type: 'text',
        content: `\n\nError: ${e}`
      });
    }
  } finally {
    const endTime = Date.now();
    const duration = endTime - startTime;
    assistantMsg.generationTime = duration;
    
    let totalChars = assistantMsg.content.length;
    if (assistantMsg.reasoning) {
      totalChars += assistantMsg.reasoning.length;
    }
    if (assistantMsg.toolCalls) {
      for (const toolCall of assistantMsg.toolCalls) {
        totalChars += toolCall.name.length;
        if (toolCall.arguments) {
          totalChars += JSON.stringify(toolCall.arguments).length;
        }
      }
    }

    const estimatedTokens = totalChars / 4;
    if (duration > 0) {
      assistantMsg.tokensPerSecond = estimatedTokens / (duration / 1000);
    }

    isGenerating.value = false;
    chatStore.save();

    if (checkTitleGeneration && assistantMsg.content && !assistantMsg.content.startsWith('Error:')) {
      generateChatTitle(sessionId, userContentForTitle, assistantMsg.content);
    }
  }
}

async function handleSend() {
  if ((!userInput.value.trim() && selectedAttachments.value.length === 0) || !activeSession.value || isGenerating.value) return;

  const sessionId = activeSession.value.id;
  const isFirstMessage = activeSession.value.messages.length === 0;
  const content = userInput.value;
  const attachments = [...selectedAttachments.value];
  
  userInput.value = '';
  selectedAttachments.value = [];

  // Add user message
  const userMsg: Message = {
    role: 'user',
    content,
    timestamp: Date.now(),
    attachments
  };
  chatStore.addMessage(sessionId, userMsg);

  // Scroll to bottom
  await nextTick();
  scrollToBottom();

  await triggerAssistantResponse(sessionId, isFirstMessage, content);
}

async function handleRegenerate(messageId: string) {
  if (!activeSession.value || isGenerating.value) return;
  
  const session = activeSession.value;
  const messageIndex = session.messages.findIndex(m => m.id === messageId);
  if (messageIndex === -1) return;
  
  const message = session.messages[messageIndex];
  
  if (message.role === 'user') {
    chatStore.deleteMessagesAfter(session.id, messageId, false);
    await triggerAssistantResponse(session.id);
  } else if (message.role === 'assistant') {
    chatStore.deleteMessagesAfter(session.id, messageId, true);
    if (session.messages.length > 0) {
       await triggerAssistantResponse(session.id);
    }
  }
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

function updateModel(event: Event) {
  if (!activeSession.value) return;
  const select = event.target as HTMLSelectElement;
  chatStore.updateSessionSettings(activeSession.value.id, { modelId: select.value });
}

function updateSystemPrompt(event: Event) {
  if (!activeSession.value) return;
  const select = event.target as HTMLSelectElement;
  chatStore.updateSessionSettings(activeSession.value.id, { systemPromptId: select.value || undefined });
}

watch(() => activeSession.value?.messages.length, () => {
  nextTick(scrollToBottom);
});
</script>

<template>
  <div class="flex h-full relative">
    <!-- Mobile Overlay -->
    <div 
      v-if="isSidebarOpen" 
      class="md:hidden absolute inset-0 z-20 bg-black/50"
      @click="isSidebarOpen = false"
    ></div>

    <!-- Sidebar -->
    <div 
      class="w-64 bg-gray-50 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col
             absolute md:relative z-30 h-full transition-transform duration-300 ease-in-out"
      :class="isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'"
    >
      <div class="p-4 space-y-2">
        <button 
          @click="createNewChat"
          class="w-full py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
        >
          <Icon icon="lucide:plus" class="w-5 h-5" /> New Chat
        </button>
        <button 
          @click="createProject"
          class="w-full py-2 px-4 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-white rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors flex items-center justify-center gap-2"
        >
          <Icon icon="lucide:folder-plus" class="w-5 h-5" /> New Project
        </button>
      </div>
      
      <div class="flex-1 overflow-y-auto px-2">
        <draggable
          v-model="rootItems"
          group="sidebar"
          item-key="id"
          class="min-h-full pb-4"
        >
          <template #item="{ element }">
            <div v-if="element.type === 'project'">
              <SidebarProject 
                :project="element" 
                :active-session-id="activeSessionId"
                @select-session="selectSession"
                @delete-session="deleteSession"
                @delete-project="deleteProject"
                @toggle-project="toggleProject"
                @rename-project="renameProject"
                @rename-session="renameSession"
              />
            </div>
            <div 
              v-else
              @click="selectSession(element.id)"
              class="p-3 mb-1 rounded-lg cursor-pointer group relative"
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
                class="font-medium truncate pr-6 select-none"
                title="Double click to rename"
              >
                {{ element.title }}
              </div>
              <div v-if="editingSessionId !== element.id" class="text-xs text-gray-500">{{ new Date(element.createdAt).toLocaleDateString() }}</div>
              
              <div class="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 flex gap-1">
                <button 
                  v-if="editingSessionId !== element.id"
                  @click.stop="startEditingSession(element)"
                  class="text-gray-400 hover:text-blue-500 p-1"
                  title="Rename"
                >
                  <Icon icon="lucide:pencil" class="w-3 h-3" />
                </button>
                <button 
                  v-if="editingSessionId !== element.id"
                  @click="(e) => deleteSession(element.id, e)"
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

      <div class="p-4 border-t border-gray-200 dark:border-gray-700">
        <router-link to="/settings" class="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100">
          <Icon icon="lucide:settings" class="w-5 h-5" /> Settings
        </router-link>
      </div>
    </div>

    <!-- Main Chat Area -->
    <div class="flex-1 flex flex-col h-full relative w-full">
      <!-- Header -->
      <div class="h-14 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 bg-white dark:bg-gray-900">
        <div class="flex items-center gap-3">
          <button 
            @click="isSidebarOpen = !isSidebarOpen"
            class="md:hidden p-2 -ml-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
          >
            <Icon icon="lucide:menu" class="w-5 h-5" />
          </button>
          <h2 class="font-bold truncate max-w-[150px] sm:max-w-none">{{ activeSession?.title || 'Select a chat' }}</h2>
        </div>
        
        <div v-if="activeSession" class="flex items-center gap-2">
          <!-- Model Dropdown -->
          <select 
            :value="activeSession.modelId"
            @change="updateModel"
            class="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-[120px] sm:max-w-[200px] truncate"
            title="Select Model"
          >
            <option v-for="model in models" :key="model.id" :value="model.id">
              {{ model.name }}
            </option>
          </select>

          <!-- System Prompt Dropdown -->
          <select 
            :value="activeSession.systemPromptId || ''"
            @change="updateSystemPrompt"
            class="hidden md:block text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-[200px]"
            title="Select System Prompt"
          >
            <option value="">Default System Prompt</option>
            <option v-for="prompt in systemPrompts" :key="prompt.id" :value="prompt.id">
              {{ prompt.name }}
            </option>
          </select>

          <!-- Tools Selector -->
          <ToolsSelector 
            v-if="activeSession"
            :session-id="activeSession.id"
          />

          <button 
            @click="isFlyoutOpen = !isFlyoutOpen"
            class="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg flex items-center gap-2"
            title="Chat Settings"
          >
            <Icon icon="lucide:sliders-horizontal" class="w-5 h-5" /> 
            <span class="hidden md:inline">Chat Settings</span>
          </button>
        </div>
      </div>

      <!-- Messages -->
      <div 
        ref="messagesContainer"
        class="flex-1 overflow-y-auto p-4 space-y-4"
      >
        <div v-if="!activeSession" class="h-full flex items-center justify-center text-gray-500">
          Select or create a chat to start messaging.
        </div>
        <template v-else>
          <MessageBubble 
            v-for="(msg, index) in activeSession.messages" 
            :key="index" 
            :message="msg" 
            @delete="handleDeleteMessage(msg.id!)"
            @edit="handleEditMessage(msg.id!, $event)"
            @regenerate="handleRegenerate(msg.id!)"
          />
        </template>
      </div>

      <!-- Input Area -->
      <div v-if="activeSession" class="p-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        <div 
          class="max-w-4xl mx-auto relative rounded-xl transition-colors"
          :class="{ 'bg-blue-50 dark:bg-blue-900/20 ring-2 ring-blue-500': isDragging }"
          @dragover.prevent="handleDragOver"
          @dragleave.prevent="handleDragLeave"
          @drop.prevent="handleDrop"
        >
          <!-- Attachments Preview -->
          <div v-if="selectedAttachments.length > 0" class="flex gap-2 mb-2 overflow-x-auto pb-2">
            <div 
              v-for="(file, index) in selectedAttachments" 
              :key="index"
              class="relative group shrink-0 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2 w-24 h-24 flex flex-col items-center justify-center"
            >
              <button 
                @click="removeAttachment(index)"
                class="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
              >
                ✕
              </button>
              <img 
                v-if="file.type.startsWith('image/')" 
                :src="file.content" 
                class="w-full h-full object-cover rounded"
              />
              <div v-else class="text-3xl">📄</div>
              <div class="text-xs truncate w-full text-center mt-1">{{ file.name }}</div>
            </div>
          </div>

          <div class="relative">
            <textarea 
              v-model="userInput"
              @keydown.enter.exact.prevent="handleSend"
              @paste="handlePaste"
              placeholder="Type a message..."
              class="w-full p-3 pl-10 pr-12 rounded-xl border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              rows="3"
            ></textarea>
            
            <!-- File Input Button -->
            <button 
              @click="triggerFileInput"
              class="absolute left-3 bottom-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
              :title="isVisionSupported ? 'Attach files' : 'Model does not support vision'"
              :disabled="!isVisionSupported"
            >
              📎
            </button>
            <input 
              ref="fileInput"
              type="file"
              multiple
              class="hidden"
              @change="handleFileSelect"
            />

            <button 
              @click="handleSend"
              :disabled="(!userInput.trim() && selectedAttachments.length === 0) || isGenerating"
              class="absolute right-3 bottom-3 p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ➤
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Flyout -->
    <ChatSettingsFlyout 
      :is-open="isFlyoutOpen" 
      @close="isFlyoutOpen = false" 
    />
  </div>
</template>
