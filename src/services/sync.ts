import { useSettingsStore, type SettingsState } from '../stores/settings';
import { useSyncStore } from '../stores/sync';
import { useChatStore, type ChatSession, type Project } from '../stores/chat';

import { fetch } from '@tauri-apps/plugin-http';


const API_BASE = 'https://camkey.cmzi.uk';

interface KeyMetadata {
    key: string;
    content_type: string;
    updated_at: string; // ISO string
}

interface KeysResponse {
    ok: boolean;
    count: number;
    keys: KeyMetadata[];
}

export class SyncService {
    private syncInterval: number | null = null;
    private activeInterval: number | null = null;
    private idleTimeout: number | null = null;
    private isAutoSyncing = false;
    private onActivity: (() => void) | null = null;

    private readonly IDLE_DELAY = 60000; // 1 minute before going idle
    private readonly ACTIVE_SYNC_RATE = 5000; // 5 seconds
    private readonly IDLE_SYNC_RATE = 60000; // 1 minute

    private get settingsStore() {
        return useSettingsStore();
    }

    private get syncStore() {
        return useSyncStore();
    }

    private get chatStore() {
        return useChatStore();
    }

    private get token() {
        return this.settingsStore.syncToken;
    }

    private get headers() {
        return {
            'Authorization': `Bearer ${this.token}`,
        };
    }

    public async startAutoSync() {
        if (this.isAutoSyncing) return;
        this.isAutoSyncing = true;
        this.setupActivityListeners();
        this.startIdleSync();
        await this.sync();
    }

    private setupActivityListeners() {
        if (this.onActivity) return;
        this.onActivity = () => this.handleUserActivity();
        window.addEventListener('mousemove', this.onActivity);
        window.addEventListener('keydown', this.onActivity);
        window.addEventListener('focus', this.onActivity);
    }

    private removeActivityListeners() {
        if (this.onActivity) {
            window.removeEventListener('mousemove', this.onActivity);
            window.removeEventListener('keydown', this.onActivity);
            window.removeEventListener('focus', this.onActivity);
            this.onActivity = null;
        }
    }

    private handleUserActivity() {
        // If we are currently in idle mode (slow sync), switch to active mode
        if (!this.activeInterval) {
            this.startActiveSync();
        }

        // Reset the idle timer
        if (this.idleTimeout) clearTimeout(this.idleTimeout);
        this.idleTimeout = window.setTimeout(() => {
            this.startIdleSync();
        }, this.IDLE_DELAY);
    }

    private startActiveSync() {
        this.clearSyncIntervals();
        // console.log('Switching to active sync mode');
        this.activeInterval = window.setInterval(() => this.sync(), this.ACTIVE_SYNC_RATE);
    }

    private startIdleSync() {
        this.clearSyncIntervals();
        // console.log('Switching to idle sync mode');
        this.syncInterval = window.setInterval(() => this.sync(), this.IDLE_SYNC_RATE);
    }

    private clearSyncIntervals() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
        if (this.activeInterval) {
            clearInterval(this.activeInterval);
            this.activeInterval = null;
        }
    }

    public init() {
        // No-op: Deletions are now handled via tombstones during sync
    }

    public stopAutoSync() {
        this.isAutoSyncing = false;
        this.removeActivityListeners();
        this.clearSyncIntervals();
        if (this.idleTimeout) {
            clearTimeout(this.idleTimeout);
            this.idleTimeout = null;
        }
    }

    public async sync() {
        if (!this.token || this.syncStore.isSyncing) return;

        if (this.chatStore.isGenerating) {
            console.log('Sync skipped because generation is in progress.');
            return;
        }

        this.syncStore.setSyncing(true);
        try {
            await this.syncSettings();
            await this.syncChats();
            await this.syncProjects();
            this.settingsStore.setLastSyncTime(Date.now());
            this.syncStore.setSuccess();
        } catch (error) {
            console.error('Sync failed:', error);
            this.syncStore.setError(String(error));
        }
    }

    private async syncSettings() {
        const key = 'settings';
        const remoteMeta = await this.getKeyMetadata(key);
        const localUpdatedAt = this.settingsStore.updatedAt;

        if (remoteMeta) {
            const remoteUpdatedAt = new Date(remoteMeta.updated_at).getTime();
            if (remoteUpdatedAt > localUpdatedAt) {
                // Download
                const remoteSettings = await this.getValue<Partial<SettingsState>>(key);
                if (remoteSettings) {
                    // Apply updates carefully to avoid overwriting sync token itself if not needed, 
                    // though usually we want to sync everything.
                    // We need to avoid triggering watchers that would cause a re-upload.
                    // Since isSyncing is true, we should be safe if we implement watchers correctly.

                    // We don't want to overwrite the sync token with an old one or empty one if that happens
                    const { syncToken, ...rest } = remoteSettings;

                    if (rest.endpoints) this.settingsStore.reorderEndpoints(rest.endpoints);
                    if (rest.models) this.settingsStore.reorderModels(rest.models);
                    if (rest.systemPrompts) {
                        // We don't have a bulk setter for prompts, so we iterate. 
                        // Actually, the store doesn't have a bulk setter for everything.
                        // We might need to extend the store or just update the refs directly if we were inside the store.
                        // Since we are outside, we have to use available actions or access state if possible.
                        // Pinia state is reactive.
                        this.settingsStore.endpoints = rest.endpoints || [];
                        this.settingsStore.models = rest.models || [];
                        this.settingsStore.systemPrompts = rest.systemPrompts || [];
                        this.settingsStore.mcpServers = rest.mcpServers || [];

                        // Update local timestamp to match remote so we don't re-upload immediately
                        this.settingsStore.setUpdatedAt(remoteUpdatedAt);
                    }

                }
            } else if (localUpdatedAt > remoteUpdatedAt) {
                // Upload
                const state: Partial<SettingsState> = {
                    endpoints: this.settingsStore.endpoints,
                    models: this.settingsStore.models,
                    systemPrompts: this.settingsStore.systemPrompts,
                    mcpServers: this.settingsStore.mcpServers,
                    updatedAt: localUpdatedAt
                };
                await this.setValue(key, state);
            }
        } else {
            // No remote settings, upload local
            const state: Partial<SettingsState> = {
                endpoints: this.settingsStore.endpoints,
                models: this.settingsStore.models,
                systemPrompts: this.settingsStore.systemPrompts,
                mcpServers: this.settingsStore.mcpServers,
                updatedAt: localUpdatedAt
            };
            await this.setValue(key, state);
        }
    }

    private async syncChats() {
        // List all chat keys
        const prefix = 'chat:';
        const remoteKeys = await this.listKeys(prefix);
        // Filter out transient sessions from local list so we don't consider them for sync
        const localSessions = this.chatStore.sessions.filter(s => !s.isTransient);
        const deletedSessions = this.chatStore.deletedSessions;

        // 1. Handle Remote to Local (Download)
        for (const meta of remoteKeys) {
            const chatId = meta.key.replace(prefix, '');

            const localSession = localSessions.find(s => s.id === chatId);
            const localDeleted = deletedSessions.find(s => s.id === chatId);

            const localUpdatedAt = localSession ? localSession.updatedAt : (localDeleted ? localDeleted.deletedAt : 0);
            const remoteUpdatedAt = new Date(meta.updated_at).getTime();

            if (remoteUpdatedAt > localUpdatedAt) {
                const remoteData = await this.getValue<any>(meta.key);
                if (remoteData) {
                    if (remoteData.deleted) {
                        // Remote says deleted
                        if (localSession) {
                            // Remove from sessions
                            const idx = this.chatStore.sessions.findIndex(s => s.id === chatId);
                            if (idx !== -1) this.chatStore.sessions.splice(idx, 1);

                            // Add to deletedSessions with REMOTE timestamp to avoid re-upload
                            const delIdx = this.chatStore.deletedSessions.findIndex(s => s.id === chatId);
                            if (delIdx === -1) {
                                this.chatStore.deletedSessions.push({
                                    id: chatId,
                                    deletedAt: remoteUpdatedAt
                                });
                            } else {
                                this.chatStore.deletedSessions[delIdx].deletedAt = remoteUpdatedAt;
                            }

                            if (this.chatStore.activeSessionId === chatId) {
                                this.chatStore.activeSessionId = null;
                            }
                            this.chatStore.save();
                        }
                    } else {
                        // Remote says active
                        const remoteSession = remoteData as ChatSession;
                        if (localSession) {
                            // Only update if remote content is actually newer than local content
                            // This prevents loops where server metadata time > content time
                            if (remoteSession.updatedAt > localSession.updatedAt) {
                                this.chatStore.updateSessionSettings(chatId, remoteSession);
                                const index = this.chatStore.sessions.findIndex(s => s.id === chatId);
                                if (index !== -1) {
                                    this.chatStore.sessions[index] = remoteSession;
                                }
                                this.chatStore.save();
                            }
                        } else {
                            // Undelete if needed
                            const delIndex = this.chatStore.deletedSessions.findIndex(s => s.id === chatId);
                            if (delIndex !== -1) {
                                this.chatStore.deletedSessions.splice(delIndex, 1);
                            }
                            this.chatStore.sessions.unshift(remoteSession);
                            this.chatStore.save();
                        }
                    }
                }
            }
        }

        // 2. Handle Local to Remote (Upload)
        // Active sessions
        for (const session of localSessions) {
            const key = `${prefix}${session.id}`;
            const meta = remoteKeys.find(k => k.key === key);
            const localUpdatedAt = session.updatedAt;

            if (!meta || localUpdatedAt > new Date(meta.updated_at).getTime()) {
                await this.setValue(key, session);
            }
        }

        // Deleted sessions (Tombstones)
        for (const tombstone of deletedSessions) {
            const key = `${prefix}${tombstone.id}`;
            const meta = remoteKeys.find(k => k.key === key);
            const localUpdatedAt = tombstone.deletedAt;

            if (!meta || localUpdatedAt > new Date(meta.updated_at).getTime()) {
                await this.setValue(key, {
                    id: tombstone.id,
                    deleted: true,
                    updatedAt: localUpdatedAt
                });
            }
        }
    }

    private async syncProjects() {
        const prefix = 'project:';
        const remoteKeys = await this.listKeys(prefix);
        const localProjects = this.chatStore.projects;
        const deletedProjects = this.chatStore.deletedProjects;

        // 1. Remote to Local
        for (const meta of remoteKeys) {
            const projectId = meta.key.replace(prefix, '');

            const localProject = localProjects.find(p => p.id === projectId);
            const localDeleted = deletedProjects.find(p => p.id === projectId);

            const localUpdatedAt = localProject ? localProject.updatedAt : (localDeleted ? localDeleted.deletedAt : 0);
            const remoteUpdatedAt = new Date(meta.updated_at).getTime();

            if (remoteUpdatedAt > localUpdatedAt) {
                const remoteData = await this.getValue<any>(meta.key);
                if (remoteData) {
                    if (remoteData.deleted) {
                        // Remote says deleted
                        if (localProject) {
                            const idx = this.chatStore.projects.findIndex(p => p.id === projectId);
                            if (idx !== -1) this.chatStore.projects.splice(idx, 1);

                            const delIdx = this.chatStore.deletedProjects.findIndex(p => p.id === projectId);
                            if (delIdx === -1) {
                                this.chatStore.deletedProjects.push({
                                    id: projectId,
                                    deletedAt: remoteUpdatedAt
                                });
                            } else {
                                this.chatStore.deletedProjects[delIdx].deletedAt = remoteUpdatedAt;
                            }
                            this.chatStore.save();
                        }
                    } else {
                        // Remote says active
                        const remoteProject = remoteData as Project;
                        if (localProject) {
                            // Only update if remote content is actually newer
                            if (remoteProject.updatedAt > localProject.updatedAt) {
                                Object.assign(localProject, remoteProject);
                                this.chatStore.save();
                            }
                        } else {
                            // Undelete
                            const delIndex = this.chatStore.deletedProjects.findIndex(p => p.id === projectId);
                            if (delIndex !== -1) {
                                this.chatStore.deletedProjects.splice(delIndex, 1);
                            }
                            this.chatStore.projects.push(remoteProject);
                            this.chatStore.save();
                        }
                    }
                }
            }
        }

        // 2. Local to Remote
        for (const project of localProjects) {
            const key = `${prefix}${project.id}`;
            const meta = remoteKeys.find(k => k.key === key);
            const localUpdatedAt = project.updatedAt;

            if (!meta || localUpdatedAt > new Date(meta.updated_at).getTime()) {
                await this.setValue(key, project);
            }
        }

        // Deleted projects (Tombstones)
        for (const tombstone of deletedProjects) {
            const key = `${prefix}${tombstone.id}`;
            const meta = remoteKeys.find(k => k.key === key);
            const localUpdatedAt = tombstone.deletedAt;

            if (!meta || localUpdatedAt > new Date(meta.updated_at).getTime()) {
                await this.setValue(key, {
                    id: tombstone.id,
                    deleted: true,
                    updatedAt: localUpdatedAt
                });
            }
        }
    }

    // API Helpers

    private async listKeys(prefix: string = ''): Promise<KeyMetadata[]> {
        try {
            const res = await fetch(`${API_BASE}/keys?prefix=${prefix}&limit=1000`, {
                headers: this.headers
            });
            if (!res.ok) return [];
            const data = await res.json() as KeysResponse;
            return data.keys;
        } catch (e) {
            console.error('Failed to list keys', e);
            return [];
        }
    }

    private async getKeyMetadata(key: string): Promise<KeyMetadata | null> {
        // Efficiently check if a key exists and get its metadata by listing with prefix
        // Or we could just try to get it, but GET downloads content.
        // The list API returns metadata.
        // Since we don't have a HEAD endpoint, list is better for checking timestamps without downloading.
        // However, for a single key, list might be overkill if we have many keys.
        // But for 'settings', it's fine.
        try {
            const res = await fetch(`${API_BASE}/keys?prefix=${key}&limit=1`, {
                headers: this.headers
            });
            if (!res.ok) return null;
            const data = await res.json() as KeysResponse;
            return data.keys.find(k => k.key === key) || null;
        } catch (e) {
            return null;
        }
    }

    private async getValue<T>(key: string): Promise<T | null> {
        try {
            const res = await fetch(`${API_BASE}/get/${key}`, {
                headers: this.headers
            });
            if (!res.ok) return null;
            return await res.json();
        } catch (e) {
            console.error(`Failed to get value for ${key}`, e);
            return null;
        }
    }

    private async setValue(key: string, value: any) {
        try {
            await fetch(`${API_BASE}/set/${key}`, {
                method: 'POST',
                headers: {
                    ...this.headers,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(value)
            });
        } catch (e) {
            console.error(`Failed to set value for ${key}`, e);
        }
    }


}

export const syncService = new SyncService();
