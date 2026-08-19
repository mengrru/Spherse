import type { Capability } from "../../kernel/capability.js";
import type { TurnHooksFactory } from "../../kernel/turn-hooks.js";
import { maybeCompactLog } from "./transform.js";
import { createSilentLogger, type Logger } from "../../logger.js";
import type { ProjectStore } from "../../store/project.js";

export function compactionCapability(deps: {
  projectStore: ProjectStore;
  logger?: Logger;
}): Capability {
  const logger = deps.logger ?? createSilentLogger();

  const turnHooks: TurnHooksFactory = (agentId, sessionId) => ({
    async afterTurn(agent, log) {
      const agentStore = deps.projectStore.getAgent(agentId);
      if (!agentStore) return log;
      return maybeCompactLog(log, agent, agentStore.sessions, sessionId, logger);
    },
  });

  return {
    id: "compaction",
    turnHooks,
  };
}
