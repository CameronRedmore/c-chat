<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue';
import { useSettingsStore, type Endpoint, type Model, type SystemPrompt, type McpServer } from '../stores/settings';
import { storeToRefs } from 'pinia';
import { Icon } from '@iconify/vue';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import QRCode from 'qrcode';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { fetch } from '@tauri-apps/plugin-http';

const settingsStore = useSettingsStore();
const { endpoints, models, systemPrompts, mcpServers } = storeToRefs(settingsStore);

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

// Model Form
const newModel = ref<Model>({ id: '', name: '', endpointId: '', contextSize: 4096, temperature: 0.7 });
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
  
  newModel.value = { id: '', name: '', endpointId: '', contextSize: 4096, temperature: 0.7 };
  editingModelId.value = null;
}

function editModel(m: Model) {
  newModel.value = { ...m };
  editingModelId.value = m.id;
}

function cancelEditModel() {
  newModel.value = { id: '', name: '', endpointId: '', contextSize: 4096, temperature: 0.7 };
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
const syncUrl = ref('');
const syncQrCode = ref('');
const isServerRunning = ref(false);
const joinUrl = ref('');
const joinStatus = ref('');
const isScanning = ref(false);
let scanner: Html5QrcodeScanner | null = null;

function startScanning() {
  isScanning.value = true;
  // Wait for DOM to update
  nextTick(() => {
    scanner = new Html5QrcodeScanner(
      "reader",
      { fps: 10, qrbox: { width: 250, height: 250 } },
      /* verbose= */ false
    );
    scanner.render(onScanSuccess, onScanFailure);
  });
}

function onScanSuccess(decodedText: string, decodedResult: any) {
  // Handle the scanned code as you like, for example:
  console.log(`Code matched = ${decodedText}`, decodedResult);
  joinUrl.value = decodedText;
  stopScanning();
}

function onScanFailure(_error: any) {
  // handle scan failure, usually better to ignore and keep scanning.
  // for example:
  // console.warn(`Code scan error = ${error}`);
}

function stopScanning() {
  if (scanner) {
    scanner.clear().catch(error => {
      console.error("Failed to clear html5-qrcode scanner. ", error);
    });
    scanner = null;
  }
  isScanning.value = false;
}

async function startSyncServer() {
  try {
    const settings = {
      endpoints: endpoints.value,
      models: models.value,
      systemPrompts: systemPrompts.value,
      mcpServers: mcpServers.value
    };
    
    const url = await invoke<string>('start_sync_server', { settings: JSON.stringify(settings) });
    syncUrl.value = url;
    syncQrCode.value = await QRCode.toDataURL(url);
    isServerRunning.value = true;
  } catch (e) {
    console.error(e);
    alert('Failed to start sync server: ' + e);
  }
}

async function stopSyncServer() {
  try {
    await invoke('stop_sync_server');
    isServerRunning.value = false;
    syncUrl.value = '';
    syncQrCode.value = '';
  } catch (e) {
    console.error(e);
  }
}

async function joinSync() {
  if (!joinUrl.value) return;
  joinStatus.value = 'Connecting...';
  try {
    const res = await fetch(joinUrl.value);
    if (!res.ok) throw new Error('Failed to fetch settings');
    const settings = await res.json();
    
    // Apply settings
    if (settings.endpoints) endpoints.value = settings.endpoints;
    if (settings.models) models.value = settings.models;
    if (settings.systemPrompts) systemPrompts.value = settings.systemPrompts;
    if (settings.mcpServers) mcpServers.value = settings.mcpServers;
    
    await settingsStore.save();
    joinStatus.value = 'Settings synced successfully!';
    setTimeout(() => joinStatus.value = '', 3000);
  } catch (e: any) {
    console.error(e);
    joinStatus.value = 'Error: ' + e.message;
  }
}

listen('sync-settings-received', (event: any) => {
    const settings = event.payload;
    if (settings.endpoints) endpoints.value = settings.endpoints;
    if (settings.models) models.value = settings.models;
    if (settings.systemPrompts) systemPrompts.value = settings.systemPrompts;
    if (settings.mcpServers) mcpServers.value = settings.mcpServers;
    settingsStore.save();
    alert('Settings updated from remote device!');
});

onUnmounted(() => {
    if (isServerRunning.value) {
        stopSyncServer();
    }
    if (scanner) {
        stopScanning();
    }
    window.removeEventListener('resize', updateMobileState);
});
</script>

<template>
  <div class="flex h-full bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 overflow-hidden">
    <!-- Sidebar -->
    <div 
      v-show="!isMobile || showMobileMenu"
      class="w-full md:w-64 bg-gray-50 dark:bg-gray-800 p-4 border-r border-gray-200 dark:border-gray-700 flex flex-col h-full"
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
          <span>Sync Devices</span>
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
          <div v-for="endpoint in endpoints" :key="endpoint.id" class="flex items-center justify-between p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
            <div>
              <div class="font-bold">{{ endpoint.name }}</div>
              <div class="text-sm text-gray-500">{{ endpoint.url }}</div>
            </div>
            <div class="flex gap-2">
              <button @click="editEndpoint(endpoint)" class="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-gray-700 rounded">Edit</button>
              <button @click="deleteEndpoint(endpoint.id)" class="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-gray-700 rounded font-medium">Delete</button>
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
          <div v-for="model in models" :key="model.id" class="flex items-center justify-between p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
            <div>
              <div class="font-bold">{{ model.name }}</div>
              <div class="text-sm text-gray-500">{{ model.id }} • {{ endpoints.find(e => e.id === model.endpointId)?.name || 'Unknown Endpoint' }}</div>
            </div>
            <div class="flex gap-2">
              <button @click="editModel(model)" class="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-gray-700 rounded">Edit</button>
              <button @click="deleteModel(model.id)" class="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-gray-700 rounded font-medium">Delete</button>
            </div>
          </div>
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
        <h3 class="text-2xl font-bold mb-6">Sync Devices</h3>
        
        <div class="grid gap-8">
          <!-- Host -->
          <div class="bg-gray-100 dark:bg-gray-800 p-6 rounded-xl">
            <h4 class="font-semibold mb-4 text-lg">Export Settings</h4>
            <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Start a temporary server to share your settings with another device on the same network.
            </p>
            
            <div v-if="!isServerRunning">
              <button @click="startSyncServer" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
                Start Sync Server
              </button>
            </div>
            
            <div v-else class="space-y-4">
              <div class="p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
                <div class="text-sm font-medium mb-2 text-center">Scan this QR code on the other device</div>
                <div class="flex justify-center bg-white p-4 rounded">
                  <img :src="syncQrCode" alt="Sync QR Code" class="w-48 h-48" />
                </div>
                <div class="mt-4 text-center">
                  <div class="text-xs text-gray-500 uppercase tracking-wide mb-1">Or enter this URL</div>
                  <code class="bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded select-all">{{ syncUrl }}</code>
                </div>
              </div>
              
              <button @click="stopSyncServer" class="w-full px-4 py-2 border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-900/20 rounded">
                Stop Server
              </button>
            </div>
          </div>

          <!-- Join -->
          <div class="bg-gray-100 dark:bg-gray-800 p-6 rounded-xl">
            <h4 class="font-semibold mb-4 text-lg">Import Settings</h4>
            <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Enter the URL from the other device to import its settings.
            </p>
            
            <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium mb-1">Sync URL</label>
                <div class="flex gap-2">
                  <input v-model="joinUrl" type="text" class="flex-1 px-3 py-2 rounded border dark:bg-gray-700 dark:border-gray-600" placeholder="http://192.168.1.x:port/settings" />
                  <button @click="startScanning" class="px-3 py-2 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600" title="Scan QR Code">
                    <Icon icon="lucide:qr-code" class="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div v-if="isScanning" class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
                <div class="bg-white dark:bg-gray-800 p-4 rounded-xl w-full max-w-md relative">
                  <button @click="stopScanning" class="absolute top-2 right-2 p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                    <Icon icon="lucide:x" class="w-6 h-6" />
                  </button>
                  <h4 class="text-lg font-bold mb-4 text-center">Scan QR Code</h4>
                  <div id="reader" class="w-full overflow-hidden rounded-lg"></div>
                </div>
              </div>
              
              <div class="flex items-center justify-between">
                <div class="text-sm" :class="{'text-green-600': joinStatus.includes('success'), 'text-red-600': joinStatus.includes('Error')}">
                  {{ joinStatus }}
                </div>
                <button @click="joinSync" :disabled="!joinUrl" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
                  Import Settings
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>
