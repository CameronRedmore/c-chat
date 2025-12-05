import { useChatStore } from '../stores/chat';

export const clientTools = [
    {
        type: 'function',
        function: {
            name: 'create_file',
            description: 'Create a new file in the virtual workspace.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'The path of the file to create (e.g., "src/components/Button.tsx", "public/index.html").'
                    },
                    type: {
                        type: 'string',
                        description: 'MIME type of the content (e.g., "text/html", "application/javascript", "text/markdown").'
                    },
                    content: {
                        type: 'string',
                        description: 'The content of the file.'
                    }
                },
                required: ['path', 'type', 'content']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'update_file',
            description: 'Update the content of an existing file.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'The path of the file to update.'
                    },
                    content: {
                        type: 'string',
                        description: 'The new content of the file.'
                    }
                },
                required: ['path', 'content']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'list_files',
            description: 'List all files in the virtual workspace.',
            parameters: {
                type: 'object',
                properties: {},
                required: []
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'read_file',
            description: 'Read the content of a specific file.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'The path of the file to read.'
                    }
                },
                required: ['path']
            }
        }
    },
    // Compatibility aliases
    {
        type: 'function',
        function: {
            name: 'create_artifact',
            description: 'Deprecated. Use create_file instead.',
            parameters: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    type: { type: 'string' },
                    title: { type: 'string' },
                    content: { type: 'string' }
                },
                required: ['id', 'type', 'title', 'content']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'update_artifact',
            description: 'Deprecated. Use update_file instead.',
            parameters: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    content: { type: 'string' }
                },
                required: ['id', 'content']
            }
        }
    }
];

export async function handleClientToolCall(name: string, args: any, sessionId: string): Promise<string> {
    const chatStore = useChatStore();

    if (name === 'create_file') {
        try {
            // Use path as ID for simplicity in new mode
            chatStore.createArtifact(sessionId, {
                id: args.path, // path is unique ID for new files
                path: args.path,
                type: args.type,
                title: args.path.split('/').pop() || args.path,
                content: args.content,
                createdAt: Date.now(),
                updatedAt: Date.now()
            });
            return `File "${args.path}" created successfully.`;
        } catch (e: any) {
            return `Error creating file: ${e.message}`;
        }
    }

    if (name === 'update_file') {
        try {
            chatStore.updateArtifact(sessionId, args.path, args.content);
            return `File "${args.path}" updated successfully.`;
        } catch (e: any) {
            return `Error updating file: ${e.message}`;
        }
    }

    if (name === 'list_files' || name === 'list_artifacts') {
        const artifacts = chatStore.getArtifactsForSession(sessionId);
        if (artifacts.length === 0) {
            return JSON.stringify([]);
        }
        return JSON.stringify(artifacts.map(a => ({
            path: a.path,
            type: a.type,
            createdAt: a.createdAt
        })));
    }

    if (name === 'read_file') {
        const artifacts = chatStore.getArtifactsForSession(sessionId);
        const artifact = artifacts.find(a => a.path === args.path || a.id === args.path);

        if (!artifact) return `Error: File with path "${args.path}" not found.`;

        return artifact.content;
    }

    // Legacy handlers
    if (name === 'create_artifact') {
        try {
            chatStore.createArtifact(sessionId, {
                id: args.id,
                path: args.id, // Fallback path
                type: args.type,
                title: args.title,
                content: args.content,
                createdAt: Date.now(),
                updatedAt: Date.now()
            });
            return `Artifact "${args.title}" created successfully.`;
        } catch (e: any) {
            return `Error creating artifact: ${e.message}`;
        }
    }

    if (name === 'update_artifact') {
        try {
            chatStore.updateArtifact(sessionId, args.id, args.content);
            return `Artifact updated successfully.`;
        } catch (e: any) {
            return `Error updating artifact: ${e.message}`;
        }
    }

    if (name === 'read_artifact') {
        const artifacts = chatStore.getArtifactsForSession(sessionId);
        const artifact = artifacts.find(a => a.id === args.id);
        if (!artifact) return `Error: Artifact with ID "${args.id}" not found.`;
        return artifact.content;
    }

    throw new Error(`Unknown client tool: ${name}`);
}
