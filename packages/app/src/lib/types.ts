export type {
  AgentProfileContract as AgentProfile,
  SessionInfoContract as SessionInfo,
  FileEntryContract as FileEntry,
  ContentResponseContract as ContentResponse,
  TriggerEntryContract as TriggerEntry,
  TriggerInfoEntryContract as TriggerInfo,
  TriggerLogEntryContract as TriggerLogEntry,
  TriggerServerEvent,
  SkillDefinitionContract as SkillDefinition,
  AgentUpdateResponse,
  AgentCreateResponse,
  AiAccessSettingsResponse,
  WelcomePageSettingsResponse,
  ThemeSettingsResponse,
  McpServerConfigContract as McpServerConfig,
  AgentMcpResponse as AgentMcpConfig,
} from "@spherse/server/contracts";

export type { McpTransportType } from "@spherse/core";

export type {
  AgentMessage,
  Message,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  TextContent,
  ImageContent,
  ThinkingContent,
  ToolCall,
} from "@spherse/core";

export interface ActiveSessionInfo {
  sessionId: string;
  agentName: string;
  sessionTitle?: string;
  floating?: boolean;
}
