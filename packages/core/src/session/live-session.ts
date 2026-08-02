import { Agent } from "@earendil-works/pi-agent-core";
import type { AgentEvent, AgentTool, AgentMessage } from "@earendil-works/pi-agent-core";
import type { Message, Model, Api } from "@earendil-works/pi-ai";
import type { AgentProfile, SamplingParams } from "../types.js";
import { resolveModelById, getChatStreamFn } from "../model-providers/index.js";
import { createToolsForProject, ToolContext } from "../tools/index.js";
import type { ApprovalGate } from "../tools/with-approval.js";
import type { SkillStore } from "../store/skill.js";
import { readContextFiles } from "../context/read-context-files.js";
import { logAgentEvent } from "../engine/log-agent-event.js";
import { NotFoundError, ModelNotConfiguredError } from "../errors.js";
import {
  buildProjectInstructions,
  buildAgentProfile,
  buildSessionContext,
  buildSkillCatalog,
  buildPreloadedContext,
  buildMcpContext,
} from "../context/blocks.js";
import type { ContextBlock } from "../context/blocks.js";
import { serializeSystemPrompt } from "../context/serialize.js";
import { estimateTokens } from "../context/token-estimate.js";
import { planCompaction, wrapDigestContent } from "../context/compaction.js";
import type { SessionContext, TurnContextSnapshot, SessionControlEvent } from "./types.js";
import { SessionControlBus } from "./control-bus.js";
import { createApprovalGate } from "./approval-gate.js";
import {
  resolveEffectiveModelId,
  extractLastUsageTotalTokens,
  type SessionStatus,
} from "./status.js";

export type AgentEventHandler = (event: AgentEvent | SessionControlEvent) => void;

function dedupeToolNames(
  existing: AgentTool[],
  incoming: AgentTool[],
): AgentTool[] {
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

export class LiveSession {
  private readonly agent: Agent;
  private readonly agentId: string;
  private readonly sessionId: string;
  private readonly ctx: SessionContext;
  private readonly liveMessageDbIds: number[] = [];
  private readonly controlBus: SessionControlBus;
  private mcpMerged = false;

  private constructor(
    agent: Agent,
    agentId: string,
    sessionId: string,
    ctx: SessionContext,
    controlBus: SessionControlBus,
  ) {
    this.agent = agent;
    this.agentId = agentId;
    this.sessionId = sessionId;
    this.ctx = ctx;
    this.controlBus = controlBus;
  }

  static async create(
    ctx: SessionContext,
    agentId: string,
    sessionId: string,
  ): Promise<LiveSession> {
    const agentStore = ctx.projectStore.getAgent(agentId);
    if (!agentStore) throw new NotFoundError(`Agent profile "${agentId}" not found`);
    const profile = agentStore.getProfile();
    const controlBus = new SessionControlBus();
    const agent = await this.buildAgent(ctx, profile, sessionId, agentStore.skills, createApprovalGate(controlBus));
    return new LiveSession(agent, agentId, sessionId, ctx, controlBus);
  }

  static async restore(
    ctx: SessionContext,
    agentId: string,
    sessionId: string,
  ): Promise<LiveSession> {
    const agentStore = ctx.projectStore.getAgent(agentId);
    if (!agentStore) throw new NotFoundError(`Agent "${agentId}" not found`);
    const session = agentStore.sessions.getSession(sessionId);
    if (!session) throw new NotFoundError(`Session "${sessionId}" not found`);

    const profile = agentStore.getProfile();
    const controlBus = new SessionControlBus();
    const agent = await this.buildAgent(ctx, profile, sessionId, agentStore.skills, createApprovalGate(controlBus));
    const live = new LiveSession(agent, agentId, sessionId, ctx, controlBus);

    const latest = agentStore.sessions.getLatestCompaction(sessionId);
    if (latest) {
      const digestMessage: AgentMessage = {
        role: "user",
        content: wrapDigestContent(latest.digestContent),
        timestamp: latest.createdAt,
      } as any;
      const tailRows = agentStore.sessions.getMessagesAfter(sessionId, latest.anchorMessageId);
      agent.state.messages = [digestMessage, ...tailRows.map((r) => r.message)] as AgentMessage[];
      live.liveMessageDbIds.push(latest.anchorMessageId, ...tailRows.map((r) => r.id));
    } else {
      const rows = agentStore.sessions.getSessionMessagesWithIds(sessionId);
      agent.state.messages = rows.map((r) => r.message) as AgentMessage[];
      live.liveMessageDbIds.push(...rows.map((r) => r.id));
    }
    return live;
  }

  getAgentId(): string {
    return this.agentId;
  }

  async sendMessage(message: string, onEvent: AgentEventHandler): Promise<void> {
    this.ensureModel();
    await this.ensureMcpTools();
    const sessionLogger = this.ctx.logger.child({ sessionId: this.sessionId });
    const agentStore = this.ctx.projectStore.getAgent(this.agentId);

    this.controlBus.setEventSink(onEvent);
    const unsubscribe = this.agent.subscribe((event) => {
      logAgentEvent(sessionLogger, event);
      onEvent(event);
      if (event.type === "message_end") {
        const msgId = agentStore?.sessions.appendMessage(this.sessionId, event.message);
        if (msgId !== undefined) this.liveMessageDbIds.push(msgId);
      }
    });

    try {
      await this.agent.prompt(message);
      await this.maybeCompact();
    } finally {
      unsubscribe();
      this.controlBus.setEventSink(null);
    }
  }

  private ensureModel(): void {
    const profile = this.ctx.projectStore.getAgent(this.agentId)?.getProfile();
    if (!profile) throw new NotFoundError(`Agent "${this.agentId}" not found`);
    const modelId = resolveEffectiveModelId(profile, this.ctx.defaultModel);
    if (!modelId) throw new ModelNotConfiguredError();
    try {
      this.agent.state.model = resolveModelById(modelId);
    } catch {
      throw new ModelNotConfiguredError();
    }
  }

  private async ensureMcpTools(): Promise<void> {
    if (this.mcpMerged) return;
    this.mcpMerged = true;
    try {
      const { tools: mcpTools, info } = await this.ctx.mcpConnectionManager.load(this.agentId);
      if (mcpTools.length > 0) {
        const current = this.agent.state.tools;
        this.agent.state.tools = [...current, ...dedupeToolNames(current, mcpTools)];
      }
      const block = buildMcpContext(info);
      if (block) {
        this.agent.state.systemPrompt += "\n\n" + serializeSystemPrompt([block]);
      }
    } catch (err) {
      this.ctx.logger.warn({ err, sessionId: this.sessionId }, "ensure mcp tools failed");
    }
  }

  abort(): void {
    this.controlBus.rejectAll("session aborted");
    this.agent.abort();
  }

  resolveControlRequest(requestId: string, decision: unknown): void {
    this.controlBus.resolve(requestId, decision);
  }

  getTurnContext(): TurnContextSnapshot {
    return {
      sessionId: this.sessionId,
      capturedAt: new Date().toISOString(),
      systemPrompt: this.agent.state.systemPrompt,
      messages: this.agent.state.messages,
      tools: this.agent.state.tools.map((tool: any) => ({
        name: tool.name,
        description: tool.description ?? "",
        parameters: tool.parameters,
      })),
    };
  }

  getStatus(): SessionStatus {
    return {
      currentTokens: this.readCurrentTokens(),
      contextWindowLimit: (this.agent.state.model as { contextWindow?: number } | undefined)?.contextWindow ?? null,
    };
  }

  applyDefaultModel(globalDefaultModel: string | undefined): void {
    const profile = this.ctx.projectStore.getAgent(this.agentId)?.getProfile();
    if (!profile) return;
    const modelId = resolveEffectiveModelId(profile, globalDefaultModel);
    if (!modelId) return;
    try {
      const resolved = resolveModelById(modelId);
      const current = this.agent.state.model;
      if (current?.id !== resolved.id || current?.provider !== resolved.provider) {
        this.agent.state.model = resolved;
      }
    } catch (err) {
      this.ctx.logger.error({ err, agentId: this.agentId }, "failed to re-resolve model for active agent");
    }
  }

  applySampling(sampling: SamplingParams | undefined): void {
    this.agent.streamFn = getChatStreamFn(sampling);
  }

  private async maybeCompact(): Promise<void> {
    const currentTokens = this.readCurrentTokens();
    const contextWindow = (this.agent.state.model as any)?.contextWindow ?? 32768;

    const plan = planCompaction(this.agent.state.messages as Message[], {
      currentTokens,
      contextWindow,
    });

    if (!plan.shouldCompact || !plan.digest) return;

    const agentStore = this.ctx.projectStore.getAgent(this.agentId);
    if (!agentStore) return;

    if (plan.anchorIndex < 0 || plan.anchorIndex >= this.liveMessageDbIds.length) return;

    const anchorMessageId = this.liveMessageDbIds[plan.anchorIndex];

    try {
      const digestMessage: AgentMessage = {
        role: "user",
        content: wrapDigestContent(plan.digest),
        timestamp: Date.now(),
      } as any;
      const postBuffer: AgentMessage[] = [digestMessage, ...plan.tail];
      const postEstimate =
        estimateTokens(this.agent.state.systemPrompt) + estimateTokens(postBuffer as Message[]);

      agentStore.sessions.recordCompaction(this.sessionId, {
        anchorMessageId,
        digestContent: plan.digest,
        tokenEstimate: postEstimate,
      });

      this.agent.state.messages = postBuffer;
      const tail = this.liveMessageDbIds.slice(plan.anchorIndex + 1);
      this.liveMessageDbIds.length = 0;
      this.liveMessageDbIds.push(anchorMessageId, ...tail);
      this.ctx.logger.info(
        {
          sessionId: this.sessionId,
          anchorMessageId,
          compactedMessages: plan.anchorIndex + 1,
          tokensBefore: currentTokens,
          tokensAfter: postEstimate,
        },
        "compaction applied",
      );
    } catch (err) {
      this.ctx.logger.error({ err, sessionId: this.sessionId }, "compaction failed, keeping live buffer");
    }
  }

  private readCurrentTokens(): number {
    const messages = this.agent.state.messages;
    const lastUsage = extractLastUsageTotalTokens(messages);
    if (lastUsage !== null) return lastUsage;
    const systemPromptTokens = estimateTokens(this.agent.state.systemPrompt);
    const messageTokens = estimateTokens(messages as Message[]);
    return systemPromptTokens + messageTokens;
  }

  private static async buildAgent(
    ctx: SessionContext,
    profile: AgentProfile,
    sessionId: string,
    agentSkillStore?: SkillStore,
    approvalGate?: ApprovalGate,
  ): Promise<Agent> {
    const projectRoot = ctx.projectRoot;
    const toolContext = new ToolContext(
      ctx.projectStore,
      ctx.fileWriteMutex,
      profile.slug,
      agentSkillStore,
      ctx.triggerManager,
      approvalGate,
    );
    const allTools = createToolsForProject(toolContext);

    const toolNames = profile.tools ?? [];
    const tools: AgentTool[] = toolNames
      .map((name) => allTools[name])
      .filter(Boolean);

    const agentsMd = await ctx.projectStore.readIndex();
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

    const globalSkills = await ctx.projectStore.skill.list();
    const byName = new Map<string, { name: string; description: string }>();
    for (const s of globalSkills) byName.set(s.name, { name: s.name, description: s.description });
    if (agentSkillStore) {
      const agentSkills = await agentSkillStore.list();
      for (const s of agentSkills) byName.set(s.name, { name: s.name, description: s.description });
    }
    blocks.push(buildSkillCatalog([...byName.values()]));

    const files = await readContextFiles(projectRoot, profile.context, () => toolContext.llmPolicy);
    blocks.push(buildPreloadedContext(files));

    const systemPrompt = serializeSystemPrompt(blocks);

    const modelId = resolveEffectiveModelId(profile, ctx.defaultModel);
    let model: Model<Api> | undefined;
    if (modelId) {
      try {
        model = resolveModelById(modelId);
      } catch (err) {
        ctx.logger.warn({ err, modelId, agentId: profile.id }, "model not resolvable, agent will wait for model config");
      }
    }

    return new Agent({
      initialState: {
        systemPrompt,
        model,
        thinkingLevel: "medium",
        tools,
      },
      sessionId,
      streamFn: getChatStreamFn(ctx.sampling),
    });
  }
}
