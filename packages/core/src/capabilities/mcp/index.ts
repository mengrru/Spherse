import type { AgentTool } from "@earendil-works/pi-agent-core";
import { McpConnectionManager } from "../../mcp/mcp-connection-manager.js";
import type { Capability } from "../../kernel/capability.js";
import type { KernelServices } from "../../kernel/ports.js";
import type { TurnHooksFactory } from "../../kernel/turn-hooks.js";
import type { ProjectStore } from "../../store/project.js";
import type { Logger } from "../../logger.js";
import { mcpContextBlock } from "./block.js";

function dedupeToolNames(existing: AgentTool[], incoming: AgentTool[]): AgentTool[] {
  const used = new Set<string>();
  for (const t of existing) used.add(t.name);
  const result: AgentTool[] = [];
  for (const tool of incoming) {
    if (!used.has(tool.name)) {
      used.add(tool.name);
      result.push(tool);
      continue;
    }
    let suffix = 2;
    let candidate = `${tool.name}__${suffix}`;
    while (used.has(candidate)) {
      suffix += 1;
      candidate = `${tool.name}__${suffix}`;
    }
    used.add(candidate);
    result.push({ ...tool, name: candidate });
  }
  return result;
}

export interface McpCapabilityDeps {
  readonly projectStore: ProjectStore;
  readonly logger?: Logger;
}

export interface McpCapability extends Capability {
  readonly manager: McpConnectionManager;
  invalidate(agentId: string): Promise<void>;
}

export function createMcpCapability(deps: McpCapabilityDeps): McpCapability {
  let manager: McpConnectionManager | undefined;
  let currentLogger: Logger | undefined = deps.logger;

  const ensure = (services?: KernelServices): McpConnectionManager => {
    if (!manager) {
      manager = new McpConnectionManager(
        currentLogger ?? services?.logger,
        undefined,
        async (agentId) => {
          const agentStore = deps.projectStore.getAgent(agentId);
          if (!agentStore) return [];
          try {
            return (await agentStore.mcp.getConfig()).servers;
          } catch (err) {
            (currentLogger ?? services?.logger)?.warn({ err, agentId }, "failed to load agent mcp config");
            return [];
          }
        },
      );
    }
    return manager;
  };

  const turnHooks: TurnHooksFactory = (agentId, sessionId) => {
    let mergedAtVersion: number | null = null;
    return {
      async beforeTurn(agent) {
        const version = ensure().configVersion(agentId);
        if (mergedAtVersion === version) return;
        mergedAtVersion = version;
        try {
          const { tools: mcpTools, info } = await ensure().load(agentId);
          if (mcpTools.length > 0) {
            const current = agent.state.tools;
            agent.state.tools = [...current, ...dedupeToolNames(current, mcpTools)];
          }
          const block = mcpContextBlock(info);
          if (block) {
            agent.state.systemPrompt += "\n\n" + block.render();
          }
        } catch (err) {
          (currentLogger)?.warn({ err, sessionId }, "mcp merge hook failed");
        }
      },
      onReload() {
        mergedAtVersion = null;
      },
    };
  };

  const capability: McpCapability = {
    id: "mcp",
    init: async (services) => {
      currentLogger = services.logger;
      ensure(services);
    },
    turnHooks,
    onAgentDeleted: (agentId) => ensure().invalidate(agentId),
    invalidateAgent: (agentId) => ensure().invalidate(agentId),
    shutdown: () => (manager ? manager.closeAll() : Promise.resolve()),
    invalidate: (agentId) => ensure().invalidate(agentId),
    get manager(): McpConnectionManager {
      return ensure();
    },
  };
  return capability;
}
