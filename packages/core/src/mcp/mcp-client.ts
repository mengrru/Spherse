import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { TextContent, ImageContent } from "@earendil-works/pi-ai";
import type { Logger } from "../logger.js";
import { createSilentLogger } from "../logger.js";
import { makeMcpToolName } from "./config.js";
import { jsonSchemaToTypebox } from "./json-schema-to-typebox.js";
import type { McpServerConfig } from "./types.js";

const CLIENT_INFO = { name: "spherse", version: "1.0.0" } as const;

export interface McpConnection {
  readonly serverName: string;
  close(): Promise<void>;
}

interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

type CallToolFn = (params: {
  name: string;
  arguments?: Record<string, unknown>;
}, signal?: AbortSignal) => Promise<McpCallToolResult>;

interface McpCallToolResult {
  content?: Array<Record<string, unknown>>;
  isError?: boolean;
}

function mapMcpContent(content: unknown, isError: boolean): (TextContent | ImageContent)[] {
  if (!Array.isArray(content)) {
    return [{ type: "text", text: isError ? "MCP tool error" : "" }];
  }
  const out: (TextContent | ImageContent)[] = [];
  for (const part of content) {
    if (typeof part !== "object" || part === null) continue;
    const type = (part as { type?: string }).type;
    if (type === "text") {
      const text = (part as { text?: string }).text ?? "";
      out.push({ type: "text", text });
    } else if (type === "image") {
      const data = (part as { data?: string }).data;
      const mimeType = (part as { mimeType?: string }).mimeType ?? "image/png";
      if (typeof data === "string") {
        out.push({ type: "image", data, mimeType });
      }
    } else {
      out.push({ type: "text", text: JSON.stringify(part) });
    }
  }
  if (out.length === 0) {
    out.push({ type: "text", text: isError ? "MCP tool error" : "" });
  }
  return out;
}

export function adaptMcpTool(
  serverName: string,
  serverId: string,
  tool: McpToolDescriptor,
  callTool: CallToolFn,
): AgentTool {
  const parameters = jsonSchemaToTypebox(tool.inputSchema);
  const name = makeMcpToolName(serverName, serverId, tool.name);
  const description =
    tool.description?.trim() || `MCP tool "${tool.name}" from server "${serverName}"`;

  return {
    name,
    label: `${serverName} / ${tool.name}`,
    description,
    parameters,
    async execute(_toolCallId, params, signal) {
      try {
        const result = await callTool({
          name: tool.name,
          arguments: params as Record<string, unknown>,
        }, signal);
        const isError = result.isError === true;
        const content = mapMcpContent(result.content, isError);
        if (isError) {
          const text = content.map((c) => (c.type === "text" ? c.text : "")).join("\n") || "MCP tool error";
          return {
            content: [{ type: "text" as const, text: `MCP tool "${tool.name}" failed: ${text}` }],
            details: { server: serverName, tool: tool.name, error: text },
          };
        }
        return {
          content,
          details: { server: serverName, tool: tool.name },
        };
      } catch (err) {
        const text = (err as Error).message ?? String(err);
        return {
          content: [{ type: "text" as const, text: `MCP tool "${tool.name}" failed: ${text}` }],
          details: { server: serverName, tool: tool.name, error: text },
        };
      }
    },
  };
}

function buildTransport(config: McpServerConfig): StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport {
  if (config.transport === "stdio") {
    return new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env,
      stderr: "pipe",
    });
  }
  let url: URL;
  try {
    url = new URL(config.url);
  } catch {
    throw new Error(`invalid MCP server url: ${config.url}`);
  }
  const requestInit: RequestInit = config.headers
    ? { headers: config.headers }
    : {};
  if (config.transport === "http") {
    return new StreamableHTTPClientTransport(url, { requestInit });
  }
  return new SSEClientTransport(url, { requestInit });
}

export interface ConnectResult {
  connection: McpConnection;
  tools: AgentTool[];
}

export async function connectMcpServer(
  config: McpServerConfig,
  logger?: Logger,
): Promise<ConnectResult> {
  const log = logger ?? createSilentLogger();
  const transport = buildTransport(config);
  const client = new Client(CLIENT_INFO, { capabilities: {} });

  try {
    await client.connect(transport);
  } catch (err) {
    try {
      await client.close();
    } catch {
      // best-effort cleanup of any partially-spawned transport
    }
    throw err;
  }
  log.info({ server: config.name, transport: config.transport }, "mcp server connected");

  let toolDescriptors: McpToolDescriptor[] = [];
  try {
    const response = (await client.listTools()) as { tools?: McpToolDescriptor[] };
    toolDescriptors = Array.isArray(response.tools) ? response.tools : [];
  } catch (err) {
    log.warn({ err, server: config.name }, "mcp server listTools failed");
  }

  const tools = toolDescriptors.map((tool) =>
    adaptMcpTool(config.name, config.id, tool, (params, signal) =>
      client.callTool(params, undefined, signal ? { signal } : undefined) as Promise<McpCallToolResult>,
    ),
  );

  return {
    connection: {
      get serverName() {
        return config.name;
      },
      async close() {
        try {
          await client.close();
        } catch (err) {
          log.warn({ err, server: config.name }, "mcp server close failed");
        }
      },
    },
    tools,
  };
}
