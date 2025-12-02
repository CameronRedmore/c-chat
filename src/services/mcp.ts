import { invoke } from '@tauri-apps/api/core';
import { type McpServer } from '../stores/settings';

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: any;
}

export class McpClient {
  constructor(public server: McpServer) {}

  async connect(): Promise<void> {
    console.log(`Connecting to MCP server ${this.server.name} at ${this.server.url} via ${this.server.transport}`);
    await invoke('mcp_connect', {
      id: this.server.id,
      url: this.server.url,
      transport: this.server.transport
    });
  }

  disconnect() {
    // No explicit disconnect needed for now as Rust manages state, 
    // but we could add a command if needed.
  }

  async listTools(): Promise<McpTool[]> {
    const res: any = await invoke('mcp_list_tools', {
      id: this.server.id
    });
    return res.tools || [];
  }

  async callTool(name: string, args: any): Promise<any> {
    const res = await invoke('mcp_call_tool', {
      id: this.server.id,
      name,
      args
    });
    return res;
  }
}

const activeClients = new Map<string, McpClient>();

export async function getMcpClient(server: McpServer): Promise<McpClient> {
  if (activeClients.has(server.id)) {
    const client = activeClients.get(server.id)!;
    // We assume Rust side handles reconnection if needed or we just reuse the client wrapper
    return client;
  }

  const client = new McpClient(server);
  await client.connect();
  activeClients.set(server.id, client);
  return client;
}

export function disconnectAllMcpClients() {
  activeClients.clear();
}