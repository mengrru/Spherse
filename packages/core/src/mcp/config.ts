import crypto from "node:crypto";
import type {
  AgentMcpConfig,
  McpServerConfig,
  McpServerConfigBase,
  McpSseServerConfig,
  McpHttpServerConfig,
  McpStdioServerConfig,
  McpTransportType,
} from "./types.js";

const SUPPORTED_TRANSPORTS: ReadonlySet<McpTransportType> = new Set([
  "stdio",
  "http",
  "sse",
]);

export function generateMcpServerId(): string {
  return crypto.randomUUID();
}

export function isMcpTransportType(value: unknown): value is McpTransportType {
  return typeof value === "string" && SUPPORTED_TRANSPORTS.has(value as McpTransportType);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function coerceHeaders(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, string> = {};
  let hasAny = false;
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "string") {
      out[k] = v;
      hasAny = true;
    }
  }
  return hasAny ? out : undefined;
}

function coerceStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const v of value) {
    if (typeof v === "string") out.push(v);
  }
  return out.length ? out : undefined;
}

function coerceEnv(value: unknown): Record<string, string> | undefined {
  return coerceHeaders(value);
}

export function normalizeMcpServer(raw: unknown): McpServerConfig | null {
  if (!isRecord(raw)) return null;

  const transport = raw.transport;
  if (!isMcpTransportType(transport)) return null;

  const id = typeof raw.id === "string" && raw.id ? raw.id : generateMcpServerId();
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const enabled = raw.enabled !== false;

  const base: McpServerConfigBase = { id, name, enabled };

  if (transport === "stdio") {
    const command = typeof raw.command === "string" ? raw.command.trim() : "";
    if (!command) return null;
    const cfg: McpStdioServerConfig = {
      ...base,
      transport: "stdio",
      command,
    };
    const args = coerceStringList(raw.args);
    if (args) cfg.args = args;
    const env = coerceEnv(raw.env);
    if (env) cfg.env = env;
    return cfg;
  }

  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  if (!url) return null;

  const headers = coerceHeaders(raw.headers);

  if (transport === "http") {
    const cfg: McpHttpServerConfig = { ...base, transport: "http", url };
    if (headers) cfg.headers = headers;
    return cfg;
  }

  const cfg: McpSseServerConfig = { ...base, transport: "sse", url };
  if (headers) cfg.headers = headers;
  return cfg;
}

export function normalizeMcpConfig(raw: unknown): AgentMcpConfig {
  if (!isRecord(raw) || !Array.isArray(raw.servers)) {
    return { servers: [] };
  }
  const seenIds = new Set<string>();
  const servers: McpServerConfig[] = [];
  for (const entry of raw.servers) {
    const normalized = normalizeMcpServer(entry);
    if (!normalized) continue;
    if (seenIds.has(normalized.id)) continue;
    seenIds.add(normalized.id);
    servers.push(normalized);
  }
  return { servers };
}

const TOOL_NAME_INVALID_CHARS = /[^a-zA-Z0-9_]/g;

export function sanitizeMcpToolSegment(name: string): string {
  const trimmed = name.trim().toLowerCase();
  const cleaned = trimmed.replace(TOOL_NAME_INVALID_CHARS, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned;
}

export function makeMcpToolName(
  serverName: string,
  serverId: string,
  toolName: string,
): string {
  const readable = sanitizeMcpToolSegment(serverName);
  const shortId = serverId.replace(/-/g, "").slice(0, 8);
  const server = readable ? `${readable}_${shortId}` : shortId;
  const tool = sanitizeMcpToolSegment(toolName) || "tool";
  return `mcp__${server}__${tool}`;
}
