export interface AgentProfile {
  id: string;
  name: string;
  model?: string;
  type: string;
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

export interface ToolCallInfo {
  toolName: string;
  args: Record<string, unknown>;
  result?: string;
  status: "running" | "completed" | "error";
}

export type AgentEvent =
  | { type: "message_update"; message: any }
  | { type: "message_end"; message: any }
  | { type: "tool_call"; toolCall: any }
  | { type: "tool_result"; toolCall: any; result: any }
  | { type: "agent_end_done" }
  | { type: "error"; message: string };
