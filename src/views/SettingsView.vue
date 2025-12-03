<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue';
import { useSettingsStore, type Endpoint, type Model, type SystemPrompt, type McpServer } from '../stores/settings';
import { syncService } from '../services/sync';
import { storeToRefs } from 'pinia';
import { Icon } from '@iconify/vue';
import draggable from 'vuedraggable';

const settingsStore = useSettingsStore();
const { endpoints, models, systemPrompts, mcpServers, syncToken, lastSyncTime } = storeToRefs(settingsStore);

const activeTab = ref<'endpoints' | 'models' | 'prompts' | 'mcp' | 'sync'>('endpoints');
const isMobile = ref(false);
const showMobileMenu = ref(true);

const updateMobileState = () => {
  isMobile.value = window.innerWidth < 768;
  if (!isMobile.value) {
    showMobileMenu.value = false; // Not used on desktop, but reset for consistency
  } else {
    // On mobile, default to menu if we just switched
    // showMobileMenu.value = true; 
  }
};

onMounted(() => {
  updateMobileState();
  window.addEventListener('resize', updateMobileState);
});

onUnmounted(() => {
  window.removeEventListener('resize', updateMobileState);
});

function selectTab(tab: typeof activeTab.value) {
  activeTab.value = tab;
  if (isMobile.value) {
    showMobileMenu.value = false;
  }
}


// Endpoint Form
const newEndpoint = ref<Endpoint>({ id: '', name: '', url: '', apiKey: '' });
function saveEndpoint() {
  if (!newEndpoint.value.name || !newEndpoint.value.url) return;
  
  if (newEndpoint.value.id) {
    settingsStore.updateEndpoint(newEndpoint.value.id, { ...newEndpoint.value });
  } else {
    const id = crypto.randomUUID();
    settingsStore.addEndpoint({ ...newEndpoint.value, id });
  }
  newEndpoint.value = { id: '', name: '', url: '', apiKey: '' };
}
function editEndpoint(e: Endpoint) {
  newEndpoint.value = { ...e };
}
function deleteEndpoint(id: string) {
  settingsStore.removeEndpoint(id);
}

// Fetch Models
const showFetchModal = ref(false);
const fetchingEndpoint = ref<Endpoint | null>(null);
const isFetchingModels = ref(false);
const fetchedModels = ref<any[]>([]);
const selectedModels = ref<Set<string>>(new Set());
const importContextSize = ref(4096);
const importTemperature = ref(0.7);

async function openFetchModal(endpoint: Endpoint) {
  fetchingEndpoint.value = endpoint;
  showFetchModal.value = true;
  fetchedModels.value = [];
  selectedModels.value = new Set();
  isFetchingModels.value = true;
  
  try {
    let url = endpoint.url.replace(/\/+$/, '');
    if (!url.endsWith('/v1')) {
        url += '/v1';
    }
    url += '/models';

    const headers: Record<string, string> = {};
    if (endpoint.apiKey) {
      headers['Authorization'] = `Bearer ${endpoint.apiKey}`;
    }

    let res = await fetch(url, {
      method: 'GET',
      headers
    });

    if (!res.ok) {
         const altUrl = endpoint.url.replace(/\/+$/, '') + '/models';
         res = await fetch(altUrl, { method: 'GET', headers });
    }
    
    if (!res.ok) throw new Error(`Failed to fetch models: ${res.statusText}`);
    
    const data = await res.json();
    fetchedModels.value = data.data || [];
  } catch (e: any) {
    console.error(e);
    alert('Error fetching models: ' + e.message);
    showFetchModal.value = false;
  } finally {
    isFetchingModels.value = false;
  }
}

function toggleModelSelection(modelId: string) {
  if (selectedModels.value.has(modelId)) {
    selectedModels.value.delete(modelId);
  } else {
    selectedModels.value.add(modelId);
  }
}

function importSelectedModels() {
  if (!fetchingEndpoint.value) return;
  
  const modelsToImport = fetchedModels.value.filter(m => selectedModels.value.has(m.id));
  
  for (const m of modelsToImport) {
    const existing = models.value.find(existing => existing.id === m.id && existing.endpointId === fetchingEndpoint.value?.id);
    if (existing) continue;

    settingsStore.addModel({
      id: m.id,
      name: m.id,
      endpointId: fetchingEndpoint.value.id,
      contextSize: importContextSize.value,
      temperature: importTemperature.value,
      supportsVision: m.id.includes('vision'),
      supportsFunctionCalling: false
    });
  }
  
  showFetchModal.value = false;
  fetchedModels.value = [];
  selectedModels.value = new Set();
}

// Model Form
const newModel = ref<Model>({ id: '', name: '', endpointId: '', contextSize: 4096, temperature: 0.7, topP: 1, topK: 0, minP: 0 });
const editingModelId = ref<string | null>(null);

function saveModel() {
  if (!newModel.value.name || !newModel.value.endpointId) return;
  
  if (editingModelId.value) {
    // Update existing
    settingsStore.updateModel(editingModelId.value, { ...newModel.value });
  } else {
    // Add new
    settingsStore.addModel({ ...newModel.value });
  }
  
  newModel.value = { id: '', name: '', endpointId: '', contextSize: 4096, temperature: 0.7, topP: 1, topK: 0, minP: 0 };
  editingModelId.value = null;
}

function editModel(m: Model) {
  newModel.value = { ...m };
  editingModelId.value = m.id;
}

function cancelEditModel() {
  newModel.value = { id: '', name: '', endpointId: '', contextSize: 4096, temperature: 0.7, topP: 1, topK: 0, minP: 0 };
  editingModelId.value = null;
}

function deleteModel(id: string) {
  settingsStore.removeModel(id);
  if (editingModelId.value === id) {
    cancelEditModel();
  }
}

// Prompt Form
const newPrompt = ref<SystemPrompt>({ id: '', name: '', content: '' });
function savePrompt() {
  if (!newPrompt.value.name || !newPrompt.value.content) return;
  
  if (newPrompt.value.id) {
    settingsStore.updateSystemPrompt(newPrompt.value.id, { ...newPrompt.value });
  } else {
    const id = crypto.randomUUID();
    settingsStore.addSystemPrompt({ ...newPrompt.value, id });
  }
  newPrompt.value = { id: '', name: '', content: '' };
}
function editPrompt(p: SystemPrompt) {
  newPrompt.value = { ...p };
}
function deletePrompt(id: string) {
  settingsStore.removeSystemPrompt(id);
}

// MCP Server Form
const newMcpServer = ref<McpServer>({ id: '', name: '', url: '', transport: 'http', enabled: true });
function saveMcpServer() {
  if (!newMcpServer.value.name || !newMcpServer.value.url) return;
  
  if (newMcpServer.value.id) {
    settingsStore.updateMcpServer(newMcpServer.value.id, { ...newMcpServer.value });
  } else {
    const id = crypto.randomUUID();
    settingsStore.addMcpServer({ ...newMcpServer.value, id });
  }
  newMcpServer.value = { id: '', name: '', url: '', transport: 'http', enabled: true };
}
function editMcpServer(s: McpServer) {
  newMcpServer.value = { ...s, transport: s.transport || 'sse' };
}
function deleteMcpServer(id: string) {
  settingsStore.removeMcpServer(id);
}
function toggleMcpServer(server: McpServer) {
  settingsStore.updateMcpServer(server.id, { enabled: !server.enabled });
}

// Sync
const isSyncing = ref(false);
async function triggerManualSync() {
  isSyncing.value = true;
  await syncService.sync();
  isSyncing.value = false;
}

function saveSyncToken() {
  if (syncToken.value) {
    syncService.startAutoSync();
  } else {
    syncService.stopAutoSync();
  }
  settingsStore.save();
}
</script>

<template>
  <div class="flex h-full bg-transparent text-gray-900 dark:text-gray-100 overflow-hidden">
    <!-- Sidebar -->
    <div 
      v-show="!isMobile || showMobileMenu"
      class="w-full md:w-64 bg-transparent p-4 border-r border-gray-200 dark:border-gray-700 flex flex-col h-full"
    >
      <h2 class="text-xl font-bold mb-6">Settings</h2>
      <nav class="space-y-2 flex-1 overflow-y-auto">
        <button 
          @click="selectTab('endpoints')"
          :class="['w-full text-left px-4 py-3 md:py-2 rounded-lg transition-colors flex items-center justify-between', activeTab === 'endpoints' ? 'bg-blue-600 text-white' : 'hover:bg-gray-200 dark:hover:bg-gray-700']"
        >
          <span>Endpoints</span>
          <Icon v-if="isMobile" icon="lucide:chevron-right" class="w-4 h-4 opacity-50" />
        </button>
        <button 
          @click="selectTab('models')"
          :class="['w-full text-left px-4 py-3 md:py-2 rounded-lg transition-colors flex items-center justify-between', activeTab === 'models' ? 'bg-blue-600 text-white' : 'hover:bg-gray-200 dark:hover:bg-gray-700']"
        >
          <span>Models</span>
          <Icon v-if="isMobile" icon="lucide:chevron-right" class="w-4 h-4 opacity-50" />
        </button>
        <button 
          @click="selectTab('prompts')"
          :class="['w-full text-left px-4 py-3 md:py-2 rounded-lg transition-colors flex items-center justify-between', activeTab === 'prompts' ? 'bg-blue-600 text-white' : 'hover:bg-gray-200 dark:hover:bg-gray-700']"
        >
          <span>System Prompts</span>
          <Icon v-if="isMobile" icon="lucide:chevron-right" class="w-4 h-4 opacity-50" />
        </button>
        <button 
          @click="selectTab('mcp')"
          :class="['w-full text-left px-4 py-3 md:py-2 rounded-lg transition-colors flex items-center justify-between', activeTab === 'mcp' ? 'bg-blue-600 text-white' : 'hover:bg-gray-200 dark:hover:bg-gray-700']"
        >
          <span>MCP Servers</span>
          <Icon v-if="isMobile" icon="lucide:chevron-right" class="w-4 h-4 opacity-50" />
        </button>
        <button 
          @click="selectTab('sync')"
          :class="['w-full text-left px-4 py-3 md:py-2 rounded-lg transition-colors flex items-center justify-between', activeTab === 'sync' ? 'bg-blue-600 text-white' : 'hover:bg-gray-200 dark:hover:bg-gray-700']"
        >
          <span>Sync</span>
          <Icon v-if="isMobile" icon="lucide:chevron-right" class="w-4 h-4 opacity-50" />
        </button>
      </nav>
      <router-link to="/" class="mt-4 px-4 py-3 md:py-2 text-center border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 font-medium">
        Back to Chat
      </router-link>
    </div>

    <!-- Content -->
    <div 
      v-show="!isMobile || !showMobileMenu"
      class="flex-1 p-4 md:p-8 overflow-y-auto h-full w-full"
    >
      <div v-if="isMobile" class="mb-4">
        <button 
          @click="showMobileMenu = true"
          class="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
        >
          <Icon icon="lucide:arrow-left" class="w-5 h-5" />
          Back to Settings
        </button>
      </div>
      
      <!-- Endpoints -->
      <div v-if="activeTab === 'endpoints'" class="max-w-2xl mx-auto">
        <h3 class="text-2xl font-bold mb-6">API Endpoints</h3>
        
        <div class="bg-gray-100 dark:bg-gray-800 p-6 rounded-xl mb-8">
          <h4 class="font-semibold mb-4">{{ newEndpoint.id ? 'Edit' : 'Add' }} Endpoint</h4>
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium mb-1">Name</label>
              <input v-model="newEndpoint.name" type="text" class="w-full px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600" placeholder="e.g. OpenAI" />
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">Base URL</label>
              <input v-model="newEndpoint.url" type="text" class="w-full px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600" placeholder="https://api.openai.com/v1" />
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">API Key</label>
              <input v-model="newEndpoint.apiKey" type="password" class="w-full px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600" placeholder="sk-..." />
            </div>
            <div class="flex justify-end gap-2">
              <button v-if="newEndpoint.id" @click="newEndpoint = { id: '', name: '', url: '', apiKey: '' }" class="px-4 py-2 text-gray-600 hover:text-gray-800">Cancel</button>
              <button @click="saveEndpoint" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Save</button>
            </div>
          </div>
        </div>

        <div class="space-y-4">
          <draggable 
            v-model="endpoints" 
            item-key="id" 
            handle=".drag-handle"
            @end="settingsStore.reorderEndpoints(endpoints)"
            class="space-y-4"
            :force-fallback="true"
            :fallback-tolerance="3"
          >
            <template #item="{ element: endpoint }">
              <div class="flex items-center justify-between p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
                <div class="flex items-center gap-3 flex-1">
                  <div class="drag-handle cursor-move text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                    <Icon icon="lucide:grip-vertical" class="w-5 h-5" />
                  </div>
                  <div>
                    <div class="font-bold">{{ endpoint.name }}</div>
                    <div class="text-sm text-gray-500">{{ endpoint.url }}</div>
                  </div>
                </div>
                <div class="flex gap-2">
                  <button @click="openFetchModal(endpoint)" class="p-2 text-green-600 hover:bg-green-50 dark:hover:bg-gray-700 rounded" title="Fetch Models">
                    <Icon icon="lucide:download" class="w-5 h-5" />
                  </button>
                  <button @click="editEndpoint(endpoint)" class="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-gray-700 rounded">Edit</button>
                  <button @click="deleteEndpoint(endpoint.id)" class="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-gray-700 rounded font-medium">Delete</button>
                </div>
              </div>
            </template>
          </draggable>
        </div>

        <!-- Fetch Models Modal -->
        <div v-if="showFetchModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div class="bg-white dark:bg-gray-800 rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-xl">
            <div class="p-6 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
              <h3 class="text-xl font-bold">Fetch Models from {{ fetchingEndpoint?.name }}</h3>
              <button @click="showFetchModal = false" class="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                <Icon icon="lucide:x" class="w-6 h-6" />
              </button>
            </div>
            
            <div class="p-6 overflow-y-auto flex-1">
              <div v-if="isFetchingModels" class="flex justify-center py-8">
                <Icon icon="lucide:loader-2" class="w-8 h-8 animate-spin text-blue-600" />
              </div>
              
              <div v-else-if="fetchedModels.length === 0" class="text-center py-8 text-gray-500">
                No models found or failed to fetch.
              </div>
              
              <div v-else class="space-y-4">
                <div class="flex items-center justify-between mb-4">
                  <div class="text-sm text-gray-500">{{ fetchedModels.length }} models found</div>
                  <div class="flex gap-4">
                    <div class="flex items-center gap-2">
                      <label class="text-sm">Context:</label>
                      <input v-model.number="importContextSize" type="number" class="w-24 px-2 py-1 rounded border dark:bg-gray-700 dark:border-gray-600 text-sm" />
                    </div>
                    <div class="flex items-center gap-2">
                      <label class="text-sm">Temp:</label>
                      <input v-model.number="importTemperature" type="number" step="0.1" class="w-16 px-2 py-1 rounded border dark:bg-gray-700 dark:border-gray-600 text-sm" />
                    </div>
                  </div>
                </div>
                
                <div class="border dark:border-gray-700 rounded-lg divide-y dark:divide-gray-700">
                  <div 
                    v-for="model in fetchedModels" 
                    :key="model.id"
                    class="p-3 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors"
                    @click="toggleModelSelection(model.id)"
                  >
                    <input 
                      type="checkbox" 
                      :checked="selectedModels.has(model.id)"
                      class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div class="flex-1">
                      <div class="font-medium">{{ model.id }}</div>
                      <div class="text-xs text-gray-500">Owned by: {{ model.owned_by }}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            <div class="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
              <button @click="showFetchModal = false" class="px-4 py-2 text-gray-600 hover:text-gray-800">Cancel</button>
              <button 
                @click="importSelectedModels" 
                :disabled="selectedModels.size === 0"
                class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Import {{ selectedModels.size }} Models
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Models -->
      <div v-if="activeTab === 'models'" class="max-w-2xl mx-auto">
        <h3 class="text-2xl font-bold mb-6">Models</h3>
        
        <div class="bg-gray-100 dark:bg-gray-800 p-6 rounded-xl mb-8">
          <h4 class="font-semibold mb-4">{{ editingModelId ? 'Edit' : 'Add' }} Model</h4>
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium mb-1">Display Name</label>
              <input v-model="newModel.name" type="text" class="w-full px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600" placeholder="e.g. GPT-4 Turbo" />
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">Model ID (API)</label>
              <input v-model="newModel.id" type="text" class="w-full px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600" placeholder="e.g. gpt-4-turbo-preview" />
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">Endpoint</label>
              <select v-model="newModel.endpointId" class="w-full px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600">
                <option value="" disabled>Select an endpoint</option>
                <option v-for="ep in endpoints" :key="ep.id" :value="ep.id">{{ ep.name }}</option>
              </select>
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium mb-1">Context Size</label>
                <input v-model.number="newModel.contextSize" type="number" class="w-full px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600" />
              </div>
              <div>
                <label class="block text-sm font-medium mb-1">Default Temp</label>
                <input v-model.number="newModel.temperature" type="number" step="0.1" min="0" max="2" class="w-full px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600" />
              </div>
              <div>
                <label class="block text-sm font-medium mb-1">Top P</label>
                <input v-model.number="newModel.topP" type="number" step="0.01" min="0" max="1" class="w-full px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600" />
              </div>
              <div>
                <label class="block text-sm font-medium mb-1">Top K</label>
                <input v-model.number="newModel.topK" type="number" step="1" min="0" class="w-full px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600" />
              </div>
              <div>
                <label class="block text-sm font-medium mb-1">Min P</label>
                <input v-model.number="newModel.minP" type="number" step="0.01" min="0" max="1" class="w-full px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600" />
              </div>
            </div>
            <div class="flex gap-4">
              <label class="flex items-center gap-2">
                <input v-model="newModel.supportsVision" type="checkbox" class="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                <span class="text-sm font-medium">Supports Vision</span>
              </label>
              <label class="flex items-center gap-2">
                <input v-model="newModel.supportsFunctionCalling" type="checkbox" class="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                <span class="text-sm font-medium">Supports Tools</span>
              </label>
            </div>
            <div class="flex justify-end gap-2">
              <button v-if="editingModelId" @click="cancelEditModel" class="px-4 py-2 text-gray-600 hover:text-gray-800">Cancel</button>
              <button @click="saveModel" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Save</button>
            </div>
          </div>
        </div>

        <div class="space-y-4">
          <draggable 
            v-model="models" 
            item-key="id" 
            handle=".drag-handle"
            @end="settingsStore.reorderModels(models)"
            class="space-y-4"
            :force-fallback="true"
            :fallback-tolerance="3"
          >
            <template #item="{ element: model }">
              <div class="flex items-center justify-between p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
                <div class="flex items-center gap-3 flex-1">
                  <div class="drag-handle cursor-move text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                    <Icon icon="lucide:grip-vertical" class="w-5 h-5" />
                  </div>
                  <div>
                    <div class="font-bold">{{ model.name }}</div>
                    <div class="text-sm text-gray-500">{{ model.id }} • {{ endpoints.find(e => e.id === model.endpointId)?.name || 'Unknown Endpoint' }}</div>
                  </div>
                </div>
                <div class="flex gap-2">
                  <button @click="editModel(model)" class="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-gray-700 rounded">Edit</button>
                  <button @click="deleteModel(model.id)" class="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-gray-700 rounded font-medium">Delete</button>
                </div>
              </div>
            </template>
          </draggable>
        </div>
      </div>

      <!-- System Prompts -->
      <div v-if="activeTab === 'prompts'" class="max-w-2xl mx-auto">
        <h3 class="text-2xl font-bold mb-6">System Prompts</h3>
        
        <div class="bg-gray-100 dark:bg-gray-800 p-6 rounded-xl mb-8">
          <h4 class="font-semibold mb-4">{{ newPrompt.id ? 'Edit' : 'Add' }} Prompt</h4>
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium mb-1">Name</label>
              <input v-model="newPrompt.name" type="text" class="w-full px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600" placeholder="e.g. Coding Assistant" />
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">Content</label>
              <textarea v-model="newPrompt.content" rows="4" class="w-full px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600" placeholder="You are a helpful assistant..."></textarea>
            </div>
            <div class="flex justify-end gap-2">
              <button v-if="newPrompt.id" @click="newPrompt = { id: '', name: '', content: '' }" class="px-4 py-2 text-gray-600 hover:text-gray-800">Cancel</button>
              <button @click="savePrompt" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Save</button>
            </div>
          </div>
        </div>

        <div class="space-y-4">
          <div v-for="prompt in systemPrompts" :key="prompt.id" class="flex items-center justify-between p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
            <div>
              <div class="font-bold">{{ prompt.name }}</div>
              <div class="text-sm text-gray-500 truncate max-w-md">{{ prompt.content }}</div>
            </div>
            <div class="flex gap-2">
              <button @click="editPrompt(prompt)" class="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-gray-700 rounded">Edit</button>
              <button @click="deletePrompt(prompt.id)" class="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-gray-700 rounded font-medium">Delete</button>
            </div>
          </div>
        </div>
      </div>

      <!-- MCP Servers -->
      <div v-if="activeTab === 'mcp'" class="max-w-2xl mx-auto">
        <h3 class="text-2xl font-bold mb-6">MCP Servers</h3>
        
        <div class="bg-gray-100 dark:bg-gray-800 p-6 rounded-xl mb-8">
          <h4 class="font-semibold mb-4">{{ newMcpServer.id ? 'Edit' : 'Add' }} Server</h4>
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium mb-1">Name</label>
              <input v-model="newMcpServer.name" type="text" class="w-full px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600" placeholder="e.g. Local Files" />
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">Transport</label>
              <select v-model="newMcpServer.transport" class="w-full px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600">
                <option value="http">HTTP Streamable</option>
                <option value="sse">SSE</option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">URL</label>
              <input v-model="newMcpServer.url" type="text" class="w-full px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600" placeholder="http://localhost:3000/mcp" />
            </div>
            <div class="flex justify-end gap-2">
              <button v-if="newMcpServer.id" @click="newMcpServer = { id: '', name: '', url: '', transport: 'http', enabled: true }" class="px-4 py-2 text-gray-600 hover:text-gray-800">Cancel</button>
              <button @click="saveMcpServer" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Save</button>
            </div>
          </div>
        </div>

        <div class="space-y-4">
          <div v-for="server in mcpServers" :key="server.id" class="flex items-center justify-between p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
            <div class="flex items-center gap-3">
              <input 
                type="checkbox" 
                :checked="server.enabled" 
                @change="toggleMcpServer(server)"
                class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <div class="font-bold">{{ server.name }}</div>
                <div class="text-sm text-gray-500">{{ server.url }}</div>
              </div>
            </div>
            <div class="flex gap-2">
              <button @click="editMcpServer(server)" class="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-gray-700 rounded">Edit</button>
              <button @click="deleteMcpServer(server.id)" class="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-gray-700 rounded font-medium">Delete</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Sync -->
      <div v-if="activeTab === 'sync'" class="max-w-2xl mx-auto">
        <h3 class="text-2xl font-bold mb-6">Synchronization</h3>
        
        <div class="bg-gray-100 dark:bg-gray-800 p-6 rounded-xl mb-8">
          <h4 class="font-semibold mb-4">Sync Settings</h4>
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium mb-1">Sync Token</label>
              <div class="flex gap-2">
                <input 
                  v-model="syncToken" 
                  @change="saveSyncToken"
                  type="password" 
                  class="flex-1 px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600" 
                  placeholder="Enter your sync token" 
                />
              </div>
              <p class="text-xs text-gray-500 mt-1">
                Enter your token to enable automatic synchronization across devices.
              </p>
            </div>
            
            <div class="pt-4 border-t border-gray-200 dark:border-gray-700">
              <div class="flex items-center justify-between">
                <div>
                  <div class="font-medium">Status</div>
                  <div class="text-sm text-gray-500">
                    Last synced: {{ lastSyncTime ? new Date(lastSyncTime).toLocaleString() : 'Never' }}
                  </div>
                </div>
                <button 
                  @click="triggerManualSync" 
                  :disabled="isSyncing || !syncToken"
                  class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <Icon v-if="isSyncing" icon="lucide:loader-2" class="w-4 h-4 animate-spin" />
                  {{ isSyncing ? 'Syncing...' : 'Sync Now' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>
