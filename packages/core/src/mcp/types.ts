export type McpTransportType = "stdio" | "http" | "sse";

export interface McpServerConfigBase {
  id: string;
  name: string;
  enabled: boolean;
}

export interface McpStdioServerConfig extends McpServerConfigBase {
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface McpHttpServerConfig extends McpServerConfigBase {
  transport: "http";
  url: string;
  headers?: Record<string, string>;
}

export interface McpSseServerConfig extends McpServerConfigBase {
  transport: "sse";
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig =
  | McpStdioServerConfig
  | McpHttpServerConfig
  | McpSseServerConfig;

export interface AgentMcpConfig {
  servers: McpServerConfig[];
}

export const EMPTY_MCP_CONFIG: AgentMcpConfig = { servers: [] };
