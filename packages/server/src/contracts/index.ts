import * as common from "./common.js";
import * as agents from "./agents.js";
import * as sessions from "./sessions.js";
import * as content from "./content.js";
import * as fileTree from "./file-tree.js";
import * as settings from "./settings.js";
import * as schedules from "./schedules.js";
import * as skills from "./skills.js";
import * as debug from "./debug.js";
import * as bus from "./bus.js";
import * as websocket from "./websocket.js";

export const schemas = {
  ...common.schemas,
  ...agents.schemas,
  ...sessions.schemas,
  ...content.schemas,
  ...fileTree.schemas,
  ...settings.schemas,
  ...schedules.schemas,
  ...skills.schemas,
  ...debug.schemas,
  ...bus.schemas,
  ...websocket.schemas,
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
} from "./agents.js";

export type {
  SessionInfoContract,
  SessionListResponse,
  SessionCreateResponse,
  SessionRenameRequest,
  SessionMessagesResponse,
} from "./sessions.js";

export type {
  FileEntryContract,
  FileEntriesResponse,
  ContentResponseContract,
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
  ScheduleEntryContract,
  ScheduleInfoEntryContract,
  ScheduleListResponse,
  ScheduleCreateRequest,
  ScheduleUpdateRequest,
  ScheduleLogEntryContract,
  ScheduleLogListResponse,
} from "./schedules.js";

export type { SkillDefinitionContract, SkillListResponse } from "./skills.js";
export type { TurnContextSnapshotContract } from "./debug.js";

export {
  parseChatClientMessage,
  parseChatServerEvent,
} from "./websocket.js";
export type { ChatClientMessage, ChatServerEvent } from "./websocket.js";

export {
  parseBusServerMessage,
  parseBusClientMessage,
  parseScheduleServerEvent,
} from "./bus.js";
export type {
  BusServerMessage,
  BusClientMessage,
  ScheduleServerEvent,
} from "./bus.js";
