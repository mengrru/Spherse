import { Type } from "@sinclair/typebox";
import { nanoid } from "nanoid";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { TriggerManager } from "../trigger/trigger-manager.js";
import type { ProjectStore } from "../store/project.js";
import type { TriggerEntry } from "../types.js";
import { isValidCron, isReservedEventName, requiresTargetSession } from "../trigger/validation.js";

const ManageTriggerParams = Type.Object({
  action: Type.Union(
    [
      Type.Literal("list"),
      Type.Literal("create"),
      Type.Literal("update"),
      Type.Literal("delete"),
    ],
    {
      description:
        "`list` returns the triggers of an agent. `create` adds a trigger. `update` patches an existing trigger — only the fields you pass are changed. `delete` removes a trigger permanently.",
    },
  ),
  agent_id: Type.Optional(
    Type.String({
      description:
        "Agent that owns the trigger. Defaults to the agent running this tool. Use `manage_agent` with action `list` to discover other agent ids.",
    }),
  ),
  trigger_id: Type.Optional(
    Type.String({ description: "Target trigger id. Required for `update` and `delete`." }),
  ),
  name: Type.Optional(Type.String({ description: "Human-readable trigger name shown in the UI." })),
  enabled: Type.Optional(
    Type.Boolean({ description: "Whether the trigger fires. New triggers default to enabled." }),
  ),
  type: Type.Optional(
    Type.Union([Type.Literal("time"), Type.Literal("event")], {
      description:
        "`time` fires on a cron schedule (needs `cron`); `event` fires when a matching named event is emitted (needs `event_name`). Required for `create`.",
    }),
  ),
  cron: Type.Optional(
    Type.String({
      description: "5- or 6-field cron expression, e.g. `0 9 * * *` for every day at 09:00. Required for `time` triggers.",
    }),
  ),
  event_name: Type.Optional(
    Type.String({
      description:
        "Exact event name this trigger listens for. Matching is exact, not fuzzy. Must not start with `sp:` (reserved). Required for `event` triggers.",
    }),
  ),
  mode: Type.Optional(
    Type.Union([Type.Literal("new_session"), Type.Literal("existing_session")], {
      description:
        "`new_session` starts a fresh session each time (recommended). `existing_session` continues `target_session_id`. Required for `create`.",
    }),
  ),
  target_session_id: Type.Optional(
    Type.String({ description: "Session the trigger continues. Required when `mode` is `existing_session`." }),
  ),
  message: Type.Optional(
    Type.String({
      description:
        "Message sent to the agent when the trigger fires. Supports `{{agentName}}` and `{{payload}}` template variables. Required for `create`.",
    }),
  ),
  notify: Type.Optional(
    Type.Boolean({ description: "Whether to show a desktop toast when the trigger completes. Defaults to false." }),
  ),
  notification_message: Type.Optional(
    Type.String({ description: "Toast text when `notify` is true. Max 30 characters." }),
  ),
});

export interface ManageTriggerDetails {
  cardType: "manage_trigger";
  action: string;
  agentId?: string;
  triggerId?: string;
  error?: boolean;
}

type ManageTriggerResult = {
  content: { type: "text"; text: string }[];
  details: ManageTriggerDetails;
};

const MAX_NOTIFICATION_LENGTH = 30;

function ok(action: string, text: string, extra?: Partial<ManageTriggerDetails>): ManageTriggerResult {
  return { content: [{ type: "text", text }], details: { cardType: "manage_trigger", action, ...extra } };
}

function fail(action: string, text: string): ManageTriggerResult {
  return {
    content: [{ type: "text", text: `Error: ${text}` }],
    details: { cardType: "manage_trigger", action, error: true },
  };
}

export function isManageTriggerWriteAction(params: unknown): boolean {
  const action = (params as { action?: unknown } | null)?.action;
  return action === "create" || action === "update" || action === "delete";
}

function validateShape(
  type: "time" | "event",
  cron: string | undefined,
  eventName: string | undefined,
): string | null {
  if (type === "time") {
    if (!cron?.trim()) return "`cron` is required for time triggers.";
    if (!isValidCron(cron)) return `invalid cron expression: ${cron}`;
    return null;
  }
  if (!eventName?.trim()) return "`event_name` is required for event triggers.";
  if (isReservedEventName(eventName)) return "`event_name` must not start with the reserved prefix `sp:`.";
  return null;
}

export function createManageTriggerTool(
  triggerManager: TriggerManager,
  projectStore: ProjectStore,
  currentAgentId?: string,
): AgentTool<typeof ManageTriggerParams, ManageTriggerDetails> {
  return {
    name: "manage_trigger",
    label: "Manage Triggers",
    description:
      "Inspect and edit the automation triggers of the agents in this project. A trigger runs an agent automatically, either on a cron schedule (`time`) or when a named event is emitted (`event`). " +
      "Trigger ids are generated by the app and cannot be chosen. Creating, updating and deleting requires explicit user approval before it takes effect.",
    parameters: ManageTriggerParams,
    async execute(_toolCallId, params) {
      const action = params.action;
      const agentId = params.agent_id ?? currentAgentId;
      if (!agentId) return fail(action, "`agent_id` is required (no current agent in context).");
      if (!projectStore.getAgent(agentId)) {
        return fail(action, `agent "${agentId}" not found. Use manage_agent with action "list" to see valid ids.`);
      }

      if (params.notification_message && params.notification_message.length > MAX_NOTIFICATION_LENGTH) {
        return fail(action, `\`notification_message\` must be ${MAX_NOTIFICATION_LENGTH} characters or less.`);
      }

      switch (action) {
        case "list": {
          const entries = triggerManager.list(agentId).map((entry) => ({
            ...entry,
            nextTriggerAt: triggerManager.getNextTrigger(agentId, entry.id)?.toISOString() ?? null,
          }));
          return ok(
            action,
            entries.length === 0
              ? `Agent "${agentId}" has no triggers.`
              : JSON.stringify(entries, null, 2),
            { agentId },
          );
        }
        case "create": {
          const type = params.type;
          if (!type) return fail(action, "`type` is required for `create` (`time` or `event`).");
          const shapeError = validateShape(type, params.cron, params.event_name);
          if (shapeError) return fail(action, shapeError);

          const mode = params.mode;
          if (!mode) return fail(action, "`mode` is required for `create` (`new_session` or `existing_session`).");
          if (requiresTargetSession(mode, params.target_session_id)) {
            return fail(action, "`target_session_id` is required when `mode` is `existing_session`.");
          }
          if (!params.message?.trim()) return fail(action, "`message` is required for `create`.");

          const now = Date.now();
          const notify = params.notify ?? false;
          const entry: TriggerEntry = {
            id: nanoid(),
            name: params.name?.trim() || undefined,
            enabled: params.enabled ?? true,
            type,
            cron: type === "time" ? params.cron : undefined,
            eventName: type === "event" ? params.event_name : undefined,
            mode,
            targetSessionId: params.target_session_id,
            message: params.message,
            notify,
            notificationMessage: notify ? params.notification_message : undefined,
            createdAt: now,
            updatedAt: now,
          };
          triggerManager.create(agentId, entry);
          return ok(action, `Trigger created:\n${JSON.stringify(entry, null, 2)}`, {
            agentId,
            triggerId: entry.id,
          });
        }
        case "update": {
          const triggerId = params.trigger_id;
          if (!triggerId) return fail(action, "`trigger_id` is required for `update`.");
          const existing = triggerManager.get(agentId, triggerId);
          if (!existing) return fail(action, `trigger "${triggerId}" not found on agent "${agentId}".`);

          const type = params.type ?? existing.type;
          const cron = params.cron ?? existing.cron;
          const eventName = params.event_name ?? existing.eventName;
          const shapeError = validateShape(type, cron, eventName);
          if (shapeError) return fail(action, shapeError);

          const mode = params.mode ?? existing.mode;
          const targetSessionId =
            params.target_session_id !== undefined ? params.target_session_id : existing.targetSessionId;
          if (requiresTargetSession(mode, targetSessionId)) {
            return fail(action, "`target_session_id` is required when `mode` is `existing_session`.");
          }
          if (params.message !== undefined && !params.message.trim()) {
            return fail(action, "`message` must not be empty.");
          }

          const notify = params.notify ?? existing.notify;
          const patch: Partial<TriggerEntry> = {
            name: params.name !== undefined ? params.name.trim() || undefined : existing.name,
            enabled: params.enabled ?? existing.enabled,
            type,
            cron: type === "time" ? cron : undefined,
            eventName: type === "event" ? eventName : undefined,
            mode,
            targetSessionId,
            message: params.message ?? existing.message,
            notify,
            notificationMessage: notify
              ? (params.notification_message ?? existing.notificationMessage)
              : undefined,
          };
          const updated = triggerManager.update(agentId, triggerId, patch);
          if (!updated) return fail(action, `trigger "${triggerId}" not found on agent "${agentId}".`);
          return ok(action, `Trigger updated:\n${JSON.stringify(updated, null, 2)}`, {
            agentId,
            triggerId,
          });
        }
        case "delete": {
          const triggerId = params.trigger_id;
          if (!triggerId) return fail(action, "`trigger_id` is required for `delete`.");
          const existing = triggerManager.get(agentId, triggerId);
          if (!existing) return fail(action, `trigger "${triggerId}" not found on agent "${agentId}".`);
          triggerManager.delete(agentId, triggerId);
          return ok(action, `Trigger "${existing.name || triggerId}" deleted.`, { agentId, triggerId });
        }
      }
    },
  };
}
