import { defineStore } from 'pinia';
import { ref } from 'vue';
import { Store } from '@tauri-apps/plugin-store';

export interface Endpoint {
  id: string;
  name: string;
  url: string;
  apiKey?: string;
}

export interface Model {
  id: string;
  name: string;
  endpointId: string;
  contextSize?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  minP?: number;
  supportsVision?: boolean;
  supportsFunctionCalling?: boolean;
}

export interface SystemPrompt {
  id: string;
  name: string;
  content: string;
}

export interface McpServer {
  id: string;
  name: string;
  url: string;
  transport: 'sse' | 'http';
  enabled: boolean;
}

export interface SettingsState {
  endpoints: Endpoint[];
  models: Model[];
  systemPrompts: SystemPrompt[];
  mcpServers: McpServer[];
  syncToken?: string;
  lastSyncTime?: number;
  updatedAt: number;
}

export const useSettingsStore = defineStore('settings', () => {
  // State
  const endpoints = ref<Endpoint[]>([]);
  const models = ref<Model[]>([]);
  const systemPrompts = ref<SystemPrompt[]>([]);
  const mcpServers = ref<McpServer[]>([]);
  const syncToken = ref<string>('');
  const lastSyncTime = ref<number>(0);
  const updatedAt = ref<number>(Date.now());
  let store: Store | null = null;

  async function getStore() {
    if (!store) {
      store = await Store.load('settings.json');
    }
    return store;
  }

  async function load() {
    const s = await getStore();
    const savedEndpoints = await s.get<Endpoint[]>('endpoints');
    if (savedEndpoints) endpoints.value = savedEndpoints;

    const savedModels = await s.get<Model[]>('models');
    if (savedModels) models.value = savedModels;

    const savedPrompts = await s.get<SystemPrompt[]>('systemPrompts');
    if (savedPrompts) systemPrompts.value = savedPrompts;

    const savedMcpServers = await s.get<McpServer[]>('mcpServers');
    if (savedMcpServers) mcpServers.value = savedMcpServers;

    const savedSyncToken = await s.get<string>('syncToken');
    if (savedSyncToken) syncToken.value = savedSyncToken;

    const savedLastSyncTime = await s.get<number>('lastSyncTime');
    if (savedLastSyncTime) lastSyncTime.value = savedLastSyncTime;

    const savedUpdatedAt = await s.get<number>('updatedAt');
    if (savedUpdatedAt) updatedAt.value = savedUpdatedAt;
  }

  async function save() {
    const s = await getStore();
    await s.set('endpoints', endpoints.value);
    await s.set('models', models.value);
    await s.set('systemPrompts', systemPrompts.value);
    await s.set('mcpServers', mcpServers.value);
    await s.set('syncToken', syncToken.value);
    await s.set('lastSyncTime', lastSyncTime.value);
    await s.set('updatedAt', updatedAt.value);
    await s.save();
  }

  function addEndpoint(endpoint: Endpoint) {
    endpoints.value.push(endpoint);
    updatedAt.value = Date.now();
    save();
  }

  function removeEndpoint(id: string) {
    endpoints.value = endpoints.value.filter(e => e.id !== id);
    models.value = models.value.filter(m => m.endpointId !== id); // Cascade delete models
    updatedAt.value = Date.now();
    save();
  }

  function updateEndpoint(id: string, updates: Partial<Endpoint>) {
    const endpoint = endpoints.value.find(e => e.id === id);
    if (endpoint) {
      Object.assign(endpoint, updates);
      updatedAt.value = Date.now();
      save();
    }
  }

  function addModel(model: Model) {
    models.value.push(model);
    updatedAt.value = Date.now();
    save();
  }

  function removeModel(id: string) {
    models.value = models.value.filter(m => m.id !== id);
    updatedAt.value = Date.now();
    save();
  }

  function updateModel(id: string, updates: Partial<Model>) {
    const model = models.value.find(m => m.id === id);
    if (model) {
      Object.assign(model, updates);
      updatedAt.value = Date.now();
      save();
    }
  }

  function addSystemPrompt(prompt: SystemPrompt) {
    systemPrompts.value.push(prompt);
    updatedAt.value = Date.now();
    save();
  }

  function removeSystemPrompt(id: string) {
    systemPrompts.value = systemPrompts.value.filter(p => p.id !== id);
    updatedAt.value = Date.now();
    save();
  }

  function updateSystemPrompt(id: string, updates: Partial<SystemPrompt>) {
    const prompt = systemPrompts.value.find(p => p.id === id);
    if (prompt) {
      Object.assign(prompt, updates);
      updatedAt.value = Date.now();
      save();
    }
  }

  function addMcpServer(server: McpServer) {
    mcpServers.value.push(server);
    updatedAt.value = Date.now();
    save();
  }

  function removeMcpServer(id: string) {
    mcpServers.value = mcpServers.value.filter(s => s.id !== id);
    updatedAt.value = Date.now();
    save();
  }

  function updateMcpServer(id: string, updates: Partial<McpServer>) {
    const server = mcpServers.value.find(s => s.id === id);
    if (server) {
      Object.assign(server, updates);
      updatedAt.value = Date.now();
      save();
    }
  }

  function reorderEndpoints(newOrder: Endpoint[]) {
    endpoints.value = newOrder;
    updatedAt.value = Date.now();
    save();
  }

  function reorderModels(newOrder: Model[]) {
    models.value = newOrder;
    updatedAt.value = Date.now();
    save();
  }

  function setSyncToken(token: string) {
    syncToken.value = token;
    save();
  }

  function setLastSyncTime(time: number) {
    lastSyncTime.value = time;
    save();
  }

  function setUpdatedAt(time: number) {
    updatedAt.value = time;
    save();
  }

  return {
    endpoints,
    models,
    systemPrompts,
    mcpServers,
    syncToken,
    lastSyncTime,
    updatedAt,
    load,
    save,
    addEndpoint,
    removeEndpoint,
    updateEndpoint,
    addModel,
    removeModel,
    updateModel,
    addSystemPrompt,
    removeSystemPrompt,
    updateSystemPrompt,
    addMcpServer,
    removeMcpServer,
    updateMcpServer,
    reorderEndpoints,
    reorderModels,
    setSyncToken,
    setLastSyncTime,
    setUpdatedAt
  };
});
