import { Type } from "@sinclair/typebox";
import { nanoid } from "nanoid";
import { isValidCron, isReservedEventName, requiresTargetSession } from "@spherse/core";
import { schemas, parseContract } from "@spherse/contracts";
import { RpcAppError, defineRpcMethod } from "../context.js";

function invalidParams(message: string): RpcAppError {
  return new RpcAppError(-32602, message);
}

const list = defineRpcMethod(
  Type.Object({ projectId: Type.String(), agentId: Type.String() }),
  (params, ctx) => {
    const { triggerManager } = ctx.resolveProject(params.projectId);
    const entries = triggerManager.list(params.agentId);
    return parseContract(
      schemas.triggerListResponse,
      entries.map((entry) => ({
        ...entry,
        nextTriggerAt: triggerManager.getNextTrigger(params.agentId, entry.id)?.getTime() ?? null,
      })),
    );
  },
);

const listProject = defineRpcMethod(
  Type.Object({ projectId: Type.String() }),
  (params, ctx) => {
    const { triggerManager } = ctx.resolveProject(params.projectId);
    const triggers = triggerManager.listProject().map(({ agentId, entry, nextTriggerAt }) => ({
      agentId,
      ...entry,
      nextTriggerAt: nextTriggerAt?.getTime() ?? null,
    }));
    return parseContract(schemas.projectTriggerListResponse, { ok: true, triggers });
  },
);

const create = defineRpcMethod(
  Type.Object(
    {
      projectId: Type.String(),
      agentId: Type.String(),
      name: Type.Optional(Type.String()),
      type: Type.Union([Type.Literal("time"), Type.Literal("event")]),
      cron: Type.Optional(Type.String()),
      eventName: Type.Optional(Type.String()),
      mode: Type.Union([
        Type.Literal("new_session"),
        Type.Literal("existing_session"),
        Type.Literal("reusable_session"),
      ]),
      targetSessionId: Type.Optional(Type.String()),
      message: Type.String(),
      notify: Type.Boolean(),
      notificationMessage: Type.Optional(Type.String({ maxLength: 30 })),
    },
    { additionalProperties: false },
  ),
  (params, ctx) => {
    if (params.type === "time") {
      if (!params.cron || !isValidCron(params.cron)) {
        throw invalidParams("invalid cron expression");
      }
    } else if (params.type === "event") {
      if (!params.eventName?.trim()) {
        throw invalidParams("eventName is required for event type");
      }
      if (isReservedEventName(params.eventName)) {
        throw invalidParams("eventName cannot use reserved prefix 'sp:'");
      }
    }
    if (requiresTargetSession(params.mode, params.targetSessionId)) {
      throw invalidParams("targetSessionId is required for existing_session mode");
    }
    const { triggerManager } = ctx.resolveProject(params.projectId);
    const now = Date.now();
    const entry = {
      id: nanoid(),
      name: params.name,
      enabled: true,
      type: params.type,
      cron: params.type === "time" ? params.cron : undefined,
      eventName: params.type === "event" ? params.eventName : undefined,
      mode: params.mode,
      targetSessionId: params.targetSessionId,
      message: params.message,
      notify: params.notify,
      notificationMessage: params.notify ? params.notificationMessage : undefined,
      createdAt: now,
      updatedAt: now,
    };
    triggerManager.create(params.agentId, entry);
    return parseContract(schemas.triggerEntry, entry);
  },
);

const update = defineRpcMethod(
  Type.Object(
    {
      projectId: Type.String(),
      agentId: Type.String(),
      triggerId: Type.String(),
      name: Type.Optional(Type.String()),
      enabled: Type.Optional(Type.Boolean()),
      type: Type.Optional(Type.Union([Type.Literal("time"), Type.Literal("event")])),
      cron: Type.Optional(Type.String()),
      eventName: Type.Optional(Type.String()),
      mode: Type.Optional(
        Type.Union([
          Type.Literal("new_session"),
          Type.Literal("existing_session"),
          Type.Literal("reusable_session"),
        ]),
      ),
      targetSessionId: Type.Optional(Type.String()),
      message: Type.Optional(Type.String()),
      notify: Type.Optional(Type.Boolean()),
      notificationMessage: Type.Optional(Type.String({ maxLength: 30 })),
    },
    { additionalProperties: false },
  ),
  (params, ctx) => {
    const { projectId, agentId, triggerId, ...data } = params;
    if (data.cron !== undefined && !isValidCron(data.cron)) {
      throw invalidParams("invalid cron expression");
    }
    if (data.eventName !== undefined && isReservedEventName(data.eventName)) {
      throw invalidParams("eventName cannot use reserved prefix 'sp:'");
    }
    const { triggerManager } = ctx.resolveProject(projectId);
    const existing = triggerManager.get(agentId, triggerId);
    if (!existing) throw new RpcAppError(100, "Trigger not found");
    const resolvedMode = data.mode ?? existing.mode;
    const resolvedTarget =
      data.targetSessionId !== undefined ? data.targetSessionId : existing.targetSessionId;
    if (requiresTargetSession(resolvedMode, resolvedTarget)) {
      throw invalidParams("targetSessionId is required for existing_session mode");
    }
    const updated = triggerManager.update(agentId, triggerId, data);
    if (!updated) throw new RpcAppError(100, "Trigger not found");
    return parseContract(schemas.triggerEntry, updated);
  },
);

const remove = defineRpcMethod(
  Type.Object({ projectId: Type.String(), agentId: Type.String(), triggerId: Type.String() }),
  (params, ctx) => {
    const { triggerManager } = ctx.resolveProject(params.projectId);
    triggerManager.delete(params.agentId, params.triggerId);
    return parseContract(schemas.okResponse, { ok: true });
  },
);

const run = defineRpcMethod(
  Type.Object({ projectId: Type.String(), agentId: Type.String(), triggerId: Type.String() }),
  (params, ctx) => {
    const { triggerManager } = ctx.resolveProject(params.projectId);
    const entry = triggerManager.get(params.agentId, params.triggerId);
    if (!entry) throw new RpcAppError(100, "Trigger not found");
    triggerManager.runNow(params.agentId, params.triggerId);
    return parseContract(schemas.okResponse, { ok: true });
  },
);

const resetBinding = defineRpcMethod(
  Type.Object({ projectId: Type.String(), agentId: Type.String(), triggerId: Type.String() }),
  (params, ctx) => {
    const { triggerManager } = ctx.resolveProject(params.projectId);
    const entry = triggerManager.get(params.agentId, params.triggerId);
    if (!entry) throw new RpcAppError(100, "Trigger not found");
    if (entry.mode !== "reusable_session") {
      throw invalidParams("reset-binding only applies to reusable_session triggers");
    }
    const updated = triggerManager.update(params.agentId, params.triggerId, {
      boundSessionId: undefined,
    });
    if (!updated) throw new RpcAppError(100, "Trigger not found");
    return parseContract(schemas.triggerEntry, updated);
  },
);

const logs = defineRpcMethod(
  Type.Object({
    projectId: Type.String(),
    agentId: Type.String(),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  }),
  (params, ctx) => {
    const { triggerManager } = ctx.resolveProject(params.projectId);
    return parseContract(
      schemas.triggerLogListResponse,
      triggerManager.getRecentLogs(params.agentId, params.limit),
    );
  },
);

const get = defineRpcMethod(
  Type.Object({ projectId: Type.String(), agentId: Type.String(), triggerId: Type.String() }),
  (params, ctx) => {
    const { triggerManager } = ctx.resolveProject(params.projectId);
    const entry = triggerManager.get(params.agentId, params.triggerId);
    if (!entry) throw new RpcAppError(100, "Trigger not found");
    return parseContract(schemas.triggerEntry, entry);
  },
);

export const triggerMethods: Record<string, ReturnType<typeof defineRpcMethod>> = {
  "triggers.list": list,
  "triggers.listProject": listProject,
  "triggers.get": get,
  "triggers.create": create,
  "triggers.update": update,
  "triggers.delete": remove,
  "triggers.run": run,
  "triggers.resetBinding": resetBinding,
  "triggers.logs": logs,
};
