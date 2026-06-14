import path from "node:path";
import pino from "pino";
import { Agent } from "@mariozechner/pi-agent-core";
import { streamSimple } from "@earendil-works/pi-ai";
import type { AgentEvent, AgentTool } from "@mariozechner/pi-agent-core";
import type { AgentProfile, SessionInfo, SkillDefinition } from "./types.js";
import { PROJECT_META_DIR } from "./types.js";
import { resolveModelById } from "./model-providers.js";
import { ProjectStore } from "./store/project.js";
import { createAiFileAccessPolicy } from "./access/ai-file-access.js";
import { createToolsForProject } from "./tools/index.js";
import { FileWriteMutex } from "./utils/file-write-mutex.js";
import { readContextFiles } from "./engine/read-context-files.js";
import { Scheduler } from "./scheduler.js";
import type { Logger } from "./logger.js";
import { logAgentEvent } from "./engine/log-agent-event.js";

export type AgentEventHandler = (event: AgentEvent) => void;

export interface TurnContextSnapshot {
  sessionId: string;
  capturedAt: string;
  systemPrompt: string;
  messages: any[];
  tools: Array<{
    name: string;
    description: string;
    parameters: unknown;
  }>;
}

export class Engine {
  private projectStore: ProjectStore;
  private activeSessions: Map<string, { agent: Agent; agentId: string }> = new Map();
  private globalDefaultModel?: string;
  private fileWriteMutex: FileWriteMutex;
  private logger: Logger;
  private scheduler?: Scheduler;

  setDefaultModel(model: string | undefined): void {
    this.globalDefaultModel = model;
  }

  setScheduler(scheduler: Scheduler): void {
    this.scheduler = scheduler;
  }

  getScheduler(): Scheduler {
    if (!this.scheduler) throw new Error("Scheduler not initialized");
    return this.scheduler;
  }

  constructor(
    projectStore: ProjectStore,
    options?: { defaultModel?: string; logger?: Logger },
  ) {
    this.projectStore = projectStore;
    this.globalDefaultModel = options?.defaultModel;
    this.fileWriteMutex = new FileWriteMutex();
    this.logger = options?.logger ?? pino({ level: "silent" });
  }

  async listProfiles(): Promise<AgentProfile[]> {
    return this.projectStore.listAgents();
  }

  async getProfile(id: string): Promise<AgentProfile | null> {
    const agentStore = this.projectStore.getAgent(id);
    return agentStore ? agentStore.getProfile() : null;
  }

  async saveProfile(slug: string, content: string): Promise<AgentProfile> {
    const agentStore = await this.projectStore.createAgent(slug, content);
    return agentStore.getProfile();
  }

  getSession(agentId: string, id: string): SessionInfo | null {
    const agentStore = this.projectStore.getAgent(agentId);
    if (!agentStore) return null;
    return agentStore.sessions.getSession(id);
  }

  listSessions(agentId: string): SessionInfo[] {
    const agentStore = this.projectStore.getAgent(agentId);
    if (!agentStore) return [];
    return agentStore.sessions.listSessions();
  }

  renameSession(agentId: string, sessionId: string, title: string): SessionInfo {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) throw new Error("title is required");
    if (trimmedTitle.length > 80) {
      throw new Error("title must be 80 characters or less");
    }

    const agentStore = this.projectStore.getAgent(agentId);
    if (!agentStore) throw new Error(`Agent "${agentId}" not found`);

    const session = agentStore.sessions.getSession(sessionId);
    if (!session) throw new Error(`Session "${sessionId}" not found`);

    agentStore.sessions.updateSessionTitle(sessionId, trimmedTitle);
    return { ...session, title: trimmedTitle };
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

  destroySession(sessionId: string): void {
    this.activeSessions.delete(sessionId);
  }

  deleteSession(agentId: string, sessionId: string): void {
    const agentStore = this.projectStore.getAgent(agentId);
    if (!agentStore) return;
    this.activeSessions.delete(sessionId);
    agentStore.sessions.archiveSession(sessionId);
  }

  hasActiveSession(sessionId: string): boolean {
    return this.activeSessions.has(sessionId);
  }

  getSessionHistory(agentId: string, sessionId: string): any[] {
    const agentStore = this.projectStore.getAgent(agentId);
    if (!agentStore) return [];
    return agentStore.sessions.getSessionMessages(sessionId);
  }

  abortSession(sessionId: string): void {
    const entry = this.activeSessions.get(sessionId);
    if (entry) entry.agent.abort();
  }

  async getRawContent(id: string): Promise<string | null> {
    const agentStore = this.projectStore.getAgent(id);
    if (!agentStore) return null;
    return agentStore.profile.getRawContent();
  }

  async deleteProfile(agentId: string): Promise<void> {
    const agentStore = this.projectStore.getAgent(agentId);
    if (!agentStore) return;

    const sessions = agentStore.sessions.listSessions();
    for (const session of sessions) {
      this.activeSessions.delete(session.id);
    }
    this.scheduler?.unregisterAgent(agentId);
    await this.projectStore.deleteAgent(agentId);
  }

  async getAgentTheme(agentId: string): Promise<string> {
    const agentStore = this.projectStore.getAgent(agentId);
    if (!agentStore) return "";
    return agentStore.profile.getTheme();
  }

  async saveAgentTheme(agentId: string, content: string): Promise<void> {
    const agentStore = this.projectStore.getAgent(agentId);
    if (!agentStore) throw new Error(`Agent "${agentId}" not found`);
    await agentStore.profile.saveTheme(content);
  }

  async listSkills(): Promise<SkillDefinition[]> {
    return this.projectStore.skill.list();
  }

  async getSkill(name: string): Promise<SkillDefinition | null> {
    return this.projectStore.skill.get(name);
  }

  getFileWriteMutex(): FileWriteMutex {
    return this.fileWriteMutex;
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

  async shutdown(): Promise<void> {
    this.scheduler?.stopAll();
    this.projectStore.close();
  }

  private async buildAgent(
    profile: AgentProfile,
    sessionId: string,
  ): Promise<Agent> {
    const config = this.projectStore.config.get();
    const projectRoot = this.projectStore.getRootPath();
    const skillDir = path.join(projectRoot, PROJECT_META_DIR, "skills");
    const getAiFileAccessPolicy = () => createAiFileAccessPolicy(
      projectRoot,
      this.projectStore.config.getAiAccessSettings().deniedPaths,
    );
    const allTools = createToolsForProject(
      projectRoot,
      this.fileWriteMutex,
      config.paths.changelog,
      skillDir,
      getAiFileAccessPolicy,
    );

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
      getAiFileAccessPolicy,
    );
    if (contextSection) {
      systemPrompt += contextSection;
    }

    const modelId =
      profile.model ?? this.globalDefaultModel ?? config.defaultModel;
    const model = this.resolveModel(modelId);

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

  private resolveModel(modelId: string): any {
    return resolveModelById(modelId);
  }
}
