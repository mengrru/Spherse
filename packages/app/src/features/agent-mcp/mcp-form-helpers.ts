import type { McpServerConfig } from "../../lib/types";
import type { McpTransportType } from "../../lib/types";

export interface McpServerDraft {
  id: string;
  name: string;
  enabled: boolean;
  transport: McpTransportType;
  command: string;
  args: string;
  env: string;
  url: string;
  headers: string;
}

export const TRANSPORT_OPTIONS: McpTransportType[] = ["stdio", "http", "sse"];

export function emptyMcpDraft(): McpServerDraft {
  return {
    id: crypto.randomUUID(),
    name: "",
    enabled: true,
    transport: "stdio",
    command: "",
    args: "",
    env: "",
    url: "",
    headers: "",
  };
}

function parseLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function parseKeyValueEntries(raw: string, separator: RegExp): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  for (const line of parseLines(raw)) {
    const idx = line.search(separator);
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) entries.push([key, value]);
  }
  return entries;
}

export function draftToConfig(draft: McpServerDraft): McpServerConfig | null {
  const name = draft.name.trim();
  if (!name) return null;

  if (draft.transport === "stdio") {
    const command = draft.command.trim();
    if (!command) return null;
    const args = parseLines(draft.args);
    const envEntries = parseKeyValueEntries(draft.env, /=/);
    return {
      id: draft.id,
      name,
      enabled: draft.enabled,
      transport: "stdio",
      command,
      ...(args.length ? { args } : {}),
      ...(envEntries.length ? { env: Object.fromEntries(envEntries) } : {}),
    } as McpServerConfig;
  }

  const url = draft.url.trim();
  if (!url) return null;
  const headerEntries = parseKeyValueEntries(draft.headers, /:\s*/);
  return {
    id: draft.id,
    name,
    enabled: draft.enabled,
    transport: draft.transport,
    url,
    ...(headerEntries.length ? { headers: Object.fromEntries(headerEntries) } : {}),
  } as McpServerConfig;
}

export function configToDraft(config: McpServerConfig): McpServerDraft {
  if (config.transport === "stdio") {
    return {
      id: config.id,
      name: config.name,
      enabled: config.enabled,
      transport: "stdio",
      command: config.command,
      args: config.args?.join("\n") ?? "",
      env: config.env
        ? Object.entries(config.env).map(([k, v]) => `${k}=${v}`).join("\n")
        : "",
      url: "",
      headers: "",
    };
  }
  return {
    id: config.id,
    name: config.name,
    enabled: config.enabled,
    transport: config.transport,
    command: "",
    args: "",
    env: "",
    url: config.url,
    headers: config.headers
      ? Object.entries(config.headers).map(([k, v]) => `${k}: ${v}`).join("\n")
      : "",
  };
}
