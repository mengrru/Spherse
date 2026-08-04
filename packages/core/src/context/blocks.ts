import type { McpServerInfo } from "../mcp/types.js";

export interface ContextFile {
  path: string;
  content: string;
}

export interface SkillItem {
  name: string;
  description: string;
}

export interface SessionMeta {
  name: string;
  alias?: string;
  slug: string;
  sessionId: string;
  timePerceptionEnabled?: boolean;
}

export type ContextBlock =
  | { kind: "project-instructions"; content: string }
  | { kind: "agent-profile"; content: string }
  | { kind: "session-context"; meta: SessionMeta }
  | { kind: "skill-catalog"; skills: SkillItem[] }
  | { kind: "preloaded-context"; files: ContextFile[] }
  | { kind: "mcp-context"; servers: McpServerInfo[] };

export function buildProjectInstructions(content: string): ContextBlock | null {
  if (content.trim() === "") return null;
  return { kind: "project-instructions", content };
}

export function buildAgentProfile(content: string): ContextBlock | null {
  if (content.trim() === "") return null;
  return { kind: "agent-profile", content };
}

export function buildSessionContext(meta: SessionMeta): ContextBlock {
  return { kind: "session-context", meta };
}

export function buildSkillCatalog(skills: SkillItem[]): ContextBlock | null {
  if (skills.length === 0) return null;
  return { kind: "skill-catalog", skills };
}

export function buildPreloadedContext(files: ContextFile[]): ContextBlock | null {
  if (files.length === 0) return null;
  return { kind: "preloaded-context", files };
}

export function buildMcpContext(servers: McpServerInfo[]): ContextBlock | null {
  const meaningful = servers.filter(
    (s) =>
      (s.instructions?.trim() ?? "") !== "" ||
      s.resources.length > 0 ||
      s.resourceTemplates.length > 0 ||
      s.prompts.length > 0,
  );
  if (meaningful.length === 0) return null;
  return { kind: "mcp-context", servers: meaningful };
}
