export interface AgentProfile {
  id: string;
  name: string;
  slug: string;
  createdAt: number;
  model?: string;
  schedule?: string;
  tools?: string[];
  context?: string[];
  systemPrompt: string;
  filePath: string;
}

export interface SessionInfo {
  id: string;
  agentId: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  status: "active" | "archived";
}

export interface FileEntry {
  name: string;
  type: "file" | "directory";
}

export interface ContentResponse {
  content: string;
  path: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  _streaming?: boolean;
  _toolCalls?: ToolCallInfo[];
  _error?: string;
}

export interface HtmlCard {
  type: "html";
  html: string;
  title?: string;
  width?: number;
  height?: number;
  max_width?: number;
  max_height?: number;
}

export interface ToolCallInfo {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: string;
  partialResult?: string;
  status: "running" | "completed" | "error";
  _card?: HtmlCard;
}

export type { ChatServerEvent as AgentEvent } from "@spherse/server/contracts";
