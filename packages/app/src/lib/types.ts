export interface AgentProfile {
  id: string;
  name: string;
  slug: string;
  createdAt: number;
  model?: string;
  schedule?: boolean;
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
  source?: "manual" | "scheduled";
}

export interface ActiveSessionInfo {
  sessionId: string;
  agentName: string;
  sessionTitle?: string;
  floating?: boolean;
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

export interface ScheduleEntry {
  id: string;
  name?: string;
  enabled: boolean;
  cron: string;
  mode: "new_session" | "existing_session";
  targetSessionId?: string;
  message: string;
  notify: boolean;
  notificationMessage?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ScheduleInfo extends ScheduleEntry {
  nextTriggerAt?: number | null;
}

export interface ScheduleLogEntry {
  scheduleId: string;
  scheduleName?: string;
  agentName?: string;
  sessionId: string;
  triggeredAt: number;
  completedAt?: number;
  status: "running" | "success" | "failed";
  error?: string;
}

export interface ScheduleServerEvent {
  type: "schedule_triggered" | "schedule_completed" | "schedule_failed" | "schedule_updated";
  agentId: string;
  scheduleId: string;
  sessionId?: string;
  triggeredAt?: number;
  status?: string;
  error?: string;
}

export type { ChatServerEvent as AgentEvent } from "@spherse/server/contracts";
