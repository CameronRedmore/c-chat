import { defineStore } from 'pinia';
import { ref } from 'vue';

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'success';

export const useSyncStore = defineStore('sync', () => {
    const isSyncing = ref(false);
    const lastSyncTime = ref<number>(0);
    const error = ref<string | null>(null);
    const status = ref<SyncStatus>('idle');

    function setSyncing(value: boolean) {
        isSyncing.value = value;
        if (value) {
            status.value = 'syncing';
            error.value = null;
        }
    }

    function setSuccess() {
        isSyncing.value = false;
        status.value = 'success';
        lastSyncTime.value = Date.now();
        error.value = null;
    }

    function setError(msg: string) {
        isSyncing.value = false;
        status.value = 'error';
        error.value = msg;
    }

    function setIdle() {
        if (status.value !== 'error') {
            status.value = 'idle';
        }
    }

    return {
        isSyncing,
        lastSyncTime,
        error,
        status,
        setSyncing,
        setSuccess,
        setError,
        setIdle
    };
});
