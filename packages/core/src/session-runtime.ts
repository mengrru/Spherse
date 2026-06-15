import { Agent } from "@mariozechner/pi-agent-core";
import { streamSimple } from "@earendil-works/pi-ai";
import type { AgentEvent, AgentTool } from "@mariozechner/pi-agent-core";
import type { AgentProfile } from "./types.js";
import { resolveModelById } from "./model-providers.js";
import { ProjectStore } from "./store/project.js";
import { createToolsForProject, ToolContext } from "./tools/index.js";
import { FileWriteMutex } from "./utils/file-write-mutex.js";
import { readContextFiles } from "./engine/read-context-files.js";
import { type Logger, createSilentLogger } from "./logger.js";
import { logAgentEvent } from "./engine/log-agent-event.js";

export type AgentEventHandler = (event: AgentEvent) => void;

export interface TurnContextSnapshot {
  sessionId: string;
  capturedAt: string;
  systemPrompt: string;
  messages: unknown[];
  tools: Array<{
    name: string;
    description: string;
    parameters: unknown;
  }>;
}

export class SessionRuntime {
  private projectStore: ProjectStore;
  private activeSessions: Map<string, { agent: Agent; agentId: string }> = new Map();
  private globalDefaultModel?: string;
  private fileWriteMutex: FileWriteMutex;
  private logger: Logger;

  constructor(
    projectStore: ProjectStore,
    options?: { defaultModel?: string; logger?: Logger },
  ) {
    this.projectStore = projectStore;
    this.globalDefaultModel = options?.defaultModel;
    this.fileWriteMutex = new FileWriteMutex();
    this.logger = options?.logger ?? createSilentLogger();
  }

  setDefaultModel(model: string | undefined): void {
    this.globalDefaultModel = model;
  }

  async createSession(agentId: string, source?: string): Promise<string> {
    const agentStore = this.projectStore.getAgent(agentId);
    if (!agentStore) throw new Error(`Agent profile "${agentId}" not found`);

    const profile = agentStore.getProfile();
    const sessionId = agentStore.sessions.createSession(undefined, source);
    const agent = await this.buildAgent(profile, sessionId);
    this.activeSessions.set(sessionId, { agent, agentId });
    this.logger.info({ sessionId, agentId }, "session created");
    return sessionId;
  }

  async restoreSession(agentId: string, sessionId: string): Promise<string> {
    if (this.activeSessions.has(sessionId)) return sessionId;

    const agentStore = this.projectStore.getAgent(agentId);
    if (!agentStore) throw new Error(`Agent "${agentId}" not found`);

    const session = agentStore.sessions.getSession(sessionId);
    if (!session) throw new Error(`Session "${sessionId}" not found`);

    const profile = agentStore.getProfile();
    const agent = await this.buildAgent(profile, sessionId);
    agent.state.messages = agentStore.sessions.getSessionMessages(sessionId);
    this.activeSessions.set(sessionId, { agent, agentId });
    this.logger.info({ sessionId }, "session restored");
    return sessionId;
  }

  async sendMessage(
    sessionId: string,
    message: string,
    onEvent: AgentEventHandler,
  ): Promise<void> {
    const entry = this.activeSessions.get(sessionId);
    if (!entry) throw new Error(`No active session "${sessionId}"`);

    const { agent, agentId } = entry;
    const sessionLogger = this.logger.child({ sessionId });
    const agentStore = this.projectStore.getAgent(agentId);

    const unsubscribe = agent.subscribe((event) => {
      logAgentEvent(sessionLogger, event);
      onEvent(event);
      if (event.type === "message_end") {
        agentStore?.sessions.appendMessage(sessionId, event.message);
      }
    });

    try {
      await agent.prompt(message);
    } finally {
      unsubscribe();
    }
  }

  abortSession(sessionId: string): void {
    const entry = this.activeSessions.get(sessionId);
    if (entry) entry.agent.abort();
  }

  destroySession(sessionId: string): void {
    this.activeSessions.delete(sessionId);
  }

  hasActiveSession(sessionId: string): boolean {
    return this.activeSessions.has(sessionId);
  }

  getTurnContext(sessionId: string): TurnContextSnapshot {
    const entry = this.activeSessions.get(sessionId);
    if (!entry) throw new Error(`No active session "${sessionId}"`);
    const { agent } = entry;

    return {
      sessionId,
      capturedAt: new Date().toISOString(),
      systemPrompt: agent.state.systemPrompt,
      messages: agent.state.messages,
      tools: agent.state.tools.map((tool: any) => ({
        name: tool.name,
        description: tool.description ?? "",
        parameters: tool.parameters,
      })),
    };
  }

  evictAgent(agentId: string): void {
    for (const [sessionId, entry] of this.activeSessions) {
      if (entry.agentId === agentId) {
        this.activeSessions.delete(sessionId);
      }
    }
  }

  closeAll(): void {
    this.activeSessions.clear();
  }

  private async buildAgent(
    profile: AgentProfile,
    sessionId: string,
  ): Promise<Agent> {
    const config = this.projectStore.config.get();
    const projectRoot = this.projectStore.getRootPath();
    const toolContext = new ToolContext(this.projectStore, this.fileWriteMutex);
    const allTools = createToolsForProject(toolContext);

    const toolNames = profile.tools ?? [];
    const tools: AgentTool[] = toolNames
      .map((name) => allTools[name])
      .filter(Boolean);

    const agentsMd = await this.projectStore.readIndex();
    let systemPrompt = `${agentsMd}\n\n---\n\n${profile.systemPrompt}`;

    const skills = await this.projectStore.skill.list();
    if (skills.length > 0) {
      const skillCatalog = skills
        .map((s) => `- **${s.name}**: ${s.description}`)
        .join("\n");
      systemPrompt += `\n\n## Available Skills\n\n${skillCatalog}\n\nUse the load_skill tool to load a skill's full instructions when needed.`;
    }

    const contextSection = await readContextFiles(
      projectRoot,
      profile.context,
      () => toolContext.getAiFileAccessPolicy(),
    );
    if (contextSection) {
      systemPrompt += contextSection;
    }

    const modelId =
      profile.model ?? this.globalDefaultModel ?? config.defaultModel;
    const model = resolveModelById(modelId);

    return new Agent({
      initialState: {
        systemPrompt,
        model,
        thinkingLevel: "medium",
        tools,
      },
      sessionId,
      streamFn: streamSimple as any,
    });
  }
}
