import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { TriggerManager } from "../trigger/trigger-manager.js";

const EmitTriggerEventParams = Type.Object({
  event_name: Type.String({
    description:
      "Name of the event to emit. Must be provided exactly as configured on the target agent's event trigger (no fuzzy/partial matching). Any agent with an enabled event trigger matching this name exactly will fire. Must NOT start with `sp:` (reserved for internal events).",
  }),
  payload: Type.Optional(
    Type.String({
      description:
        "Optional message payload string. Injected into the triggered agent's message via the {{payload}} template variable. If the user does not explicitly provide one, leave this empty/omitted — it defaults to an empty string.",
    }),
  ),
});

export function createEmitTriggerEventTool(
  triggerManager: TriggerManager,
): AgentTool<typeof EmitTriggerEventParams> {
  return {
    name: "emit_trigger_event",
    label: "Emit Trigger Event",
    description:
      "Emit a named event that triggers event-type triggers on agents in the current project. " +
      "This is the same mechanism as user-emitted events: every agent with an enabled event trigger whose event name matches will run its trigger task. " +
      "Use this to let one agent kick off work on other agents (e.g. hand off a completed chapter for review). " +
      "Event names starting with `sp:` are reserved and will be rejected.",
    parameters: EmitTriggerEventParams,
    async execute(_toolCallId, params, _signal) {
      const eventName = params.event_name.trim();
      if (!eventName) {
        return {
          content: [
            { type: "text" as const, text: "Error: `event_name` must not be empty." },
          ],
          details: { error: true },
        };
      }
      if (eventName.startsWith("sp:")) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: event names starting with `sp:` are reserved for internal use and cannot be emitted.",
            },
          ],
          details: { error: true, reserved: true },
        };
      }

      const payload = params.payload ?? "";
      const firedCount = triggerManager.onUserEvent(eventName, payload);

      if (firedCount === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Event "${eventName}" emitted, but no enabled event trigger matched this name. Nothing will run. Check that the target agent has an enabled event trigger with exactly this event name.`,
            },
          ],
          details: { eventName, payload, firedCount: 0 },
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Event "${eventName}" emitted — ${firedCount} trigger(s) fired. The triggered agent(s) will run in the background; results are available in the trigger logs.`,
          },
        ],
        details: { eventName, payload, firedCount },
      };
    },
  };
}
