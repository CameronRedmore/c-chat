<script setup lang="ts">
import { ref, computed } from 'vue';
import { useSettingsStore } from '../stores/settings';
import { useChatStore, type EnabledMcpTool } from '../stores/chat';
import { getMcpClient, type McpTool } from '../services/mcp';
import { Icon } from '@iconify/vue';
import { storeToRefs } from 'pinia';

const props = defineProps<{
  sessionId: string;
}>();

const emit = defineEmits<{
  update: [tools: EnabledMcpTool[]];
}>();

const settingsStore = useSettingsStore();
const chatStore = useChatStore();
const { mcpServers } = storeToRefs(settingsStore);

const isOpen = ref(false);
const isLoading = ref(false);

interface ServerWithTools {
  serverId: string;
  serverName: string;
  tools: McpTool[];
  isExpanded: boolean;
}

const serversWithTools = ref<ServerWithTools[]>([]);

// Get current chat session's enabled tools
const enabledTools = computed(() => {
  const session = chatStore.sessions.find(s => s.id === props.sessionId);
  return session?.enabledMcpTools || [];
});

// Load tools from all enabled MCP servers
async function loadTools() {
  if (isLoading.value) return;
  isLoading.value = true;
  serversWithTools.value = [];

  const enabledServers = mcpServers.value.filter(s => s.enabled);

  for (const server of enabledServers) {
    try {
      const client = await getMcpClient(server);
      const tools = await client.listTools();
      serversWithTools.value.push({
        serverId: server.id,
        serverName: server.name,
        tools,
        isExpanded: true
      });
    } catch (e) {
      console.error(`Failed to load tools from ${server.name}:`, e);
    }
  }

  isLoading.value = false;
}

// Check if a specific tool is enabled
function isToolEnabled(serverId: string, toolName: string): boolean {
  const serverTools = enabledTools.value.find(et => et.serverId === serverId);
  if (!serverTools) return false;
  
  // Empty array means all tools are enabled
  if (serverTools.toolNames.length === 0) return true;
  
  return serverTools.toolNames.includes(toolName);
}

// Check if all tools for a server are enabled
function isServerFullyEnabled(serverId: string): boolean {
  const serverTools = enabledTools.value.find(et => et.serverId === serverId);
  if (!serverTools) return false;
  
  // Empty array means all tools are enabled
  return serverTools.toolNames.length === 0;
}

// Check if server has some tools enabled (for indeterminate state)
function isServerPartiallyEnabled(serverId: string): boolean {
  const serverTools = enabledTools.value.find(et => et.serverId === serverId);
  if (!serverTools) return false;
  
  // If empty array, all are enabled, not partial
  if (serverTools.toolNames.length === 0) return false;
  
  // If has some tools but not all
  const server = serversWithTools.value.find(s => s.serverId === serverId);
  if (!server) return false;
  
  return serverTools.toolNames.length > 0 && serverTools.toolNames.length < server.tools.length;
}

// Toggle a specific tool
function toggleTool(serverId: string, toolName: string) {
  const newEnabledTools = [...enabledTools.value];
  let serverTools = newEnabledTools.find(et => et.serverId === serverId);
  
  if (!serverTools) {
    // If server not in list, create entry with just this tool
    newEnabledTools.push({
      serverId,
      toolNames: [toolName]
    });
  } else {
    // If all tools were enabled (empty array), switch to specific tools
    if (serverTools.toolNames.length === 0) {
      const server = serversWithTools.value.find(s => s.serverId === serverId);
      if (server) {
        serverTools.toolNames = server.tools
          .map(t => t.name)
          .filter(name => name !== toolName);
      }
    } else {
      // Toggle the specific tool
      const index = serverTools.toolNames.indexOf(toolName);
      if (index > -1) {
        serverTools.toolNames.splice(index, 1);
        
        // If all tools are now enabled, switch to empty array
        const server = serversWithTools.value.find(s => s.serverId === serverId);
        if (server && serverTools.toolNames.length === server.tools.length - 1) {
          // Re-add the one we just removed to check
          serverTools.toolNames.push(toolName);
          if (serverTools.toolNames.length === server.tools.length) {
            serverTools.toolNames = [];
          } else {
            serverTools.toolNames.splice(serverTools.toolNames.indexOf(toolName), 1);
          }
        }
      } else {
        serverTools.toolNames.push(toolName);
        
        // Check if now all tools are enabled
        const server = serversWithTools.value.find(s => s.serverId === serverId);
        if (server && serverTools.toolNames.length === server.tools.length) {
          serverTools.toolNames = [];
        }
      }
    }
  }

  // Remove entries with no tools selected
  const filtered = newEnabledTools.filter(et => 
    et.toolNames.length > 0 || isServerFullyEnabled(et.serverId)
  );

  updateEnabledTools(filtered);
}

// Toggle all tools for a server
function toggleServer(serverId: string) {
  const newEnabledTools = [...enabledTools.value];
  const serverTools = newEnabledTools.find(et => et.serverId === serverId);
  
  if (!serverTools || serverTools.toolNames.length > 0) {
    // Enable all tools (empty array)
    const filtered = newEnabledTools.filter(et => et.serverId !== serverId);
    filtered.push({
      serverId,
      toolNames: []
    });
    updateEnabledTools(filtered);
  } else {
    // Disable all tools (remove from list)
    const filtered = newEnabledTools.filter(et => et.serverId !== serverId);
    updateEnabledTools(filtered);
  }
}

function updateEnabledTools(tools: EnabledMcpTool[]) {
  chatStore.updateSessionSettings(props.sessionId, {
    enabledMcpTools: tools
  });
  emit('update', tools);
}

function toggleServerExpansion(serverId: string) {
  const server = serversWithTools.value.find(s => s.serverId === serverId);
  if (server) {
    server.isExpanded = !server.isExpanded;
  }
}

async function openModal() {
  isOpen.value = true;
  await loadTools();
}

function closeModal() {
  isOpen.value = false;
}

// Count how many tools are enabled
const enabledToolCount = computed(() => {
  let count = 0;
  for (const et of enabledTools.value) {
    if (et.toolNames.length === 0) {
      // All tools enabled for this server
      const server = serversWithTools.value.find(s => s.serverId === et.serverId);
      if (server) count += server.tools.length;
    } else {
      count += et.toolNames.length;
    }
  }
  return count;
});
</script>

<template>
  <div>
    <button 
      @click="openModal"
      class="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg flex items-center gap-2 text-sm"
      title="Configure MCP Tools"
    >
      <Icon icon="lucide:wrench" class="w-5 h-5" />
      <span v-if="enabledToolCount > 0" class="text-xs bg-blue-600 text-white px-2 py-0.5 rounded-full">
        {{ enabledToolCount }}
      </span>
    </button>

    <!-- Modal -->
    <div 
      v-if="isOpen"
      class="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
      @click.self="closeModal"
    >
      <div class="bg-white/90 dark:bg-gray-800/90 backdrop-blur-md rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <!-- Header -->
        <div class="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">Configure Tools</h3>
          <button 
            @click="closeModal"
            class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <Icon icon="lucide:x" class="w-5 h-5" />
          </button>
        </div>

        <!-- Content -->
        <div class="flex-1 overflow-y-auto p-4">
          <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Select tools that are available to this chat session. Tools are organized by their MCP server.
          </p>

          <div v-if="isLoading" class="flex items-center justify-center py-8">
            <Icon icon="lucide:loader-2" class="w-8 h-8 animate-spin text-blue-600" />
          </div>

          <div v-else-if="serversWithTools.length === 0" class="text-center py-8 text-gray-500 dark:text-gray-400">
            No MCP servers enabled. Enable servers in Settings.
          </div>

          <div v-else class="space-y-2">
            <div 
              v-for="server in serversWithTools" 
              :key="server.serverId"
              class="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
            >
              <!-- Server Header -->
              <div 
                class="flex items-center gap-3 p-3 bg-gray-50/80 dark:bg-gray-900/80 cursor-pointer hover:bg-gray-100/80 dark:hover:bg-gray-700/80"
                @click="toggleServerExpansion(server.serverId)"
              >
                <input 
                  type="checkbox"
                  :checked="isServerFullyEnabled(server.serverId)"
                  :indeterminate="isServerPartiallyEnabled(server.serverId)"
                  @click.stop="toggleServer(server.serverId)"
                  class="w-4 h-4 cursor-pointer"
                />
                <Icon 
                  :icon="server.isExpanded ? 'lucide:chevron-down' : 'lucide:chevron-right'" 
                  class="w-4 h-4 text-gray-500"
                />
                <span class="font-medium flex-1 text-gray-900 dark:text-gray-100">{{ server.serverName }}</span>
                <span class="text-xs text-gray-500 dark:text-gray-400">
                  {{ server.tools.length }} tool{{ server.tools.length !== 1 ? 's' : '' }}
                </span>
              </div>

              <!-- Tools List -->
              <div v-if="server.isExpanded" class="p-2 space-y-1 bg-white/50 dark:bg-gray-800/50">
                <div 
                  v-for="tool in server.tools"
                  :key="tool.name"
                  class="flex items-start gap-3 p-2 hover:bg-gray-50/50 dark:hover:bg-gray-700/50 rounded cursor-pointer"
                  @click="toggleTool(server.serverId, tool.name)"
                >
                  <input 
                    type="checkbox"
                    :checked="isToolEnabled(server.serverId, tool.name)"
                    @click.stop="toggleTool(server.serverId, tool.name)"
                    class="w-4 h-4 mt-0.5 cursor-pointer"
                  />
                  <div class="flex-1 min-w-0">
                    <div class="font-mono text-sm text-gray-900 dark:text-gray-100">{{ tool.name }}</div>
                    <div v-if="tool.description" class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {{ tool.description }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="flex items-center justify-between p-4 border-t border-gray-200 dark:border-gray-700">
          <div class="text-sm text-gray-600 dark:text-gray-400">
            {{ enabledToolCount }} tool{{ enabledToolCount !== 1 ? 's' : '' }} selected
          </div>
          <button 
            @click="closeModal"
            class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
