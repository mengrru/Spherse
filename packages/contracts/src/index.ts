import * as common from "./common.js";
import * as agents from "./agents.js";
import * as sessions from "./sessions.js";
import * as content from "./content.js";
import * as data from "./data.js";
import * as fileTree from "./file-tree.js";
import * as settings from "./settings.js";
import * as schedules from "./trigger.js";
import * as skills from "./skills.js";
import * as marketplace from "./marketplace.js";
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
  ...marketplace.schemas,
  ...debug.schemas,
  ...bus.schemas,
  ...websocket.schemas,
  ...connection.schemas,
} as const;

export { parseContract, parseApiResponse } from "./common.js";
export type { OkResponse, ErrorResponse } from "./common.js";

export type {
  AgentProfileContract,
  AgentSummaryContract,
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
  ProjectSessionListResponse,
  SessionCreateResponse,
  SessionRenameRequest,
  SessionMessagesResponse,
  SessionMessagesPageResponse,
  SessionEventsResponse,
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

export type { DataReadResponseContract } from "./data.js";

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
  ProjectTriggerListResponse,
  TriggerCreateRequest,
  TriggerUpdateRequest,
  TriggerLogEntryContract,
  TriggerLogListResponse,
} from "./trigger.js";

export type { SkillDefinitionContract, SkillSummaryContract, SkillListResponse, SkillCreateRequest, SkillInstallRequest } from "./skills.js";
export type {
  MarketplaceSkillEntry,
  MarketplaceManifestResponse,
  SkillMarketplaceInstallRequest,
} from "./marketplace.js";
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
export type { ChatClientMessage, ChatServerEvent, SettledFrameContract } from "./websocket.js";

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
  FsWatchChangeEvent,
} from "./bus.js";
