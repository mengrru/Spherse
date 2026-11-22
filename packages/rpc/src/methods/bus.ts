import { Type } from "@sinclair/typebox";
import { schemas, parseContract } from "@spherse/contracts";
import { defineRpcMethod, type RpcMethodEntry } from "../context.js";

const emitTriggerEvent = defineRpcMethod(
  Type.Object({
    projectId: Type.String(),
    eventName: Type.String({ minLength: 1 }),
    payload: Type.Optional(Type.String()),
  }),
  (params, ctx) => {
    const { triggerManager } = ctx.resolveProject(params.projectId);
    triggerManager.onUserEvent(params.eventName, params.payload ?? "");
    return parseContract(schemas.okResponse, { ok: true });
  },
);

export const busMethods: Record<string, RpcMethodEntry> = {
  "bus.emitTriggerEvent": emitTriggerEvent,
};
