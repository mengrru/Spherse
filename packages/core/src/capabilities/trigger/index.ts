import type { KernelServices } from "../../kernel/ports.js";
import type { Capability } from "../../kernel/capability.js";
import { TriggerManager } from "../../trigger/trigger-manager.js";
import { TimerService } from "../../trigger/timer-service.js";
import { createEmitTriggerEventTool } from "../../tools/emit-trigger-event.js";
import { createManageTriggerTool, isManageTriggerWriteAction } from "../../tools/manage-trigger.js";
import { withApproval } from "../../tools/with-approval.js";
import type { ProjectStore } from "../../store/project.js";
import type { Logger } from "../../logger.js";

export interface TriggerCapabilityDeps {
  readonly projectStore: ProjectStore;
  readonly logger?: Logger;
}

export interface TriggerCapability extends Capability {
  readonly manager: TriggerManager;
  readonly timerService: TimerService;
}

export function createTriggerCapability(deps: TriggerCapabilityDeps): TriggerCapability {
  let manager: TriggerManager | undefined;
  let timerService: TimerService | undefined;

  const ensure = (services: KernelServices): TriggerManager => {
    if (!manager) {
      manager = new TriggerManager({
        sessionRuntime: services.session,
        projectStore: deps.projectStore,
        logger: deps.logger ?? services.logger,
      });
      timerService = new TimerService(() => manager!.onTimeTick(), deps.logger);
      timerService.start();
    }
    return manager;
  };

  const capability: TriggerCapability = {
    id: "trigger",
    init: async (services) => {
      ensure(services);
    },
    tools: (host) => {
      if (!manager) throw new Error("trigger capability used before init");
      return [
        createEmitTriggerEventTool(manager),
        withApproval(
          createManageTriggerTool(manager, deps.projectStore, host.agentId),
          host.approvalGate,
          isManageTriggerWriteAction,
        ),
      ];
    },
    onAgentDeleted: (agentId) => manager?.deleteAllForAgent(agentId),
    shutdown: async () => {
      timerService?.stop();
      manager?.stopAll();
    },
    get manager(): TriggerManager {
      if (!manager) throw new Error("trigger capability used before init");
      return manager;
    },
    get timerService(): TimerService {
      if (!timerService) throw new Error("trigger capability used before init");
      return timerService;
    },
  };
  return capability;
}
