import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { Store } from '@tauri-apps/plugin-store';

export interface Attachment {
  name: string;
  type: string;
  content: string; // Base64 data URI or text content
}

export interface Artifact {
  id: string;
  type: string; // e.g. 'text/html', 'application/javascript', 'text/markdown'
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

  return {
    sessions,
    projects,
    deletedSessions,
    deletedProjects,
    activeSessionId,
    activeSession,
    activeThread, // Export this
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
    setActiveSession
  };
});

function createArtifact(sessionId: string, artifact: Artifact, skipSave: boolean = false) {
  const store = useChatStore();
  const session = store.sessions.find(s => s.id === sessionId);
  if (session) {
    if (!session.artifacts) session.artifacts = [];

    const existing = session.artifacts.find(a => a.id === artifact.id);
    if (existing) {
      // Upsert: update fields that are present
      if (artifact.title) existing.title = artifact.title;
      if (artifact.type) existing.type = artifact.type;
      if (artifact.content) existing.content = artifact.content;
      existing.updatedAt = Date.now();
    } else {
      session.artifacts.push(artifact);
    }
    session.updatedAt = Date.now();
    if (!skipSave) {
      store.save();
    }
  }
}

function updateArtifact(sessionId: string, artifactId: string, content: string, skipSave: boolean = false) {
  const store = useChatStore();
  const session = store.sessions.find(s => s.id === sessionId);
  if (session && session.artifacts) {
    const artifact = session.artifacts.find(a => a.id === artifactId);
    if (artifact) {
      artifact.content = content;
      artifact.updatedAt = Date.now();
      session.updatedAt = Date.now();
      if (!skipSave) {
        store.save();
      }
    }
  }
}
