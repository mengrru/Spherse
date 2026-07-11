import { registerAction } from "../registry";
import { useBusStore } from "../../stores/bus-store";

registerAction("emitAgentTriggerEvent", (params, ctx) => {
  const { eventName, payload } = params as { eventName: string; payload?: string };
  if (!eventName?.trim()) return;
  useBusStore.getState().emitAgentTriggerEvent(ctx.projectId, eventName, payload);
});
