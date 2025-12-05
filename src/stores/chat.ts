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

  // Watch for activeSessionId changes to cleanup transient sessions
  // We can't easily use watch here inside defineStore setup without importing it, 
  // but we can handle it in the actions that change activeSessionId.
  // Actually, we can use watch from 'vue'.
  // But let's just handle it in the actions for explicit control.
  // The main action that changes activeSessionId is createSession (handled above) 
  // and direct assignment. 
  // We should probably make an action `setActiveSession(id)` to handle this cleanup centrally.

  function setActiveSession(id: string | null) {
    if (activeSessionId.value === id) return;

    // Cleanup previous if transient
    if (activeSessionId.value) {
      const prevSession = sessions.value.find(s => s.id === activeSessionId.value);
      if (prevSession && prevSession.isTransient) {
        sessions.value = sessions.value.filter(s => s.id !== prevSession.id);
        // Do NOT save tombstone
      }
    }

    activeSessionId.value = id;
    save();
  }

  // We need to access settings store, but we should do it inside actions to avoid early access issues
  // or use it lazily. Since this is a store definition, we can use it inside actions.

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
        let previousMsgId: string | null = null;

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

          // Migration to Tree:
          // If parentId is undefined, assume linear history and link to previous message
          if (msg.parentId === undefined) {
            msg.parentId = previousMsgId;
          }
          if (!msg.childrenIds) {
            msg.childrenIds = [];
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

          previousMsgId = msg.id;
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
        // If we are editing the latest message in the current branch, we can just update it.
        // But if we are editing a message that has children (or is not the leaf), we should probably branch?
        // For now, let's stick to simple edit if it's a leaf, or maybe just update content.
        // The user request implies "branching at a given message". 
        // If the user edits a message, typically in ChatGPT/Claude, it creates a NEW branch (sibling) with the new content.

        // Let's implement branching on edit.
        // 1. Create new message with new content, same parent.
        // 2. Switch to this new message.

        // However, the existing editMessage was in-place.
        // Let's change it to branch if it's not the last message? 
        // Actually, even for the last message, if we want to keep history, we should branch.
        // But "Edit" usually implies fixing a typo. "Regenerate" implies branching.
        // Let's keep "Edit" as in-place for now unless we want to strictly follow the "branching" paradigm for everything.
        // The prompt says "allow the user to branch a chat at a given message... separate branches should be easy to switch between".
        // This usually implies the "Edit" button in UI creates a branch.

        // Let's support both. But for now, to support the feature "branch at a given message", we'll add a `branchAt` action.
        // And we can update `editMessage` to just update content for now, or we can make it branch.
        // Let's make `editMessage` branch!

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
        // If parent is null (root deleted), and there are other messages?
        // If we deleted the root, we might have other roots?
        // If we deleted the only path, currentLeafId becomes null.

        // If we fell back to a node that has other children, should we select one of them as leaf?
        // Ideally we want to select the "latest active" child of that parent.
        // But we don't track "last active".
        // So just selecting the parent is fine, the UI will render up to the parent.
        // But wait, if we select the parent, and the parent has other children, the UI might want to show one of them?
        // If we set currentLeafId to parent, the thread ends at parent.
        // The UI will show "1 / N" for the next step if we implement it right.
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
    // This was for linear history. For tree, we probably just want to delete the subtree?
    // Or maybe just "prune" this branch?
    // Existing usage: handleRegenerate calls this to "rewind".
    // With branching, we don't need to delete! We just branch!
    // So we can deprecate this or change behavior.
    // But if the user explicitly wants to delete, we use deleteMessage.

    // For now, let's keep it but make it delete the subtree from that point in the CURRENT branch.
    // But wait, if we regenerate, we DON'T want to delete anymore.
    // So we should update the UI to NOT call this for regenerate.

    // I will leave this function as is (linear deletion) but updated for tree cleanup if called?
    // Actually, let's just implement subtree deletion.

    const session = sessions.value.find(s => s.id === sessionId);
    if (session) {
      // Find the message
      const msg = session.messages.find(m => m.id === messageId);
      if (!msg) return;

      if (inclusive) {
        deleteMessage(sessionId, messageId);
      } else {
        // Delete all children of this message that are on the current path?
        // Or just all children?
        // If we want to "clear forward history", we should delete all children.
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

    // Now we need to switch the view to this sibling.
    // But we need to find the "leaf" of this sibling to set currentLeafId.
    // We should probably track the "last active leaf" for each node to restore state.
    // For now, let's just walk down the "most recent" child or just the first child until we hit a leaf.
    // Or simpler: just set currentLeafId to the siblingId? 
    // If the sibling has children, we won't see them.
    // We need to find the leaf.

    let curr = session.messages.find(m => m.id === siblingId);
    while (curr && curr.childrenIds && curr.childrenIds.length > 0) {
      // Prefer the last added child? Or the most recently updated?
      // Let's pick the last one in the array (most recently added).
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
    // We need to access settings store. 
    // Note: Pinia allows using other stores inside actions.
    const settingsStore = useSettingsStore(); // Need to import this or pass it? 
    // We can import it at top level, but to avoid circular deps if any, internal usage is safe?
    // Actually, we can just use `useSettingsStore()` here since `pinia` instance is active.

    const session = sessions.value.find(s => s.id === sessionId);
    if (!session) return;

    const { models, endpoints } = settingsStore;

    // We need to resolve references since they are refs in the store?
    // Actually settingsStore properties are state/getters, so unwrap if needed?
    // `useSettingsStore` returns a reactive object. `models` is a state array.

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

    // Import sendMessage dynamically or at top? Top is better.
    // Assuming we added import { sendMessage } from '../services/llm';

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


    // sendMessage expects Message[] but handles 'system' role manually inside?
    // Actually sendMessage implementation takes Message[] and constructs apiMessages.
    // We should pass the thread.

    if (systemPromptContent) {
      // We can prepend system prompt, but sendMessage logic might want to handle it?
      // Looking at original ChatView code:
      // apiMessages.push({ role: 'system', ... });
      // apiMessages.push(...activeThread.value.slice(0, -1));
      // Wait, slice(0, -1) assumes the LAST message is the empty assistant message we just added?
      // Yes, addMessage appends to messages. `thread` includes it.
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
