import type { Endpoint, Model } from '../stores/settings';
import type { Message, ToolCall, ToolResult, EnabledMcpTool } from '../stores/chat';
import { useSettingsStore } from '../stores/settings';
import { useChatStore } from '../stores/chat';
import { getMcpClient, type McpTool } from './mcp';
import { clientTools, handleClientToolCall } from './clientTools';
import { parsePartialJson } from '../utils/partialJson';
import { fetch } from '@tauri-apps/plugin-http';

export interface UpdatePayload {
  content?: string;
  reasoning?: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export interface SamplerSettings {
  temperature?: number;
  topP?: number;
  topK?: number;
  minP?: number;
}

export async function sendMessage(
  endpoint: Endpoint,
  model: Model,
  messages: Message[],
  settings: SamplerSettings,
  onUpdate: (payload: UpdatePayload) => void,
  sessionId: string,
  enabledMcpTools?: EnabledMcpTool[], // Tools enabled for this specific chat
  signal?: AbortSignal
) {
  const settingsStore = useSettingsStore();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (endpoint.apiKey) {
    headers['Authorization'] = `Bearer ${endpoint.apiKey}`;
  }

  // Prepare messages
  const apiMessages: any[] = [];

  for (const m of messages) {
    // Handle assistant messages with parts (interleaved tools/content)
    if (m.role === 'assistant' && m.parts && m.parts.length > 0) {
      let pendingContent = '';
      let pendingToolCalls: any[] = [];

      for (const part of m.parts) {
        if (part.type === 'text' && part.content) {
          pendingContent += part.content;
        } else if (part.type === 'tool-call' && part.toolCall) {
          pendingToolCalls.push({
            id: part.toolCall.id,
            type: 'function',
            function: {
              name: part.toolCall.name,
              arguments: JSON.stringify(part.toolCall.arguments)
            }
          });
        } else if (part.type === 'tool-result' && part.toolResult) {
          // Flush pending assistant message
          apiMessages.push({
            role: 'assistant',
            content: pendingContent || null,
            tool_calls: pendingToolCalls.length > 0 ? pendingToolCalls : undefined
          });

          pendingContent = '';
          pendingToolCalls = [];

          // Add tool result
          const toolName = m.parts.find(p => p.type === 'tool-call' && p.toolCall?.id === part.toolResult?.callId)?.toolCall?.name;

          let content = typeof part.toolResult.result === 'string' ? part.toolResult.result : JSON.stringify(part.toolResult.result);
          if (toolName === 'read_artifact') {
            content = '(Artifact content hidden to save context. Read again if needed.)';
          }

          apiMessages.push({
            role: 'tool',
            tool_call_id: part.toolResult.callId,
            name: toolName,
            content: content
          });
        }
      }

      // Flush remaining
      if (pendingContent || pendingToolCalls.length > 0) {
        apiMessages.push({
          role: 'assistant',
          content: pendingContent || null,
          tool_calls: pendingToolCalls.length > 0 ? pendingToolCalls : undefined
        });
      }

      continue;
    }

    let content: any = m.content;

    // Handle attachments
    if (m.attachments && m.attachments.length > 0) {
      const hasImages = m.attachments.some(a => a.type.startsWith('image/'));
      if (hasImages) {
        const contentParts: any[] = [];
        if (m.content) {
          contentParts.push({ type: 'text', text: m.content });
        }
        for (const att of m.attachments) {
          if (att.type.startsWith('image/')) {
            contentParts.push({
              type: 'image_url',
              image_url: { url: att.content }
            });
          } else {
            contentParts.push({
              type: 'text',
              text: `\n\n--- File: ${att.name} ---\n${att.content}\n`
            });
          }
        }
        content = contentParts;
      } else {
        let newContent = m.content || '';
        for (const att of m.attachments) {
          newContent += `\n\n--- File: ${att.name} ---\n${att.content}\n`;
        }
        content = newContent;
      }
    }

    const apiMsg: any = {
      role: m.role,
      content: content
    };

    if (m.toolCalls) {
      apiMsg.tool_calls = m.toolCalls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments)
        }
      }));
    }

    apiMessages.push(apiMsg);

    if (m.toolResults) {
      for (const res of m.toolResults) {
        const toolName = m.toolCalls?.find(tc => tc.id === res.callId)?.name;
        let content = typeof res.result === 'string' ? res.result : JSON.stringify(res.result);

        if (toolName === 'read_artifact') {
          content = '(Artifact content hidden to save context. Read again if needed.)';
        }

        apiMessages.push({
          role: 'tool',
          tool_call_id: res.callId,
          name: toolName,
          content: content
        });
      }
    }
  }

  // Prepare tools if supported
  let tools: any[] = [];
  const mcpToolsMap = new Map<string, { serverId: string, tool: McpTool }>();
  const clientToolNames = new Set(clientTools.map(t => t.function.name));

  if (model.supportsFunctionCalling) {
    // Add client tools
    tools.push(...clientTools);

    // Use enabled tools from chat session if provided, otherwise use all enabled servers
    if (enabledMcpTools && enabledMcpTools.length > 0) {
      // Load only the tools specified for this chat
      for (const enabledTool of enabledMcpTools) {
        const server = settingsStore.mcpServers.find(s => s.id === enabledTool.serverId && s.enabled);
        if (!server) continue;

        try {
          const client = await getMcpClient(server);
          const serverTools = await client.listTools();

          for (const tool of serverTools) {
            // If toolNames is empty, all tools are enabled
            const isToolEnabled = enabledTool.toolNames.length === 0 ||
              enabledTool.toolNames.includes(tool.name);

            if (isToolEnabled) {
              mcpToolsMap.set(tool.name, { serverId: server.id, tool });

              tools.push({
                type: 'function',
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.inputSchema
                }
              });
            }
          }
        } catch (e) {
          console.error(`Failed to load tools from MCP server ${server.name}:`, e);
        }
      }
    } else {
      // Fallback: Load all tools from all enabled servers (backward compatibility)
      const enabledServers = settingsStore.mcpServers.filter(s => s.enabled);

      for (const server of enabledServers) {
        try {
          const client = await getMcpClient(server);
          const serverTools = await client.listTools();

          for (const tool of serverTools) {
            mcpToolsMap.set(tool.name, { serverId: server.id, tool });

            tools.push({
              type: 'function',
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema
              }
            });
          }
        } catch (e) {
          console.error(`Failed to load tools from MCP server ${server.name}:`, e);
        }
      }
    }
  }

  // Main loop for tool calling
  let currentMessages = [...apiMessages];
  let keepGoing = true;
  let loopCount = 0;
  const MAX_LOOPS = 5;

  while (keepGoing && loopCount < MAX_LOOPS) {
    loopCount++;
    keepGoing = false;

    const body: any = {
      model: model.id,
      messages: currentMessages,
      temperature: settings.temperature,
      top_p: settings.topP,
      top_k: settings.topK,
      min_p: settings.minP,
      stream: true,
    };

    if (tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const response = await fetch(`${endpoint.url}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API Error: ${response.status} - ${error}`);
    }

    if (!response.body) throw new Error('No response body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    let assistantMessageContent = '';
    let toolCalls: any[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (trimmed.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            const delta = data.choices?.[0]?.delta;

            if (delta?.reasoning_content) {
              onUpdate({ reasoning: delta.reasoning_content });
            }

            if (delta?.content) {
              assistantMessageContent += delta.content;
              onUpdate({ content: delta.content });
            }

            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (tc.index !== undefined) {
                  if (!toolCalls[tc.index]) {
                    toolCalls[tc.index] = {
                      id: tc.id,
                      type: 'function',
                      function: { name: '', arguments: '' }
                    };
                  }
                  const current = toolCalls[tc.index];
                  if (tc.id) current.id = tc.id;
                  if (tc.function?.name) current.function.name += tc.function.name;
                  if (tc.function?.arguments) current.function.arguments += tc.function.arguments;

                  // Streaming Artifact Update
                  if (current.function.name === 'create_artifact' || current.function.name === 'update_artifact') {
                    try {
                      const partialArgs = parsePartialJson(current.function.arguments);
                      if (partialArgs && (partialArgs.content || partialArgs.title)) {
                        const chatStore = useChatStore();
                        if (partialArgs.id) {
                          // We need to construct a partial artifact
                          // But createArtifact expects a full Artifact object or we need a new method.
                          // However, we modified createArtifact to handle upserts.
                          // So we can pass what we have.
                          // We need to ensure we don't overwrite with undefined.
                          // The upsert logic in chat.ts checks for fields presence.

                          // Construct a partial object that satisfies the type but has undefineds
                          // We can cast it.
                          const artifactUpdate: any = {
                            id: partialArgs.id,
                            title: partialArgs.title,
                            type: partialArgs.type,
                            content: partialArgs.content,
                            // We don't have createdAt/updatedAt here, store handles updatedAt
                          };

                          // Only call if we have an ID
                          if (artifactUpdate.id) {
                            chatStore.createArtifact(sessionId, artifactUpdate, true);
                          }
                        }
                      }
                    } catch (e) {
                      // Ignore parse errors during streaming
                    }
                  }
                }
              }
            }
          } catch (e) {
            console.error('Error parsing chunk', e);
          }
        }
      }
    }

    // If we have tool calls, execute them and loop
    if (toolCalls.length > 0) {
      console.log('Executing tool calls:', toolCalls);
      keepGoing = true;

      // Parse tool calls for storage
      const parsedToolCalls: ToolCall[] = toolCalls.map(tc => {
        let args = {};
        try {
          args = JSON.parse(tc.function.arguments);
        } catch (e) {
          console.error('Failed to parse tool arguments', e);
        }
        return {
          id: tc.id,
          name: tc.function.name,
          arguments: args
        };
      });

      // Update the assistant message with tool calls
      onUpdate({ toolCalls: parsedToolCalls });

      // Add assistant message with tool calls to history for next request
      currentMessages.push({
        role: 'assistant',
        content: assistantMessageContent || null,
        tool_calls: toolCalls
      } as any);

      // Execute tools
      const toolResults: ToolResult[] = [];
      for (const call of parsedToolCalls) {
        const toolName = call.name;
        const args = call.arguments;

        let result = '';
        let isError = false;
        const mcpTool = mcpToolsMap.get(toolName);

        if (clientToolNames.has(toolName)) {
          try {
            result = await handleClientToolCall(toolName, args, sessionId);
          } catch (e: any) {
            result = `Error executing client tool: ${e.message}`;
            isError = true;
          }
        } else if (mcpTool) {
          try {
            const server = settingsStore.mcpServers.find(s => s.id === mcpTool.serverId);
            if (server) {
              const client = await getMcpClient(server);
              const toolResult = await client.callTool(toolName, args);

              // Format result
              if (toolResult.content) {
                result = toolResult.content.map((c: any) => {
                  if (c.type === 'text') return c.text;
                  return JSON.stringify(c);
                }).join('\n');
              } else {
                result = JSON.stringify(toolResult);
              }
            } else {
              result = 'Error: MCP Server not found';
              isError = true;
            }
          } catch (e: any) {
            result = `Error calling tool: ${e.message}`;
            isError = true;
          }
        } else {
          result = `Error: Tool ${toolName} not found`;
          isError = true;
        }

        const toolResult: ToolResult = {
          callId: call.id,
          result: result,
          isError
        };
        toolResults.push(toolResult);

        // Add to history for next request
        currentMessages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: toolName,
          content: result
        } as any);
      }

      // Update the assistant message with tool results
      onUpdate({ toolResults });
    }
  }
}
