export type {
  AgentProfileContract as AgentProfile,
  SessionInfoContract as SessionInfo,
  FileEntryContract as FileEntry,
  ContentResponseContract as ContentResponse,
  ScheduleEntryContract as ScheduleEntry,
  ScheduleInfoEntryContract as ScheduleInfo,
  ScheduleLogEntryContract as ScheduleLogEntry,
  ScheduleServerEvent,
  AgentUpdateResponse,
  AgentCreateResponse,
  AiAccessSettingsResponse,
  WelcomePageSettingsResponse,
} from "@spherse/server/contracts";

export interface ActiveSessionInfo {
  sessionId: string;
  agentName: string;
  sessionTitle?: string;
  floating?: boolean;
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
