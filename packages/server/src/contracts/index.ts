import * as common from "./common.js";
import * as agents from "./agents.js";
import * as sessions from "./sessions.js";
import * as content from "./content.js";
import * as data from "./data.js";
import * as fileTree from "./file-tree.js";
import * as settings from "./settings.js";
import * as schedules from "./trigger.js";
import * as skills from "./skills.js";
import * as debug from "./debug.js";
import * as bus from "./bus.js";
import * as websocket from "./websocket.js";
import * as connection from "./connection.js";

export const schemas = {
  ...common.schemas,
  ...agents.schemas,
  ...sessions.schemas,
  ...content.schemas,
  ...data.schemas,
  ...fileTree.schemas,
  ...settings.schemas,
  ...schedules.schemas,
  ...skills.schemas,
  ...debug.schemas,
  ...bus.schemas,
  ...websocket.schemas,
  ...connection.schemas,
} as const;

export { parseContract, parseApiResponse } from "./common.js";
export type { OkResponse, ErrorResponse } from "./common.js";

export type {
  AgentProfileContract,
  AgentListResponse,
  AgentRawResponse,
  AgentCreateRequest,
  AgentCreateResponse,
  AgentUpdateRequest,
  AgentUpdateResponse,
  McpServerConfigContract,
  AgentMcpResponse,
  AgentMcpUpdateRequest,
} from "./agents.js";

export type {
  SessionInfoContract,
  SessionListResponse,
  SessionListPageResponse,
  SessionCreateResponse,
  SessionRenameRequest,
  SessionMessagesResponse,
  SessionMessagesPageResponse,
  SessionStatusResponse,
} from "./sessions.js";

export type {
  FileEntryContract,
  FileEntriesResponse,
  ContentResponseContract,
  StatResponseContract,
  ContentCreateRequest,
  ContentSaveRequest,
} from "./content.js";

export type { FileTreeResponse } from "./file-tree.js";

export type {
  ProviderCatalogItemContract,
  ProviderCatalogContract,
  AiAccessSettingsRequest,
  AiAccessSettingsResponse,
  WelcomePageSettingsRequest,
  WelcomePageSettingsResponse,
  ThemeSettingsRequest,
  ThemeSettingsResponse,
} from "./settings.js";

export type {
  TriggerEntryContract,
  TriggerInfoEntryContract,
  TriggerListResponse,
  TriggerCreateRequest,
  TriggerUpdateRequest,
  TriggerLogEntryContract,
  TriggerLogListResponse,
} from "./trigger.js";

export type { SkillDefinitionContract, SkillListResponse, SkillCreateRequest, SkillInstallRequest } from "./skills.js";
export type { TurnContextSnapshotContract } from "./debug.js";
export type {
  ProjectListEntry,
  ProjectListResponse,
  ProjectInfoResponse,
  ConnectionInfoResponse,
} from "./connection.js";

export {
  parseChatClientMessage,
  parseChatServerEvent,
  ErrorEventCode,
  CHAT_CLOSE_CODES,
} from "./websocket.js";
export type { ChatClientMessage, ChatServerEvent } from "./websocket.js";

export {
  parseBusServerMessage,
  parseBusClientMessage,
  parseTriggerServerEvent,
} from "./bus.js";
export type {
  BusServerMessage,
  BusClientMessage,
  TriggerServerEvent,
  AgentUpdatedEvent,
} from "./bus.js";
