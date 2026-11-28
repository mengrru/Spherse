import { Type, type TSchema } from "@sinclair/typebox";
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
import * as projectMarketplace from "./project-marketplace.js";
import * as promptMarketplace from "./prompt-marketplace.js";
import * as debug from "./debug.js";
import * as bus from "./bus.js";
import * as connection from "./connection.js";

const schemas = {
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
  ...projectMarketplace.schemas,
  ...promptMarketplace.schemas,
  ...debug.schemas,
  ...bus.schemas,
  ...connection.schemas,
} as typeof common.schemas & typeof agents.schemas & typeof sessions.schemas & typeof content.schemas & typeof data.schemas & typeof fileTree.schemas & typeof settings.schemas & typeof schedules.schemas & typeof skills.schemas & typeof marketplace.schemas & typeof projectMarketplace.schemas & typeof promptMarketplace.schemas & typeof debug.schemas & typeof bus.schemas & typeof connection.schemas;

export interface RpcMethodSchema {
  params: TSchema;
  result: TSchema;
}

const sessionRef = {
  projectId: Type.String(),
  agentId: Type.String(),
  sessionId: Type.String(),
};

export const rpcMethodSchemas = {
  "sessions.listProject": {
    params: Type.Object({ projectId: Type.String(), perPage: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }),
    result: schemas.projectSessionListResponse,
  },
  "sessions.search": {
    params: Type.Object({ projectId: Type.String(), q: Type.String(), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }),
    result: schemas.sessionSearchResponse,
  },
  "sessions.listByAgent": {
    params: Type.Object({ projectId: Type.String(), agentId: Type.String(), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })), offset: Type.Optional(Type.Integer({ minimum: 0 })) }),
    result: schemas.sessionListPageResponse,
  },
  "sessions.get": {
    params: Type.Object({ ...sessionRef }),
    result: schemas.sessionInfo,
  },
  "sessions.create": {
    params: Type.Object({ projectId: Type.String(), agentId: Type.String(), title: Type.Optional(Type.String({ minLength: 1 })) }),
    result: schemas.sessionCreateResponse,
  },
  "sessions.messages": {
    params: Type.Object({ ...sessionRef }),
    result: schemas.sessionMessagesResponse,
  },
  "sessions.messagesPage": {
    params: Type.Object({ ...sessionRef, limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })), before: Type.Optional(Type.Integer()) }),
    result: schemas.sessionMessagesPageResponse,
  },
  "sessions.rename": {
    params: Type.Object({ ...sessionRef, title: Type.String() }),
    result: schemas.okResponse,
  },
  "sessions.delete": {
    params: Type.Object({ ...sessionRef }),
    result: schemas.okResponse,
  },
  "sessions.status": {
    params: Type.Object({ ...sessionRef }),
    result: schemas.sessionStatus,
  },
  "sessions.sendMessage": {
    params: Type.Object({ ...sessionRef, content: Type.String({ minLength: 1 }) }),
    result: schemas.okResponse,
  },
  "agents.list": {
    params: Type.Object({ projectId: Type.String() }),
    result: schemas.agentListResponse,
  },
  "agents.get": {
    params: Type.Object({ projectId: Type.String(), id: Type.String() }),
    result: schemas.agentProfile,
  },
  "agents.getRaw": {
    params: Type.Object({ projectId: Type.String(), id: Type.String() }),
    result: schemas.agentRawResponse,
  },
  "agents.getTheme": {
    params: Type.Object({ projectId: Type.String(), id: Type.String() }),
    result: Type.Object({ theme: Type.Optional(Type.String()) }),
  },
  "agents.create": {
    params: Type.Object({ projectId: Type.String(), slugBase: Type.String({ minLength: 1 }), content: Type.String({ minLength: 1 }), themeContent: Type.Optional(Type.String()) }),
    result: schemas.agentCreateResponse,
  },
  "agents.update": {
    params: Type.Object({ projectId: Type.String(), id: Type.String(), content: Type.String({ minLength: 1 }), themeContent: Type.Optional(Type.String()) }),
    result: schemas.agentUpdateResponse,
  },
  "agents.delete": {
    params: Type.Object({ projectId: Type.String(), id: Type.String() }),
    result: schemas.okResponse,
  },
  "agents.getMcp": {
    params: Type.Object({ projectId: Type.String(), id: Type.String() }),
    result: schemas.agentMcpResponse,
  },
  "agents.updateMcp": {
    params: Type.Object({ projectId: Type.String(), id: Type.String(), servers: Type.Array(schemas.mcpServerConfig) }),
    result: schemas.agentMcpResponse,
  },
  "agents.getMemoryConfig": {
    params: Type.Object({ projectId: Type.String(), id: Type.String() }),
    result: schemas.agentMemoryResponse,
  },
  "agents.updateMemoryConfig": {
    params: Type.Object({ projectId: Type.String(), id: Type.String(), enabled: Type.Optional(Type.Boolean()), core: Type.Optional(Type.String()) }),
    result: schemas.agentMemoryResponse,
  },
  "agents.listMemoryEntries": {
    params: Type.Object({ projectId: Type.String(), id: Type.String(), q: Type.Optional(Type.String()) }),
    result: schemas.agentMemoryEntriesResponse,
  },
  "agents.updateMemoryEntry": {
    params: Type.Object({ projectId: Type.String(), id: Type.String(), entryId: Type.String(), content: Type.Optional(Type.String()), tags: Type.Optional(Type.Array(Type.String())) }),
    result: schemas.agentMemoryEntry,
  },
  "agents.deleteMemoryEntry": {
    params: Type.Object({ projectId: Type.String(), id: Type.String(), entryId: Type.String() }),
    result: schemas.okResponse,
  },
  "triggers.list": {
    params: Type.Object({ projectId: Type.String(), agentId: Type.String() }),
    result: schemas.triggerListResponse,
  },
  "triggers.listProject": {
    params: Type.Object({ projectId: Type.String() }),
    result: schemas.projectTriggerListResponse,
  },
  "triggers.get": {
    params: Type.Object({ projectId: Type.String(), agentId: Type.String(), triggerId: Type.String() }),
    result: schemas.triggerEntry,
  },
  "triggers.create": {
    params: Type.Object({
      projectId: Type.String(),
      agentId: Type.String(),
      name: Type.Optional(Type.String()),
      type: Type.Union([Type.Literal("time"), Type.Literal("event")]),
      cron: Type.Optional(Type.String()),
      eventName: Type.Optional(Type.String()),
      mode: Type.Union([Type.Literal("new_session"), Type.Literal("existing_session"), Type.Literal("reusable_session")]),
      targetSessionId: Type.Optional(Type.String()),
      message: Type.String(),
      notify: Type.Boolean(),
      notificationMessage: Type.Optional(Type.String({ maxLength: 30 })),
    }, { additionalProperties: false }),
    result: schemas.triggerEntry,
  },
  "triggers.update": {
    params: Type.Object({
      projectId: Type.String(),
      agentId: Type.String(),
      triggerId: Type.String(),
      name: Type.Optional(Type.String()),
      enabled: Type.Optional(Type.Boolean()),
      type: Type.Optional(Type.Union([Type.Literal("time"), Type.Literal("event")])),
      cron: Type.Optional(Type.String()),
      eventName: Type.Optional(Type.String()),
      mode: Type.Optional(Type.Union([Type.Literal("new_session"), Type.Literal("existing_session"), Type.Literal("reusable_session")])),
      targetSessionId: Type.Optional(Type.String()),
      message: Type.Optional(Type.String()),
      notify: Type.Optional(Type.Boolean()),
      notificationMessage: Type.Optional(Type.String({ maxLength: 30 })),
    }, { additionalProperties: false }),
    result: schemas.triggerEntry,
  },
  "triggers.delete": {
    params: Type.Object({ projectId: Type.String(), agentId: Type.String(), triggerId: Type.String() }),
    result: schemas.okResponse,
  },
  "triggers.run": {
    params: Type.Object({ projectId: Type.String(), agentId: Type.String(), triggerId: Type.String() }),
    result: schemas.okResponse,
  },
  "triggers.resetBinding": {
    params: Type.Object({ projectId: Type.String(), agentId: Type.String(), triggerId: Type.String() }),
    result: schemas.okResponse,
  },
  "triggers.logs": {
    params: Type.Object({ projectId: Type.String(), agentId: Type.String(), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }),
    result: schemas.triggerLogListResponse,
  },
  "debug.turnContext": {
    params: Type.Object({ projectId: Type.String(), sessionId: Type.String() }),
    result: schemas.turnContextSnapshot,
  },
  "debug.sessionEvents": {
    params: Type.Object({ projectId: Type.String(), agentId: Type.String({ minLength: 1 }), sessionId: Type.String() }),
    result: schemas.sessionEventLog,
  },
  "chat.send": {
    params: Type.Object({
      ...sessionRef,
      content: Type.String({ minLength: 1 }),
      clientId: Type.Optional(Type.String()),
      attachments: Type.Optional(Type.Array(Type.Object({ type: Type.String(), path: Type.String(), mimeType: Type.String() }))),
    }),
    result: schemas.okResponse,
  },
  "chat.retry": {
    params: Type.Object({ ...sessionRef }),
    result: schemas.okResponse,
  },
  "chat.withdraw": {
    params: Type.Object({ ...sessionRef }),
    result: schemas.okResponse,
  },
  "chat.abort": {
    params: Type.Object({ ...sessionRef }),
    result: schemas.okResponse,
  },
  "chat.resolveControlRequest": {
    params: Type.Intersect([
      Type.Object({ ...sessionRef, requestId: Type.String() }),
      Type.Union([
        Type.Object({ kind: Type.Literal("approval"), approved: Type.Boolean(), reason: Type.Optional(Type.String()) }),
        Type.Object({ kind: Type.Literal("question"), answer: Type.String({ minLength: 1 }) }),
      ]),
    ]),
    result: schemas.okResponse,
  },
  "connection.info": {
    params: Type.Object({}),
    result: schemas.connectionInfoResponse,
  },
  "connection.projects": {
    params: Type.Object({}),
    result: schemas.projectListResponse,
  },
  "connection.projectInfo": {
    params: Type.Object({ projectId: Type.String() }),
    result: schemas.projectInfoResponse,
  },
  "bus.emitTriggerEvent": {
    params: Type.Object({ projectId: Type.String(), eventName: Type.String({ minLength: 1 }), payload: Type.Optional(Type.String()) }),
    result: schemas.okResponse,
  },
  "content.stat": {
    params: Type.Object({ projectId: Type.String(), path: Type.String({ minLength: 1 }) }),
    result: schemas.statResponse,
  },
  "content.read": {
    params: Type.Object({ projectId: Type.String(), path: Type.String({ minLength: 1 }) }),
    result: schemas.contentResponse,
  },
  "content.list": {
    params: Type.Object({ projectId: Type.String(), path: Type.Optional(Type.String()) }),
    result: schemas.fileEntries,
  },
  "content.save": {
    params: Type.Object({ projectId: Type.String(), path: Type.String({ minLength: 1 }), content: Type.String() }),
    result: schemas.okResponse,
  },
  "content.rename": {
    params: Type.Object({ projectId: Type.String(), path: Type.String({ minLength: 1 }), to: Type.String({ minLength: 1 }) }),
    result: schemas.okResponse,
  },
  "content.delete": {
    params: Type.Object({ projectId: Type.String(), path: Type.String({ minLength: 1 }) }),
    result: schemas.okResponse,
  },
  "content.mkdir": {
    params: Type.Object({ projectId: Type.String(), path: Type.String({ minLength: 1 }) }),
    result: schemas.okResponse,
  },
  "content.touch": {
    params: Type.Object({ projectId: Type.String(), path: Type.String({ minLength: 1 }) }),
    result: schemas.okResponse,
  },
  "content.fileTree": {
    params: Type.Object({ projectId: Type.String() }),
    result: schemas.fileTreeResponse,
  },
  "data.read": {
    params: Type.Object({
      projectId: Type.String(),
      file: Type.String({ minLength: 1 }),
      key: Type.Optional(Type.String({ minLength: 1 })),
      path: Type.Optional(Type.String({ minLength: 1 })),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      ifVersion: Type.Optional(Type.String({ minLength: 8 })),
    }),
    result: schemas.dataReadResponse,
  },
  "data.mutate": {
    params: Type.Object({
      projectId: Type.String(),
      file: Type.String({ minLength: 1 }),
      name: Type.String({ minLength: 1 }),
      args: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      idempotencyKey: Type.Optional(Type.String({ minLength: 1 })),
    }),
    result: schemas.dataMutateResponse,
  },
  "data.rawSet": {
    params: Type.Object({
      projectId: Type.String(),
      file: Type.String({ minLength: 1 }),
      key: Type.String({ minLength: 1 }),
      value: Type.Unknown(),
      ifVersion: Type.Optional(Type.String({ minLength: 8 })),
    }),
    result: schemas.dataWriteResponse,
  },
  "data.rawDelete": {
    params: Type.Object({
      projectId: Type.String(),
      file: Type.String({ minLength: 1 }),
      key: Type.String({ minLength: 1 }),
      ifVersion: Type.Optional(Type.String({ minLength: 8 })),
    }),
    result: schemas.dataWriteResponse,
  },
  "settings.supportedProviders": {
    params: Type.Object({}),
    result: schemas.providerCatalog,
  },
  "settings.imageProviders": {
    params: Type.Object({}),
    result: schemas.providerCatalog,
  },
  "settings.getModels": {
    params: Type.Object({}),
    result: schemas.modelSettingsResponse,
  },
  "settings.updateModels": {
    params: schemas.modelSettingsRequest,
    result: schemas.modelSettingsResponse,
  },
  "settings.getAiAccess": {
    params: Type.Object({ projectId: Type.String() }),
    result: schemas.aiAccessSettingsResponse,
  },
  "settings.updateAiAccess": {
    params: Type.Object({ projectId: Type.String(), ...schemas.aiAccessSettingsRequest.properties }),
    result: schemas.aiAccessSettingsResponse,
  },
  "settings.getWelcomePage": {
    params: Type.Object({ projectId: Type.String() }),
    result: schemas.welcomePageSettingsResponse,
  },
  "settings.updateWelcomePage": {
    params: Type.Object({ projectId: Type.String(), ...schemas.welcomePageSettingsRequest.properties }),
    result: schemas.welcomePageSettingsResponse,
  },
  "settings.getSidePanel": {
    params: Type.Object({ projectId: Type.String() }),
    result: schemas.sidePanelSettingsResponse,
  },
  "settings.updateSidePanel": {
    params: Type.Object({ projectId: Type.String(), ...schemas.sidePanelSettingsRequest.properties }),
    result: schemas.sidePanelSettingsResponse,
  },
  "settings.getTheme": {
    params: Type.Object({ projectId: Type.String() }),
    result: schemas.themeSettingsResponse,
  },
  "settings.updateTheme": {
    params: Type.Object({ projectId: Type.String(), ...schemas.themeSettingsRequest.properties }),
    result: schemas.okResponse,
  },
  "skills.create": {
    params: Type.Object({ projectId: Type.String(), name: Type.String(), description: Type.String(), instructions: Type.String() }, { additionalProperties: false }),
    result: schemas.skillDefinition,
  },
  "skills.install": {
    params: Type.Object({ projectId: Type.String(), zipPath: Type.String() }, { additionalProperties: false }),
    result: schemas.skillDefinition,
  },
  "skills.list": {
    params: Type.Object({ projectId: Type.String() }, { additionalProperties: false }),
    result: schemas.skillListResponse,
  },
  "skills.listMarketplace": {
    params: Type.Object({ projectId: Type.String() }),
    result: schemas.marketplaceManifestResponse,
  },
  "skills.installMarketplace": {
    params: Type.Object({ projectId: Type.String(), name: Type.String(), version: Type.String() }, { additionalProperties: false }),
    result: schemas.skillDefinition,
  },
  "marketplace.projects": {
    params: Type.Object({}, { additionalProperties: false }),
    result: schemas.marketplaceProjectManifestResponse,
  },
  "marketplace.installProject": {
    params: Type.Object({ name: Type.String(), version: Type.String(), destDir: Type.String() }, { additionalProperties: false }),
    result: schemas.projectMarketplaceInstallResponse,
  },
  "marketplace.prompts": {
    params: Type.Object({ language: Type.Optional(Type.String({ pattern: "^[a-z]{2}(-[a-z]{2})?$" })) }, { additionalProperties: false }),
    result: schemas.marketplacePromptManifestResponse,
  },
  "attachments.upload": {
    params: Type.Object({ projectId: Type.String(), file: Type.Unknown(), filename: Type.Optional(Type.String()), width: Type.Optional(Type.Number()), height: Type.Optional(Type.Number()) }),
    result: Type.Object({
      type: Type.Literal("image"),
      path: Type.String(),
      width: Type.Optional(Type.Number()),
      height: Type.Optional(Type.Number()),
      bytes: Type.Integer(),
    }),
  },
  "attachments.delete": {
    params: Type.Object({ projectId: Type.String(), path: Type.String({ minLength: 1 }) }),
    result: schemas.okResponse,
  },
  "browser.createProject": {
    params: Type.Object({ name: Type.String({ minLength: 1, maxLength: 64 }) }),
    result: Type.Object({ projectId: Type.String() }),
  },
  "browser.removeProject": {
    params: Type.Object({ projectId: Type.String() }),
    result: Type.Object({ ok: Type.Boolean() }),
  },
} as const satisfies Record<string, RpcMethodSchema>;
