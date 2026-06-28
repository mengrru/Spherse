export type {
  AgentProfileContract as AgentProfile,
  SessionInfoContract as SessionInfo,
  FileEntryContract as FileEntry,
  ContentResponseContract as ContentResponse,
  ScheduleEntryContract as ScheduleEntry,
  ScheduleInfoEntryContract as ScheduleInfo,
  ScheduleLogEntryContract as ScheduleLogEntry,
  ScheduleServerEvent,
  SkillDefinitionContract as SkillDefinition,
  AgentUpdateResponse,
  AgentCreateResponse,
  AiAccessSettingsResponse,
  WelcomePageSettingsResponse,
  ThemeSettingsResponse,
} from "@spherse/server/contracts";

export interface ActiveSessionInfo {
  sessionId: string;
  agentName: string;
  sessionTitle?: string;
  floating?: boolean;
}

export type { ChatServerEvent as AgentEvent } from "@spherse/server/contracts";
