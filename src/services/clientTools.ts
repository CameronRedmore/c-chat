import { useChatStore } from '../stores/chat';

export const clientTools = [
    {
        type: 'function',
        function: {
            name: 'create_artifact',
            description: 'Create a new artifact (virtual file) in the chat. Use this to generate code, HTML, or other content that should be displayed in a separate pane.',
            parameters: {
                type: 'object',
                properties: {
                    id: {
                        type: 'string',
                        description: 'Unique identifier for the artifact (e.g., "weather-app", "todo-list-script").'
                    },
                    type: {
                        type: 'string',
                        description: 'MIME type of the content (e.g., "text/html", "application/javascript", "text/markdown").'
                    },
                    title: {
                        type: 'string',
                        description: 'Title of the artifact.'
                    },
                    content: {
                        type: 'string',
                        description: 'The content of the artifact.'
                    }
                },
                required: ['id', 'type', 'title', 'content']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'update_artifact',
            description: 'Update the content of an existing artifact.',
            parameters: {
                type: 'object',
                properties: {
                    id: {
                        type: 'string',
                        description: 'The ID of the artifact to update.'
                    },
                    content: {
                        type: 'string',
                        description: 'The new content of the artifact.'
                    }
                },
                required: ['id', 'content']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'list_artifacts',
            description: 'List all artifacts available in the current chat session.',
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
            name: 'read_artifact',
            description: 'Read the content of a specific artifact.',
            parameters: {
                type: 'object',
                properties: {
                    id: {
                        type: 'string',
                        description: 'The ID of the artifact to read.'
                    }
                },
                required: ['id']
            }
        }
    }
];

export async function handleClientToolCall(name: string, args: any, sessionId: string): Promise<string> {
    const chatStore = useChatStore();

    if (name === 'create_artifact') {
        try {
            chatStore.createArtifact(sessionId, {
                id: args.id,
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

    if (name === 'list_artifacts') {
        const session = chatStore.sessions.find(s => s.id === sessionId);
        if (!session || !session.artifacts || session.artifacts.length === 0) {
            return JSON.stringify([]);
        }
        return JSON.stringify(session.artifacts.map(a => ({
            id: a.id,
            title: a.title,
            type: a.type,
            createdAt: a.createdAt
        })));
    }

    if (name === 'read_artifact') {
        const session = chatStore.sessions.find(s => s.id === sessionId);
        if (!session) return 'Error: Session not found.';

        const artifact = session.artifacts?.find(a => a.id === args.id);
        if (!artifact) return `Error: Artifact with ID "${args.id}" not found.`;

        return artifact.content;
    }

    throw new Error(`Unknown client tool: ${name}`);
}
