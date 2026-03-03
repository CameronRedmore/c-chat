import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { Store } from '@tauri-apps/plugin-store';

import { useSettingsStore } from './settings';
import { sendMessage } from '../services/llm';

export interface Attachment {
  name: string;
  type: string;
  content: string; // Base64 data URI or text content
}

export interface Artifact {
  id: string;
  path: string;
  type: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
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

  // Branching
  parentId?: string | null;
  childrenIds?: string[];
}

export interface Project {
  id: string;
  name: string;
  order: number;
  isExpanded: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface EnabledMcpTool {
  serverId: string;
  toolNames: string[]; // Empty array means all tools enabled for this server
}

export interface Tombstone {
  id: string;
  deletedAt: number;
}

export interface ChatSession {
  id: string;
  title: string;
  modelId: string;
  systemPromptId?: string;
  temperature?: number;
  topP?: number;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  projectId?: string;
  order?: number;
  enabledMcpTools?: EnabledMcpTool[]; // Tools enabled for this specific chat

  // Branching
  // Branching
  currentLeafId?: string | null;

  // Artifacts
  artifacts?: Artifact[];

  // Transient
  isTransient?: boolean;
}

export const useChatStore = defineStore('chat', () => {
  const sessions = ref<ChatSession[]>([]);
  const projects = ref<Project[]>([]);
  const deletedSessions = ref<Tombstone[]>([]);
  const deletedProjects = ref<Tombstone[]>([]);
  const activeSessionId = ref<string | null>(null);
  const isGenerating = ref(false);
  let store: Store | null = null;

  function setActiveSession(id: string | null) {
    if (activeSessionId.value === id) return;

    // Cleanup previous if transient
    if (activeSessionId.value) {
      const prevSession = sessions.value.find(s => s.id === activeSessionId.value);
      if (prevSession && prevSession.isTransient) {
        sessions.value = sessions.value.filter(s => s.id !== prevSession.id);
      }
    }

    activeSessionId.value = id;
    save();
  }



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
      // Migration: Ensure all messages have IDs and parts, and migrate to tree structure
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

          // Backfill childrenIds for the parent
          if (msg.parentId) {
            const parent = session.messages.find(m => m.id === msg.parentId);
            if (parent) {
              if (!parent.childrenIds) parent.childrenIds = [];
              if (!parent.childrenIds.includes(msg.id)) {
                parent.childrenIds.push(msg.id);
              }
            }
          }


        });

        // Set currentLeafId if missing
        if (session.currentLeafId === undefined && session.messages.length > 0) {
          session.currentLeafId = session.messages[session.messages.length - 1].id;
        }
      });
      sessions.value = savedSessions;

      // Migration: Artifacts path
      sessions.value.forEach(s => {
        if (s.artifacts) {
          s.artifacts.forEach(a => {
            if (!a.path) {
              // Default to using title as path if it looks like a file, otherwise id
              a.path = a.title || a.id;
            }
          });
        }
      });
    }

    const savedProjects = await s.get<Project[]>('projects');
    if (savedProjects) projects.value = savedProjects;

    const savedDeletedSessions = await s.get<Tombstone[]>('deletedSessions');
    if (savedDeletedSessions) deletedSessions.value = savedDeletedSessions;

    const savedDeletedProjects = await s.get<Tombstone[]>('deletedProjects');
    if (savedDeletedProjects) deletedProjects.value = savedDeletedProjects;
  }

  async function save() {
    const s = await getStore();
    await s.set('sessions', sessions.value);
    await s.set('projects', projects.value);
    await s.set('deletedSessions', deletedSessions.value);
    await s.set('deletedProjects', deletedProjects.value);
    await s.save();
  }

  function createSession(modelId: string, systemPromptId?: string, projectId?: string, options: { isTransient?: boolean } = {}) {
    const id = crypto.randomUUID();
    const newSession: ChatSession = {
      id,
      title: options.isTransient ? 'Transient Chat' : 'New Chat',
      modelId,
      systemPromptId,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      projectId,
      order: 0, // Should be calculated to be at top
      currentLeafId: null,
      artifacts: [],
      isTransient: options.isTransient
    };
    // Adjust orders
    if (!options.isTransient) {
      sessions.value.forEach(s => {
        if (s.projectId === projectId) {
          s.order = (s.order || 0) + 1;
        }
      });
    }

    sessions.value.unshift(newSession);

    // If switching FROM a transient session, we need to clean it up
    if (activeSessionId.value) {
      const prevSession = sessions.value.find(s => s.id === activeSessionId.value);
      if (prevSession && prevSession.isTransient) {
        // Delete it without tombstone
        sessions.value = sessions.value.filter(s => s.id !== prevSession.id);
      }
    }

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
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    // Adjust orders of root items
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

    if (projects.value.some(p => p.id === id)) {
      deletedProjects.value.push({ id, deletedAt: Date.now() });
    }
    projects.value = projects.value.filter(p => p.id !== id);

    save();
  }

  function updateProject(id: string, updates: Partial<Project>) {
    const project = projects.value.find(p => p.id === id);
    if (project) {
      Object.assign(project, updates);
      project.updatedAt = Date.now();
      save();
    }
  }

  function deleteSession(id: string) {
    const session = sessions.value.find(s => s.id === id);
    if (session) {
      if (!session.isTransient) {
        deletedSessions.value.push({ id, deletedAt: Date.now() });
      }
      sessions.value = sessions.value.filter(s => s.id !== id);
      if (activeSessionId.value === id) {
        activeSessionId.value = null;
      }
      save();
    }
  }

  function deleteSessionsInProject(projectId: string) {
    const sessionsToDelete = sessions.value.filter(s => s.projectId === projectId);

    // Add to deleted sessions for history/undo support if we wanted, or just tombstone them
    sessionsToDelete.forEach(s => {
      if (!s.isTransient) {
        deletedSessions.value.push({ id: s.id, deletedAt: Date.now() });
      }
    });

    // Remove from sessions
    sessions.value = sessions.value.filter(s => s.projectId !== projectId);

    // If active session was in this project, clear it
    if (activeSessionId.value) {
      const activeWasInProject = sessionsToDelete.some(s => s.id === activeSessionId.value);
      if (activeWasInProject) {
        activeSessionId.value = null;
      }
    }

    save();
  }

  function deleteAllSessions() {
    // Tombstone all non-transient sessions
    sessions.value.forEach(s => {
      if (!s.isTransient) {
        deletedSessions.value.push({ id: s.id, deletedAt: Date.now() });
      }
    });

    sessions.value = [];
    activeSessionId.value = null;

    save();
  }

  function addMessage(sessionId: string, message: Message, parentId?: string) {
    const session = sessions.value.find(s => s.id === sessionId);
    if (session) {
      if (!message.id) {
        message.id = crypto.randomUUID();
      }

      // Determine parent
      if (parentId !== undefined) {
        message.parentId = parentId;
      } else {
        // Default to current leaf
        message.parentId = session.currentLeafId || null;
      }

      message.childrenIds = [];

      // Update parent's children
      if (message.parentId) {
        const parent = session.messages.find(m => m.id === message.parentId);
        if (parent) {
          if (!parent.childrenIds) parent.childrenIds = [];
          parent.childrenIds.push(message.id);
        }
      }

      session.messages.push(message);
      session.currentLeafId = message.id; // New message becomes the leaf
      session.updatedAt = Date.now();
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
        const newMessage: Message = {
          ...message,
          id: crypto.randomUUID(),
          content: newContent,
          parts: undefined, // Clear parts as content changed
          childrenIds: [], // New branch has no children yet
          timestamp: Date.now()
        };

        // Parent stays same
        if (message.parentId) {
          const parent = session.messages.find(m => m.id === message.parentId);
          if (parent) {
            if (!parent.childrenIds) parent.childrenIds = [];
            parent.childrenIds.push(newMessage.id!);
          }
        }

        session.messages.push(newMessage);
        session.currentLeafId = newMessage.id; // Switch to new branch
        session.updatedAt = Date.now();
        save();
      }
    }
  }

  function deleteMessage(sessionId: string, messageId: string) {
    const session = sessions.value.find(s => s.id === sessionId);
    if (session) {
      // Deleting a node in a tree is complex. 
      // We could just hide it? Or actually delete it and its subtree?
      // For now, let's just remove it from the array and parent's children list.
      // And if it was the current leaf, we need to pick a new one.

      const message = session.messages.find(m => m.id === messageId);
      if (!message) return;

      // Remove from parent's children
      if (message.parentId) {
        const parent = session.messages.find(m => m.id === message.parentId);
        if (parent && parent.childrenIds) {
          parent.childrenIds = parent.childrenIds.filter(id => id !== messageId);
        }
      }

      // Recursive delete of children? Or just orphan them?
      // Let's recursively delete for cleanup.
      const toDelete = new Set<string>();
      const stack = [messageId];
      while (stack.length > 0) {
        const id = stack.pop()!;
        toDelete.add(id);
        const msg = session.messages.find(m => m.id === id);
        if (msg && msg.childrenIds) {
          stack.push(...msg.childrenIds);
        }
      }

      session.messages = session.messages.filter(m => !toDelete.has(m.id!));

      // If currentLeafId was deleted, reset it to parent of the deleted node (if available)
      if (session.currentLeafId && toDelete.has(session.currentLeafId)) {
        session.currentLeafId = message.parentId || null;
      }

      session.updatedAt = Date.now();
      save();
    }
  }

  function updateSessionSettings(sessionId: string, settings: Partial<ChatSession>) {
    const session = sessions.value.find(s => s.id === sessionId);
    if (session) {
      Object.assign(session, settings);
      session.updatedAt = Date.now();
      save();
    }
  }

  function deleteMessagesAfter(sessionId: string, messageId: string, inclusive: boolean = false) {
    const session = sessions.value.find(s => s.id === sessionId);
    if (session) {
      const msg = session.messages.find(m => m.id === messageId);
      if (!msg) return;

      if (inclusive) {
        deleteMessage(sessionId, messageId);
      } else {
        if (msg.childrenIds) {
          [...msg.childrenIds].forEach(childId => deleteMessage(sessionId, childId));
        }
      }
    }
  }

  function navigateBranch(sessionId: string, messageId: string, direction: 'prev' | 'next') {
    const session = sessions.value.find(s => s.id === sessionId);
    if (!session) return;

    const message = session.messages.find(m => m.id === messageId);
    if (!message || !message.parentId) return;

    const parent = session.messages.find(m => m.id === message.parentId);
    if (!parent || !parent.childrenIds) return;

    const currentIndex = parent.childrenIds.indexOf(messageId);
    if (currentIndex === -1) return;

    let newIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1;
    // Clamp? Or wrap? Usually clamp.
    if (newIndex < 0) newIndex = parent.childrenIds.length - 1; // Wrap for convenience? Or stop?
    if (newIndex >= parent.childrenIds.length) newIndex = 0;

    const siblingId = parent.childrenIds[newIndex];



    let curr = session.messages.find(m => m.id === siblingId);
    while (curr && curr.childrenIds && curr.childrenIds.length > 0) {
      const nextId = curr.childrenIds[curr.childrenIds.length - 1];
      curr = session.messages.find(m => m.id === nextId);
    }

    if (curr) {
      session.currentLeafId = curr.id;
      session.updatedAt = Date.now();
      save();
    }
  }

  function setCurrentLeaf(sessionId: string, messageId: string) {
    const session = sessions.value.find(s => s.id === sessionId);
    if (session) {
      session.currentLeafId = messageId;
      session.updatedAt = Date.now();
      save();
    }
  }

  // Computed property to get the linear thread for the active session
  const activeThread = computed(() => {
    if (!activeSession.value) return [];
    const session = activeSession.value;
    const thread: Message[] = [];

    let currentId = session.currentLeafId;
    while (currentId) {
      const msg = session.messages.find(m => m.id === currentId);
      if (msg) {
        thread.unshift(msg);
        currentId = msg.parentId || null;
      } else {
        break;
      }
    }
    return thread;
  });

  function getArtifactsForSession(sessionId: string) {
    const session = sessions.value.find(s => s.id === sessionId);
    if (!session) return [];

    if (session.projectId) {
      // Return all artifacts from all sessions in this project
      const projectSessions = sessions.value.filter(s => s.projectId === session.projectId);
      return projectSessions.flatMap(s => s.artifacts || []).sort((a, b) => b.updatedAt - a.updatedAt);
    } else {
      // Return only this session's artifacts
      return (session.artifacts || []).sort((a, b) => b.updatedAt - a.updatedAt);
    }
  }

  // --- Request Handling ---

  const abortController = ref<AbortController | null>(null);

  function stopGeneration() {
    if (abortController.value) {
      abortController.value.abort();
      abortController.value = null;
    }
    isGenerating.value = false;
  }

  async function generateTitle(sessionId: string, userContent: string, assistantContent: string) {
    const settingsStore = useSettingsStore();

    const session = sessions.value.find(s => s.id === sessionId);
    if (!session) return;

    const { models, endpoints } = settingsStore;



    const model = models.find(m => m.id === session.modelId);
    if (!model) return;

    const endpoint = endpoints.find(e => e.id === model.endpointId);
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
      await sendMessage(endpoint, model, messages, { temperature: 0.7 }, (payload) => {
        if (payload.content) title += payload.content;
      }, sessionId);

      if (title.trim()) {
        updateSessionSettings(sessionId, { title: title.trim().replace(/^["']|["']$/g, '') });
      }
    } catch (e) {
      console.error('Failed to generate title', e);
    }
  }

  async function generateResponse(sessionId: string, onChunk?: () => void) {
    const session = sessions.value.find(s => s.id === sessionId);
    if (!session) return;

    const settingsStore = useSettingsStore();
    const { models, endpoints, systemPrompts } = settingsStore;

    const model = models.find(m => m.id === session.modelId);
    if (!model) {
      isGenerating.value = false;
      return;
    }
    const endpoint = endpoints.find(e => e.id === model.endpointId);
    if (!endpoint) {
      isGenerating.value = false;
      return;
    }

    isGenerating.value = true;
    abortController.value = new AbortController();
    const startTime = Date.now();

    // Get active thread
    // We need to reconstruct the thread based on currentLeafId
    const thread: Message[] = [];
    let currentId = session.currentLeafId;
    while (currentId) {
      const msg = session.messages.find(m => m.id === currentId);
      if (msg) {
        thread.unshift(msg);
        currentId = msg.parentId || null;
      } else {
        break;
      }
    }

    const initialAssistantMsg: Message = {
      role: 'assistant',
      content: '',
      timestamp: startTime,
      model: model.name,
      parts: []
    };

    // Add message
    const assistantMsg = addMessage(sessionId, initialAssistantMsg);
    if (!assistantMsg) {
      isGenerating.value = false;
      return;
    }

    // Find system prompt
    let systemPromptContent = '';
    if (session.systemPromptId) {
      const prompt = systemPrompts.find(p => p.id === session.systemPromptId);
      if (prompt) systemPromptContent = prompt.content;
    }




    // Construct messages for API
    const messagesForApi: Message[] = [];
    if (systemPromptContent) {
      messagesForApi.push({ role: 'system', content: systemPromptContent, timestamp: 0 } as Message);
    }
    // Add all messages from the thread
    messagesForApi.push(...thread);

    let userContentForTitle = '';
    // Find last user message for title generation
    const lastUserMsg = [...messagesForApi].reverse().find(m => m.role === 'user');
    if (lastUserMsg) userContentForTitle = lastUserMsg.content;
    const checkTitleGeneration = messagesForApi.filter(m => m.role !== 'system').length === 1; // Only one user message

    try {
      await sendMessage(
        endpoint,
        model,
        messagesForApi,
        {
          temperature: session.temperature ?? model.temperature ?? 0.7,
          topP: session.topP ?? model.topP,
        },
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

          if (onChunk) onChunk();
        },
        session.id,
        session.enabledMcpTools,
        abortController.value?.signal
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
      abortController.value = null;
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

      updateSessionSettings(sessionId, {});

      isGenerating.value = false;
      save();

      if (checkTitleGeneration && assistantMsg.content && !assistantMsg.content.startsWith('Error:')) {
        // Run title generation in background
        generateTitle(sessionId, userContentForTitle, assistantMsg.content);
      }
    }
  }

  async function sendUserMessage(sessionId: string, content: string, attachments: Attachment[] = [], onChunk?: () => void) {
    if (isGenerating.value) return;

    const userMsg: Message = {
      role: 'user',
      content,
      timestamp: Date.now(),
      attachments
    };

    addMessage(sessionId, userMsg);
    await generateResponse(sessionId, onChunk);
  }

  async function regenerateMessage(sessionId: string, messageId: string, onChunk?: () => void) {
    if (isGenerating.value) return;

    const session = sessions.value.find(s => s.id === sessionId);
    if (!session) return;

    const message = session.messages.find(m => m.id === messageId);
    if (!message) return;

    if (message.role === 'user') {
      session.currentLeafId = messageId;
      save();
      await generateResponse(sessionId, onChunk);

    } else if (message.role === 'assistant') {
      const parentId = message.parentId;
      session.currentLeafId = parentId || null;
      save();
      await generateResponse(sessionId, onChunk);
    }
  }

  return {
    sessions,
    projects,
    deletedSessions,
    deletedProjects,
    activeSessionId,
    activeSession,
    activeThread,
    isGenerating,
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
    deleteMessagesAfter,
    navigateBranch,
    setCurrentLeaf,
    createArtifact,
    updateArtifact,
    setActiveSession,
    getArtifactsForSession,
    // Actions
    sendUserMessage,
    regenerateMessage,
    stopGeneration,
    deleteSessionsInProject,
    deleteAllSessions
  };
});

function createArtifact(sessionId: string, artifact: Partial<Artifact> & { type: string; content: string; title: string }, skipSave: boolean = false) {
  const store = useChatStore();
  const session = store.sessions.find(s => s.id === sessionId);
  if (session) {
    if (!session.artifacts) session.artifacts = [];

    // Resolve path and ID
    // If path is provided, use it. If not, derive from title.
    const path = artifact.path || artifact.title;

    // Check if artifact with this path already exists
    const existing = session.artifacts.find(a => a.path === path || a.id === artifact.id);

    if (existing) {
      // Upsert
      Object.assign(existing, {
        ...artifact,
        path, // Ensure path is set
        updatedAt: Date.now()
      });
    } else {
      // Check in project
      let targetArtifact = null;

      if (session.projectId) {
        const projectSessions = store.sessions.filter(s => s.projectId === session.projectId);
        for (const s of projectSessions) {
          if (s.artifacts) {
            const found = s.artifacts.find(a => a.path === path || (artifact.id && a.id === artifact.id));
            if (found) {
              targetArtifact = found;
              break;
            }
          }
        }
      }

      if (targetArtifact) {
        Object.assign(targetArtifact, {
          ...artifact,
          path,
          updatedAt: Date.now()
        });
      } else {
        // Create new
        const newArtifact: Artifact = {
          id: artifact.id || crypto.randomUUID(),
          path: path,
          type: artifact.type,
          title: artifact.title,
          content: artifact.content,
          createdAt: artifact.createdAt || Date.now(),
          updatedAt: Date.now()
        };
        session.artifacts.push(newArtifact);
      }
    }
    session.updatedAt = Date.now();
    if (!skipSave) {
      store.save();
    }
  }
}

function updateArtifact(sessionId: string, identifier: string, content: string, skipSave: boolean = false) {
  const store = useChatStore();
  const session = store.sessions.find(s => s.id === sessionId);

  if (session) {
    let targetArtifact: Artifact | undefined;

    // Helper finder
    const find = (artifacts: Artifact[]) => artifacts.find(a => a.id === identifier || a.path === identifier);

    // Check current session first
    if (session.artifacts) {
      targetArtifact = find(session.artifacts);
    }

    // If not found and in project, check other sessions
    if (!targetArtifact && session.projectId) {
      const projectSessions = store.sessions.filter(s => s.projectId === session.projectId);
      for (const s of projectSessions) {
        if (s.artifacts) {
          targetArtifact = find(s.artifacts);
          if (targetArtifact) break;
        }
      }
    }

    if (targetArtifact) {
      targetArtifact.content = content;
      targetArtifact.updatedAt = Date.now();
      session.updatedAt = Date.now();
      if (!skipSave) {
        store.save();
      }
    }
  }
}
