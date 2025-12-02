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

export const useSettingsStore = defineStore('settings', () => {
  // State
  const endpoints = ref<Endpoint[]>([]);
  const models = ref<Model[]>([]);
  const systemPrompts = ref<SystemPrompt[]>([]);
  const mcpServers = ref<McpServer[]>([]);
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
  }

  async function save() {
    const s = await getStore();
    await s.set('endpoints', endpoints.value);
    await s.set('models', models.value);
    await s.set('systemPrompts', systemPrompts.value);
    await s.set('mcpServers', mcpServers.value);
    await s.save();
  }

  function addEndpoint(endpoint: Endpoint) {
    endpoints.value.push(endpoint);
    save();
  }

  function removeEndpoint(id: string) {
    endpoints.value = endpoints.value.filter(e => e.id !== id);
    models.value = models.value.filter(m => m.endpointId !== id); // Cascade delete models
    save();
  }

  function updateEndpoint(id: string, updates: Partial<Endpoint>) {
    const endpoint = endpoints.value.find(e => e.id === id);
    if (endpoint) {
      Object.assign(endpoint, updates);
      save();
    }
  }

  function addModel(model: Model) {
    models.value.push(model);
    save();
  }

  function removeModel(id: string) {
    models.value = models.value.filter(m => m.id !== id);
    save();
  }

  function updateModel(id: string, updates: Partial<Model>) {
    const model = models.value.find(m => m.id === id);
    if (model) {
      Object.assign(model, updates);
      save();
    }
  }

  function addSystemPrompt(prompt: SystemPrompt) {
    systemPrompts.value.push(prompt);
    save();
  }

  function removeSystemPrompt(id: string) {
    systemPrompts.value = systemPrompts.value.filter(p => p.id !== id);
    save();
  }

  function updateSystemPrompt(id: string, updates: Partial<SystemPrompt>) {
    const prompt = systemPrompts.value.find(p => p.id === id);
    if (prompt) {
      Object.assign(prompt, updates);
      save();
    }
  }

  function addMcpServer(server: McpServer) {
    mcpServers.value.push(server);
    save();
  }

  function removeMcpServer(id: string) {
    mcpServers.value = mcpServers.value.filter(s => s.id !== id);
    save();
  }

  function updateMcpServer(id: string, updates: Partial<McpServer>) {
    const server = mcpServers.value.find(s => s.id === id);
    if (server) {
      Object.assign(server, updates);
      save();
    }
  }

  return {
    endpoints,
    models,
    systemPrompts,
    mcpServers,
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
    updateMcpServer
  };
});
