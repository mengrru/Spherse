import type { AgentTool } from "@earendil-works/pi-agent-core";
import { McpConnectionManager, type McpLoadServersFn } from "../../mcp/mcp-connection-manager.js";
import type { Capability } from "../../kernel/capability.js";
import type { TurnHooksFactory } from "../../kernel/turn-hooks.js";
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

export interface McpCapability extends Capability {
  readonly manager: McpConnectionManager;
  invalidate(agentId: string): Promise<void>;
}

export function createMcpCapability(deps: {
  logger?: Logger;
  loadServers: McpLoadServersFn;
}): McpCapability {
  const manager = new McpConnectionManager(deps.logger, undefined, deps.loadServers);

  const turnHooks: TurnHooksFactory = (agentId, sessionId) => {
    let merged = false;
    return {
      async beforeTurn(agent) {
        if (merged) return;
        merged = true;
        try {
          const { tools: mcpTools, info } = await manager.load(agentId);
          if (mcpTools.length > 0) {
            const current = agent.state.tools;
            agent.state.tools = [...current, ...dedupeToolNames(current, mcpTools)];
          }
          const block = mcpContextBlock(info);
          if (block) {
            agent.state.systemPrompt += "\n\n" + block.render();
          }
        } catch (err) {
          deps.logger?.warn({ err, sessionId }, "mcp merge hook failed");
        }
      },
      onReload() {
        merged = false;
      },
    };
  };

  return {
    id: "mcp",
    turnHooks,
    shutdown: () => manager.closeAll(),
    manager,
    invalidate: (agentId) => manager.invalidate(agentId),
  };
}
