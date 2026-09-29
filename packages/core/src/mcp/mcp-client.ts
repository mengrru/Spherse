import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { TextContent, ImageContent } from "@earendil-works/pi-ai";
import type { Logger } from "../logger.js";
import { createSilentLogger } from "../logger.js";
import { makeMcpToolName } from "./config.js";
import { jsonSchemaToTypebox } from "./json-schema-to-typebox.js";
import type {
  McpServerConfig,
  McpServerInfo,
  McpResourceDescriptor,
  McpResourceTemplateDescriptor,
  McpPromptDescriptor,
} from "./types.js";

const CLIENT_INFO = { name: "spherse", version: "1.0.0" } as const;

export interface McpConnection {
  readonly serverName: string;
  readonly closed: boolean;
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

type ReadResourceFn = (
  uri: string,
  signal?: AbortSignal,
) => Promise<McpReadResourceResult>;

interface McpReadResourceResult {
  contents?: Array<{ uri: string; text?: string; blob?: string; mimeType?: string }>;
}

type GetPromptFn = (
  params: { name: string; arguments?: Record<string, string> },
  signal?: AbortSignal,
) => Promise<McpGetPromptResult>;

interface McpGetPromptResult {
  description?: string;
  messages?: Array<{ role: string; content: unknown }>;
}

const IMAGE_MIME_RE = /^image\//;
const CONNECT_TIMEOUT_MS = 15_000;

function abortError(serverName: string): Error {
  return new Error(`mcp server connect budget exceeded for "${serverName}"`);
}

function abortGuard(signal: AbortSignal | undefined, serverName: string): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal?.aborted) reject(abortError(serverName));
    else signal?.addEventListener("abort", () => reject(abortError(serverName)), { once: true });
  });
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

export function adaptMcpReadResourceTool(
  serverName: string,
  serverId: string,
  readResource: ReadResourceFn,
): AgentTool {
  const name = makeMcpToolName(serverName, serverId, "read_resource");
  return {
    name,
    label: `${serverName} / read_resource`,
    description: `Read a resource from MCP server "${serverName}" by its URI. Use the URIs listed in the <mcp-context> system prompt section.`,
    parameters: Type.Object({ uri: Type.String() }),
    async execute(_toolCallId, params, signal) {
      const uri = (params as { uri: string }).uri;
      try {
        const result = await readResource(uri, signal);
        const contents = Array.isArray(result.contents) ? result.contents : [];
        const content = mapReadResourceContents(contents);
        if (content.length === 0) {
          content.push({ type: "text", text: `Resource "${uri}" returned no content` });
        }
        return {
          content,
          details: { server: serverName, uri },
        };
      } catch (err) {
        const text = (err as Error).message ?? String(err);
        return {
          content: [{ type: "text" as const, text: `read_resource "${uri}" failed: ${text}` }],
          details: { server: serverName, uri, error: text },
        };
      }
    },
  };
}

function mapReadResourceContents(
  contents: Array<{ uri: string; text?: string; blob?: string; mimeType?: string }>,
): (TextContent | ImageContent)[] {
  const out: (TextContent | ImageContent)[] = [];
  for (const c of contents) {
    if (typeof c.text === "string") {
      out.push({ type: "text", text: c.text });
    } else if (typeof c.blob === "string") {
      const mimeType = c.mimeType ?? "application/octet-stream";
      if (IMAGE_MIME_RE.test(mimeType)) {
        out.push({ type: "image", data: c.blob, mimeType });
      } else {
        out.push({ type: "text", text: `data:${mimeType};base64,${c.blob}` });
      }
    }
  }
  return out;
}

export function adaptMcpGetPromptTool(
  serverName: string,
  serverId: string,
  getPrompt: GetPromptFn,
): AgentTool {
  const name = makeMcpToolName(serverName, serverId, "get_prompt");
  return {
    name,
    label: `${serverName} / get_prompt`,
    description: `Get a prompt from MCP server "${serverName}" by name. Use the prompt names listed in the <mcp-context> system prompt section.`,
    parameters: Type.Object({
      name: Type.String(),
      arguments: Type.Optional(Type.Record(Type.String(), Type.String())),
    }),
    async execute(_toolCallId, params, signal) {
      const promptName = (params as { name: string }).name;
      const args = (params as { arguments?: Record<string, string> }).arguments;
      try {
        const result = await getPrompt(
          { name: promptName, arguments: args },
          signal,
        );
        const messages = Array.isArray(result.messages) ? result.messages : [];
        const parts: string[] = [`[prompt: ${serverName}/${promptName}]`];
        if (result.description) {
          parts.push(`description: ${result.description}`);
        }
        for (const msg of messages) {
          const role = msg.role ?? "unknown";
          const body = serializePromptContent(msg.content);
          parts.push(`<${role}>\n${body}\n</${role}>`);
        }
        const text = parts.join("\n");
        return {
          content: [{ type: "text" as const, text }],
          details: { server: serverName, prompt: promptName },
        };
      } catch (err) {
        const text = (err as Error).message ?? String(err);
        return {
          content: [{ type: "text" as const, text: `get_prompt "${promptName}" failed: ${text}` }],
          details: { server: serverName, prompt: promptName, error: text },
        };
      }
    },
  };
}

function serializePromptContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (typeof content === "object" && content !== null) {
    const obj = content as { type?: string; text?: string };
    if (obj.type === "text" && typeof obj.text === "string") return obj.text;
  }
  return JSON.stringify(content);
}

function cleanEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function buildTransport(config: McpServerConfig): StdioClientTransport | StreamableHTTPClientTransport {
  if (config.transport === "stdio") {
    return new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: { ...cleanEnv(process.env), ...config.env },
      cwd: config.cwd,
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
  return new StreamableHTTPClientTransport(url, { requestInit });
}

export interface ConnectResult {
  connection: McpConnection;
  tools: AgentTool[];
  info: McpServerInfo;
}

type McpClient = InstanceType<typeof Client>;

async function tryList<T>(
  fetch: () => Promise<T[]>,
  serverName: string,
  label: string,
  log: Logger,
): Promise<T[]> {
  try {
    return await fetch();
  } catch (err) {
    log.warn({ err, server: serverName }, `mcp server ${label} failed`);
    return [];
  }
}

function listOptions(signal: AbortSignal | undefined): { signal: AbortSignal } | undefined {
  return signal ? { signal } : undefined;
}

async function tryListTools(
  client: McpClient,
  serverName: string,
  log: Logger,
  signal?: AbortSignal,
): Promise<McpToolDescriptor[]> {
  return tryList(
    async () => {
      const response = (await client.listTools(undefined, listOptions(signal))) as {
        tools?: McpToolDescriptor[];
      };
      return Array.isArray(response.tools) ? response.tools : [];
    },
    serverName,
    "listTools",
    log,
  );
}

async function tryListResources(
  client: McpClient,
  serverName: string,
  log: Logger,
  signal?: AbortSignal,
): Promise<{ resources: McpResourceDescriptor[]; resourceTemplates: McpResourceTemplateDescriptor[] }> {
  const resources = await tryList(
    async () => {
      const res = (await client.listResources(undefined, listOptions(signal))) as {
        resources?: McpResourceDescriptor[];
      };
      return Array.isArray(res.resources) ? res.resources : [];
    },
    serverName,
    "listResources",
    log,
  );
  const resourceTemplates = await tryList(
    async () => {
      const res = (await client.listResourceTemplates(undefined, listOptions(signal))) as {
        resourceTemplates?: McpResourceTemplateDescriptor[];
      };
      return Array.isArray(res.resourceTemplates) ? res.resourceTemplates : [];
    },
    serverName,
    "listResourceTemplates",
    log,
  );
  return { resources, resourceTemplates };
}

async function tryListPrompts(
  client: McpClient,
  serverName: string,
  log: Logger,
  signal?: AbortSignal,
): Promise<McpPromptDescriptor[]> {
  return tryList(
    async () => {
      const res = (await client.listPrompts(undefined, listOptions(signal))) as {
        prompts?: McpPromptDescriptor[];
      };
      return Array.isArray(res.prompts) ? res.prompts : [];
    },
    serverName,
    "listPrompts",
    log,
  );
}

export interface ConnectServerOptions {
  signal?: AbortSignal;
  onDisconnect?: () => void;
}

const STDERR_BUFFER_LIMIT = 8 * 1024;
const CLOSE_TIMEOUT_MS = 5_000;

function closeQuietly(client: McpClient, serverName: string, log: Logger): Promise<void> {
  return Promise.race([
    client.close().catch((err) => {
      log.warn({ err, server: serverName }, "mcp server close failed");
    }),
    new Promise<void>((resolve) => setTimeout(resolve, CLOSE_TIMEOUT_MS)),
  ]);
}

export async function connectMcpServer(
  config: McpServerConfig,
  logger?: Logger,
  opts?: ConnectServerOptions,
): Promise<ConnectResult> {
  const log = logger ?? createSilentLogger();
  const transport = buildTransport(config);
  const client = new Client(CLIENT_INFO, {
    capabilities: {},
    versionNegotiation: { mode: "auto" },
  });
  let closedByUs = false;

  let stderrBuffer = "";
  const onStderrData = (chunk: Buffer | string) => {
    stderrBuffer += typeof chunk === "string" ? chunk : chunk.toString();
    if (stderrBuffer.length > STDERR_BUFFER_LIMIT) {
      stderrBuffer = stderrBuffer.slice(-STDERR_BUFFER_LIMIT);
    }
  };
  if (transport instanceof StdioClientTransport) {
    transport.stderr?.on("data", onStderrData);
  }
  const unbindStderr = () => {
    if (transport instanceof StdioClientTransport) {
      transport.stderr?.off("data", onStderrData);
    }
  };

  const signal = opts?.signal;
  const guard = abortGuard(signal, config.name);
  try {
    await Promise.race([
      client.connect(transport, { timeout: CONNECT_TIMEOUT_MS, ...(signal ? { signal } : {}) }),
      guard,
    ]);
  } catch (err) {
    const stderr = stderrBuffer.trim();
    if (stderr) {
      log.error(
        { err, server: config.name, stderr },
        "mcp stdio server failed to start; captured stderr",
      );
    } else {
      log.error({ err, server: config.name }, "mcp stdio server failed to start");
    }
    closedByUs = true;
    await closeQuietly(client, config.name, log);
    throw err;
  }
  unbindStderr();
  stderrBuffer = "";
  let oncloseFired = false;
  client.onclose = () => {
    oncloseFired = true;
    if (!closedByUs) opts?.onDisconnect?.();
  };
  log.info({ server: config.name, transport: config.transport }, "mcp server connected");

  const instructions = client.getInstructions();
  const serverCaps = client.getServerCapabilities();
  const caps = {
    resources: !!serverCaps?.resources,
    prompts: !!serverCaps?.prompts,
  };

  try {
    const collect = async () => {
      const toolDescriptors = await tryListTools(client, config.name, log, signal);
      const tools: AgentTool[] = toolDescriptors.map((tool) =>
        adaptMcpTool(config.name, config.id, tool, (params, toolSignal) =>
          client.callTool(params, toolSignal ? { signal: toolSignal } : undefined) as Promise<McpCallToolResult>,
        ),
      );

      let resources: McpResourceDescriptor[] = [];
      let resourceTemplates: McpResourceTemplateDescriptor[] = [];
      // Synthetic read_resource / get_prompt tools share the mcp__{server}_{shortid}__ namespace.
      // If a server exposes a real tool named "read_resource" or "get_prompt", dedupeToolNames
      // (capabilities/mcp/index.ts) will suffix the later one with __2 — no crash, but the model
      // may see both. Extremely unlikely in practice; documented here for awareness.
      if (caps.resources) {
        ({ resources, resourceTemplates } = await tryListResources(client, config.name, log, signal));
        tools.push(
          adaptMcpReadResourceTool(config.name, config.id, (uri, toolSignal) =>
            client.readResource({ uri }, toolSignal ? { signal: toolSignal } : undefined) as Promise<McpReadResourceResult>,
          ),
        );
      }

      let prompts: McpPromptDescriptor[] = [];
      if (caps.prompts) {
        prompts = await tryListPrompts(client, config.name, log, signal);
        tools.push(
          adaptMcpGetPromptTool(config.name, config.id, (params, toolSignal) =>
            client.getPrompt(params, toolSignal ? { signal: toolSignal } : undefined) as Promise<McpGetPromptResult>,
          ),
        );
      }

      return { tools, resources, resourceTemplates, prompts };
    };

    const collected = await Promise.race([collect(), guard]);
    const { tools, resources, resourceTemplates, prompts } = collected;

    return {
      connection: {
        get serverName() {
          return config.name;
        },
        get closed() {
          return closedByUs || oncloseFired;
        },
        async close() {
          closedByUs = true;
          await closeQuietly(client, config.name, log);
        },
      },
      tools,
      info: {
        serverName: config.name,
        serverId: config.id,
        instructions,
        capabilities: caps,
        resources,
        resourceTemplates,
        prompts,
      },
    };
  } catch (err) {
    closedByUs = true;
    await closeQuietly(client, config.name, log);
    throw err;
  }
}
