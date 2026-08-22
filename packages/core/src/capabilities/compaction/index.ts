import type { Capability } from "../../kernel/capability.js";
import type { TurnHooksFactory } from "../../kernel/turn-hooks.js";
import { maybeCompactLog, type MaybeCompactDeps } from "./transform.js";

export function compactionCapability(deps: MaybeCompactDeps): Capability {
  const turnHooks: TurnHooksFactory = (_agentId, sessionId) => ({
    async afterTurn(agent, eventLog) {
      await maybeCompactLog(eventLog, agent, sessionId, deps);
    },
  });

  return {
    id: "compaction",
    turnHooks,
  };
}
