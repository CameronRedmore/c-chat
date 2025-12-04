import { invoke } from '@tauri-apps/api/core';
import { useChatStore } from '../stores/chat';
import { useSettingsStore } from '../stores/settings';

export class BackupService {
    private static instance: BackupService;

    private constructor() { }

    public static getInstance(): BackupService {
        if (!BackupService.instance) {
            BackupService.instance = new BackupService();
        }
        return BackupService.instance;
    }

    public async backup(): Promise<boolean> {
        try {
            const chatStore = useChatStore();
            const settingsStore = useSettingsStore();

            // 1. Gather Data
            const backupData = {
                version: 1,
                timestamp: Date.now(),
                chats: {
                    sessions: chatStore.sessions,
                    projects: chatStore.projects,
                    deletedSessions: chatStore.deletedSessions,
                    deletedProjects: chatStore.deletedProjects,
                },
                settings: {
                    endpoints: settingsStore.endpoints,
                    models: settingsStore.models,
                    systemPrompts: settingsStore.systemPrompts,
                    mcpServers: settingsStore.mcpServers,
                }
            };

            // 2. Serialize
            const jsonString = JSON.stringify(backupData);
            const jsonBytes = new TextEncoder().encode(jsonString);

            // 3. Compress (Rust)
            // Pass Uint8Array directly
            const compressedBytes = await invoke<number[]>('compress_data', { data: jsonBytes });

            // 4. Download via Web API
            const blob = new Blob([new Uint8Array(compressedBytes)], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `c-chat-backup-${new Date().toISOString().split('T')[0]}.ccbk`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            return true;
        } catch (error) {
            console.error('Backup failed:', error);
            throw error;
        }
    }

    public async restore(): Promise<boolean> {
        return new Promise((resolve, reject) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.ccbk';
            input.style.display = 'none';

            input.onchange = async (e: any) => {
                try {
                    const file = e.target.files[0];
                    if (!file) {
                        resolve(false);
                        return;
                    }

                    const arrayBuffer = await file.arrayBuffer();
                    const compressedBytes = new Uint8Array(arrayBuffer);

                    // 3. Decompress (Rust)
                    const jsonBytes = await invoke<number[]>('decompress_data', { data: compressedBytes });
                    const jsonString = new TextDecoder().decode(new Uint8Array(jsonBytes));
                    const data = JSON.parse(jsonString);

                    // 4. Validate & Restore
                    if (!data.version || !data.chats || !data.settings) {
                        throw new Error('Invalid backup file format');
                    }

                    const chatStore = useChatStore();
                    const settingsStore = useSettingsStore();

                    // Restore Chats
                    if (data.chats.sessions) chatStore.sessions = data.chats.sessions;
                    if (data.chats.projects) chatStore.projects = data.chats.projects;
                    if (data.chats.deletedSessions) chatStore.deletedSessions = data.chats.deletedSessions;
                    if (data.chats.deletedProjects) chatStore.deletedProjects = data.chats.deletedProjects;
                    await chatStore.save();

                    // Restore Settings
                    if (data.settings.endpoints) settingsStore.endpoints = data.settings.endpoints;
                    if (data.settings.models) settingsStore.models = data.settings.models;
                    if (data.settings.systemPrompts) settingsStore.systemPrompts = data.settings.systemPrompts;
                    if (data.settings.mcpServers) settingsStore.mcpServers = data.settings.mcpServers;
                    await settingsStore.save();

                    resolve(true);
                } catch (error) {
                    console.error('Restore failed:', error);
                    reject(error);
                }
            };

            // Handle cancellation somewhat? 
            // It's hard to detect cancel on input type=file. 
            // The promise will just hang if user cancels. 
            // The UI will stay in "Restoring..." state.
            // This is a known limitation of this approach.

            input.click();
        });
    }
}

export const backupService = BackupService.getInstance();
