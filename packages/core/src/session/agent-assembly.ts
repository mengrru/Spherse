import { Agent } from "@earendil-works/pi-agent-core";
import type { AgentMessage, AgentTool, StreamFn } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import type { AgentProfile, SamplingParams } from "../types.js";

import type { ApprovalGate, AskGate } from "../kernel/gates.js";
import { readContextFiles, type ContextFile } from "./read-context-files.js";


import type { Capability } from "../kernel/capability.js";
import type { SessionView, ToolHost } from "../kernel/ports.js";
import { serializeBlocks, type ContextBlock } from "../kernel/context-block.js";
import { llmPolicyOf } from "../capabilities/shared/llm-policy.js";
import { escapeXmlAttr } from "../utils/xml-escape.js";
import type { RuntimeDeps } from "./runtime.js";

export function composeStreamFn(
  catalog: Pick<import("../model-providers/catalog.js").ModelCatalog, "getChatStreamFn">,
  sampling: SamplingParams | undefined,
  decorators: ReadonlyArray<(base: StreamFn) => StreamFn> = [],
): StreamFn {
  const base = catalog.getChatStreamFn(sampling);
  let fn: StreamFn = (model, context, options) =>
    base(model, context, { ...options, maxRetries: options?.maxRetries ?? 1 });
  for (const decorate of decorators) {
    fn = decorate(fn);
  }
  return fn;
}

function resolveSources<T>(
  capabilities: ReadonlyArray<Capability>,
  select: (capability: Capability) => ReadonlyArray<(view: SessionView) => T | undefined> | undefined,
  view: SessionView,
): T[] {
  const resolved: T[] = [];
  for (const capability of capabilities) {
    for (const source of select(capability) ?? []) {
      const item = source(view);
      if (item) resolved.push(item);
    }
  }
  return resolved;
}

export function contextProjectorsFor(
  capabilities: ReadonlyArray<Capability>,
  view: SessionView,
): Array<(messages: readonly AgentMessage[]) => AgentMessage[]> {
  return resolveSources(capabilities, (capability) => capability.contextProjectors, view);
}

export function previewTransformsFor(
  capabilities: ReadonlyArray<Capability>,
  view: SessionView,
): Array<(messages: readonly AgentMessage[]) => AgentMessage[]> {
  // Mirror the wire onion order: composeStreamFn wraps later-registered
  // decorators outermost, so their message rewrites apply FIRST on the wire.
  // Reversing registration order makes forward iteration here replay the
  // same pipeline the LLM request actually goes through.
  return resolveSources(capabilities, (capability) => capability.previewTransforms, view).reverse();
}

export function streamDecoratorsFor(
  capabilities: ReadonlyArray<Capability>,
  view: SessionView,
): Array<(base: StreamFn) => StreamFn> {
  return resolveSources(capabilities, (capability) => capability.streamDecorators, view);
}

interface SessionMeta {
  name: string;
  alias?: string;
  slug: string;
  sessionId: string;
}

export function buildProjectInstructions(content: string): ContextBlock | null {
  if (content.trim() === "") return null;
  return {
    kind: "project-instructions",
    render: () => `<project-instructions>\n${content}\n</project-instructions>`,
  };
}

export function buildAgentProfile(content: string): ContextBlock | null {
  if (content.trim() === "") return null;
  return {
    kind: "agent-profile",
    render: () => `<agent-profile>\n${content}\n</agent-profile>`,
  };
}

export function buildSessionContext(meta: SessionMeta): ContextBlock {
  return {
    kind: "session-context",
    render: () => {
      const lines = [`agent-name: ${meta.name}`];
      if (meta.alias) {
        lines.push(`agent-alias: ${meta.alias}`);
      }
      lines.push(`agent-slug: ${meta.slug}`);
      lines.push(`session-id: ${meta.sessionId}`);
      return `<session-context>\n${lines.join("\n")}\n</session-context>`;
    },
  };
}

export function buildPreloadedContext(files: ContextFile[]): ContextBlock | null {
  if (files.length === 0) return null;
  return {
    kind: "preloaded-context",
    render: () => {
      const rendered = files
        .map((f) => `<context-file path="${escapeXmlAttr(f.path)}">\n${f.content}\n</context-file>`)
        .join("\n");
      return `<preloaded-context>\n${rendered}\n</preloaded-context>`;
    },
  };
}

export async function buildPromptAndTools(
  deps: RuntimeDeps,
  profile: AgentProfile,
  sessionId: string,
  approvalGate: ApprovalGate | undefined,
  askGate: AskGate | undefined,
): Promise<{ systemPrompt: string; tools: AgentTool[] }> {
  const pathRules = deps.capabilities.flatMap((c) => c.pathRules ?? []);
  const toolCatalog = { names: [] as string[] };
  const host: ToolHost = {
    agentId: profile.id,
    sessionId,
    profile,
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
    }),
  );

  const files = await readContextFiles(deps.projectRoot, profile.context, llmPolicyOf(host));
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
  approvalGate: ApprovalGate | undefined,
  askGate: AskGate | undefined,
): Promise<Agent> {
  const { systemPrompt, tools } = await buildPromptAndTools(
    deps,
    profile,
    sessionId,
    approvalGate,
    askGate,
  );

  const model = deps.modelResolver.resolveFor(profile, deps.runConfig.current().defaultModel);
  if (!model) {
    deps.logger.warn({ agentId: profile.id }, "model not resolvable, agent will wait for model config");
  }

  const streamFn = composeStreamFn(
    deps.modelCatalog,
    deps.runConfig.current().sampling,
    streamDecoratorsFor(deps.capabilities, { agentId: profile.id, profile, projectStore: deps.projectStore, stores: deps.stores }),
  );

  const view = {
    agentId: profile.id,
    profile,
    projectStore: deps.projectStore,
    stores: deps.stores,
  };
  const projectors = contextProjectorsFor(deps.capabilities, view);

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
      let projected: AgentMessage[] = messages;
      for (const project of projectors) {
        projected = project(projected);
      }
      return projected.filter(
        (m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult",
      ) as Message[];
    },
  });
}
