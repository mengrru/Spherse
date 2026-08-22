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

  const turnHooks: TurnHooksFactory = () => ({
    async afterTurn(agent, eventLog) {
      await maybeCompactLog(eventLog, agent, logger);
    },
  });

  return {
    id: "compaction",
    turnHooks,
  };
}
