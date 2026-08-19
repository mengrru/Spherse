import { Agent } from "@earendil-works/pi-agent-core";
import type { AgentTool, StreamFn } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import type { AgentProfile, SamplingParams, TimePerceptionConfig } from "../types.js";
import { getChatStreamFn } from "../model-providers/index.js";
import type { ApprovalGate } from "../tools/with-approval.js";
import type { AskGate } from "../tools/ask-user.js";
import type { SkillStore } from "../store/skill.js";
import { readContextFiles } from "../context/read-context-files.js";
import {
  buildProjectInstructions,
  buildAgentProfile,
  buildSessionContext,
  buildPreloadedContext,
} from "../context/blocks.js";

import { isActiveTimePerception, wrapWithTimePerception } from "../context/time-perception.js";
import type { UserMessageWithAttachments } from "../attachments/index.js";
import type { ToolHost } from "../kernel/ports.js";
import { serializeBlocks, type ContextBlock } from "../kernel/context-block.js";
import { llmAccessPolicy } from "../access/access-policy.js";
import type { RuntimeDeps } from "./runtime.js";

export function composeStreamFn(
  sampling: SamplingParams | undefined,
  timePerception: TimePerceptionConfig | undefined,
): StreamFn {
  const base = getChatStreamFn(sampling);
  const withRetry: StreamFn = (model, context, options) =>
    base(model, context, { ...options, maxRetries: options?.maxRetries ?? 1 });
  return isActiveTimePerception(timePerception)
    ? wrapWithTimePerception(withRetry, timePerception)
    : withRetry;
}

export async function buildPromptAndTools(
  deps: RuntimeDeps,
  profile: AgentProfile,
  sessionId: string,
  agentSkillStore: SkillStore | undefined,
  approvalGate: ApprovalGate | undefined,
  askGate: AskGate | undefined,
): Promise<{ systemPrompt: string; tools: AgentTool[] }> {
  const pathRules = deps.capabilities.flatMap((c) => c.pathRules ?? []);
  const toolCatalog = { names: [] as string[] };
  const host: ToolHost = {
    agentId: profile.id,
    sessionId,
    projectRoot: deps.projectRoot,
    projectStore: deps.projectStore,
    fileWriteMutex: deps.fileWriteMutex,
    logger: deps.logger,
    stores: deps.stores,
    pathRules,
    toolCatalog,
    approvalGate: profile.yolo ? undefined : approvalGate,
    askGate,
  };

  const toolMap = new Map<string, AgentTool>();
  for (const capability of deps.capabilities) {
    if (!capability.tools) continue;
    for (const tool of capability.tools(host)) toolMap.set(tool.name, tool);
  }
  toolCatalog.names = [...toolMap.keys()];

  const toolNames = profile.tools ?? [];
  const tools: AgentTool[] = toolNames
    .map((name) => toolMap.get(name))
    .filter((t): t is AgentTool => Boolean(t));

  const agentsMd = await deps.projectStore.readIndex();
  const blocks: Array<ContextBlock | null> = [];
  blocks.push(buildProjectInstructions(agentsMd));
  blocks.push(buildAgentProfile(profile.systemPrompt));
  blocks.push(
    buildSessionContext({
      name: profile.name,
      alias: profile.alias,
      slug: profile.slug,
      sessionId,
      timePerceptionEnabled: isActiveTimePerception(profile.timePerception),
    }),
  );

  const files = await readContextFiles(deps.projectRoot, profile.context, () =>
    llmAccessPolicy(
      deps.projectStore.getRootPath(),
      deps.projectStore.config.getAiAccessSettings().deniedPaths,
      pathRules,
    ),
  );
  blocks.push(buildPreloadedContext(files));

  for (const capability of deps.capabilities) {
    if (!capability.contextBlocks) continue;
    try {
      const contributed = await capability.contextBlocks(host);
      blocks.push(...contributed);
    } catch (err) {
      deps.logger.warn({ err, capability: capability.id }, "capability context blocks failed");
    }
  }

  const systemPrompt = serializeBlocks(blocks);
  return { systemPrompt, tools };
}

export async function buildAgent(
  deps: RuntimeDeps,
  profile: AgentProfile,
  sessionId: string,
  agentSkillStore: SkillStore | undefined,
  approvalGate: ApprovalGate | undefined,
  askGate: AskGate | undefined,
): Promise<Agent> {
  const { systemPrompt, tools } = await buildPromptAndTools(
    deps,
    profile,
    sessionId,
    agentSkillStore,
    approvalGate,
    askGate,
  );

  const model = deps.modelResolver.resolveFor(profile, deps.runConfig.current().defaultModel);
  if (!model) {
    deps.logger.warn({ agentId: profile.id }, "model not resolvable, agent will wait for model config");
  }

  const streamFn = composeStreamFn(deps.runConfig.current().sampling, profile.timePerception);

  return new Agent({
    initialState: {
      systemPrompt,
      model,
      thinkingLevel: "medium",
      tools,
    },
    sessionId,
    streamFn,
    convertToLlm(messages) {
      return messages
        .map((m) => {
          if (m.role === "user") {
            const { _attachments, ...rest } = m as UserMessageWithAttachments;
            if (Array.isArray(rest.content)) {
              rest.content = rest.content.filter(
                (c) => !(c.type === "image" && !c.data),
              );
            }
            return rest;
          }
          return m;
        })
        .filter(
          (m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult",
        ) as Message[];
    },
  });
}
