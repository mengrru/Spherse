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

export type AgentEvent =
  | { type: "message_update"; message: any }
  | { type: "message_end"; message: any }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: any }
  | { type: "tool_execution_update"; toolCallId: string; toolName: string; args: any; partialResult: any }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: any; isError: boolean }
  | { type: "agent_end_done" }
  | { type: "error"; message: string };
