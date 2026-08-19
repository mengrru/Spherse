import type { Capability } from "../../kernel/capability.js";
import type { SessionPort } from "../../kernel/ports.js";
import { TriggerManager } from "../../trigger/trigger-manager.js";
import { TimerService } from "../../trigger/timer-service.js";
import { createEmitTriggerEventTool } from "../../tools/emit-trigger-event.js";
import { createManageTriggerTool, isManageTriggerWriteAction } from "../../tools/manage-trigger.js";
import { withApproval } from "../../tools/with-approval.js";
import type { ProjectStore } from "../../store/project.js";
import type { Logger } from "../../logger.js";

export interface TriggerCapabilityDeps {
  readonly projectStore: ProjectStore;
  readonly getSessionPort: () => SessionPort;
  readonly logger?: Logger;
}

export interface TriggerCapability extends Capability {
  readonly manager: TriggerManager;
  readonly timerService: TimerService;
}

export function createTriggerCapability(deps: TriggerCapabilityDeps): TriggerCapability {
  const port: SessionPort = {
    createSession: (agentId, source) => deps.getSessionPort().createSession(agentId, source),
    restoreSession: (agentId, sessionId) => deps.getSessionPort().restoreSession(agentId, sessionId),
    sendMessage: (sessionId, message, onEvent) =>
      deps.getSessionPort().sendMessage(sessionId, message, onEvent),
    sessionExists: (agentId, sessionId) => deps.getSessionPort().sessionExists(agentId, sessionId),
  };
  const manager = new TriggerManager({
    sessionRuntime: port,
    projectStore: deps.projectStore,
    logger: deps.logger,
  });
  const timerService = new TimerService(() => manager.onTimeTick(), deps.logger);
  timerService.start();

  const capability: TriggerCapability = {
    id: "trigger",
    tools: (host) => [
      createEmitTriggerEventTool(manager),
      withApproval(
        createManageTriggerTool(manager, deps.projectStore, host.agentId),
        host.approvalGate,
        isManageTriggerWriteAction,
      ),
    ],
    onAgentDeleted: (agentId) => manager.deleteAllForAgent(agentId),
    shutdown: async () => {
      timerService.stop();
      manager.stopAll();
    },
    manager,
    timerService,
  };
  return capability;
}
