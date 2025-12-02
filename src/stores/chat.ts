import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { Store } from '@tauri-apps/plugin-store';

export interface Attachment {
  name: string;
  type: string;
  content: string; // Base64 data URI or text content
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: any;
}

export interface ToolResult {
  callId: string;
  result: any;
  isError?: boolean;
}

export type MessagePartType = 'text' | 'reasoning' | 'tool-call' | 'tool-result';

export interface MessagePart {
  id: string;
  type: MessagePartType;
  content?: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
}

export interface Message {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  reasoning?: string;
  timestamp: number;
  model?: string;
  generationTime?: number;
  tokensPerSecond?: number;
  attachments?: Attachment[];
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  parts?: MessagePart[];
}

export interface Project {
  id: string;
  name: string;
  order: number;
  isExpanded: boolean;
  createdAt: number;
}

export interface EnabledMcpTool {
  serverId: string;
  toolNames: string[]; // Empty array means all tools enabled for this server
}

export interface ChatSession {
  id: string;
  title: string;
  modelId: string;
  systemPromptId?: string;
  temperature?: number;
  messages: Message[];
  createdAt: number;
  projectId?: string;
  order?: number;
  enabledMcpTools?: EnabledMcpTool[]; // Tools enabled for this specific chat
}

export const useChatStore = defineStore('chat', () => {
  const sessions = ref<ChatSession[]>([]);
  const projects = ref<Project[]>([]);
  const activeSessionId = ref<string | null>(null);
  let store: Store | null = null;

  async function getStore() {
    if (!store) {
      store = await Store.load('chat_history.json');
    }
    return store;
  }

  const activeSession = computed(() => 
    sessions.value.find(s => s.id === activeSessionId.value)
  );

  async function load() {
    const s = await getStore();
    const savedSessions = await s.get<ChatSession[]>('sessions');
    if (savedSessions) {
      // Migration: Ensure all messages have IDs and parts
      savedSessions.forEach(session => {
        session.messages.forEach(msg => {
          if (!msg.id) msg.id = crypto.randomUUID();
          
          // Migrate to parts if not present
          if (!msg.parts) {
            msg.parts = [];
            
            // 1. Reasoning
            if (msg.reasoning) {
              msg.parts.push({
                id: crypto.randomUUID(),
                type: 'reasoning',
                content: msg.reasoning
              });
            }
            
            // 2. Tool Calls and Results (interleaved best effort or just grouped)
            // Since we don't have historical order, we'll just put calls then results
            if (msg.toolCalls) {
              msg.toolCalls.forEach(tc => {
                msg.parts!.push({
                  id: crypto.randomUUID(),
                  type: 'tool-call',
                  toolCall: tc
                });
                
                // Find corresponding result
                const result = msg.toolResults?.find(tr => tr.callId === tc.id);
                if (result) {
                  msg.parts!.push({
                    id: crypto.randomUUID(),
                    type: 'tool-result',
                    toolResult: result
                  });
                }
              });
            }
            
            // 3. Content
            if (msg.content) {
              msg.parts.push({
                id: crypto.randomUUID(),
                type: 'text',
                content: msg.content
              });
            }
          }
        });
      });
      sessions.value = savedSessions;
    }
    
    const savedProjects = await s.get<Project[]>('projects');
    if (savedProjects) projects.value = savedProjects;
  }

  async function save() {
    const s = await getStore();
    await s.set('sessions', sessions.value);
    await s.set('projects', projects.value);
    await s.save();
  }

  function createSession(modelId: string, systemPromptId?: string, projectId?: string) {
    const id = crypto.randomUUID();
    const newSession: ChatSession = {
      id,
      title: 'New Chat',
      modelId,
      systemPromptId,
      messages: [],
      createdAt: Date.now(),
      projectId,
      order: 0 // Should be calculated to be at top
    };
    // Adjust orders
    sessions.value.forEach(s => {
      if (s.projectId === projectId) {
        s.order = (s.order || 0) + 1;
      }
    });
    
    sessions.value.unshift(newSession);
    activeSessionId.value = id;
    save();
    return id;
  }

  function createProject(name: string) {
    const id = crypto.randomUUID();
    const newProject: Project = {
      id,
      name,
      order: 0,
      isExpanded: true,
      createdAt: Date.now()
    };
    // Adjust orders of root items (projects and root sessions)
    // This is a bit complex because they are in different arrays.
    // For simplicity, let's just add it. The UI will handle reordering.
    projects.value.unshift(newProject);
    save();
    return id;
  }

  function deleteProject(id: string) {
    // Move sessions out of project or delete them?
    // Usually move them to root or delete them. Let's move to root for safety.
    sessions.value.forEach(s => {
      if (s.projectId === id) {
        s.projectId = undefined;
      }
    });
    projects.value = projects.value.filter(p => p.id !== id);
    save();
  }

  function updateProject(id: string, updates: Partial<Project>) {
    const project = projects.value.find(p => p.id === id);
    if (project) {
      Object.assign(project, updates);
      save();
    }
  }

  function deleteSession(id: string) {
    sessions.value = sessions.value.filter(s => s.id !== id);
    if (activeSessionId.value === id) {
      activeSessionId.value = null;
    }
    save();
  }

  function addMessage(sessionId: string, message: Message) {
    const session = sessions.value.find(s => s.id === sessionId);
    if (session) {
      if (!message.id) {
        message.id = crypto.randomUUID();
      }
      session.messages.push(message);
      save();
      return session.messages[session.messages.length - 1];
    }
    return null;
  }

  function editMessage(sessionId: string, messageId: string, newContent: string) {
    const session = sessions.value.find(s => s.id === sessionId);
    if (session) {
      const message = session.messages.find(m => m.id === messageId);
      if (message) {
        message.content = newContent;
        // If we edit the content, the parts (which might be interleaved) are now invalid/out of sync.
        // We clear parts so it falls back to rendering just the content (and tool calls separately if they exist in the array).
        // However, we want to keep tool calls/results if they exist in the arrays.
        // The legacy rendering shows tool calls then content.
        // So clearing parts is a safe fallback that preserves data but loses the interleaved display for this specific message.
        message.parts = undefined;
        save();
      }
    }
  }

  function deleteMessage(sessionId: string, messageId: string) {
    const session = sessions.value.find(s => s.id === sessionId);
    if (session) {
      session.messages = session.messages.filter(m => m.id !== messageId);
      save();
    }
  }

  function updateSessionSettings(sessionId: string, settings: Partial<ChatSession>) {
    const session = sessions.value.find(s => s.id === sessionId);
    if (session) {
      Object.assign(session, settings);
      save();
    }
  }

  function deleteMessagesAfter(sessionId: string, messageId: string, inclusive: boolean = false) {
    const session = sessions.value.find(s => s.id === sessionId);
    if (session) {
      const index = session.messages.findIndex(m => m.id === messageId);
      if (index !== -1) {
        if (inclusive) {
          session.messages = session.messages.slice(0, index);
        } else {
          session.messages = session.messages.slice(0, index + 1);
        }
        save();
      }
    }
  }

  return {
    sessions,
    projects,
    activeSessionId,
    activeSession,
    load,
    save,
    createSession,
    createProject,
    deleteProject,
    updateProject,
    deleteSession,
    addMessage,
    editMessage,
    deleteMessage,
    updateSessionSettings,
    deleteMessagesAfter
  };
});
