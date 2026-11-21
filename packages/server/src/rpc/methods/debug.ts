import { Type } from "@sinclair/typebox";
import { schemas, parseContract } from "@spherse/contracts";
import { defineRpcMethod } from "../context.js";

const turnContext = defineRpcMethod(
  Type.Object({ projectId: Type.String(), sessionId: Type.String() }),
  (params, ctx) => {
    const { sessionRuntime } = ctx.resolveProject(params.projectId);
    return parseContract(
      schemas.turnContextSnapshot,
      sessionRuntime.getTurnContext(params.sessionId),
    );
  },
);

const sessionEvents = defineRpcMethod(
  Type.Object({
    projectId: Type.String(),
    agentId: Type.String({ minLength: 1 }),
    sessionId: Type.String(),
  }),
  (params, ctx) => {
    const { sessionRuntime } = ctx.resolveProject(params.projectId);
    const events = sessionRuntime.readSessionEventsAfter(
      params.agentId,
      params.sessionId,
      -1,
      Number.MAX_SAFE_INTEGER,
    );
    return parseContract(schemas.sessionEventLog, {
      sessionId: params.sessionId,
      events,
    });
  },
);

export const debugMethods: Record<string, ReturnType<typeof defineRpcMethod>> = {
  "debug.turnContext": turnContext,
  "debug.sessionEvents": sessionEvents,
};
