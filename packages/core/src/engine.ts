import path from "node:path";
import pino from "pino";
import { Agent } from "@mariozechner/pi-agent-core";
import { streamSimple } from "@earendil-works/pi-ai";
import type { AgentEvent, AgentTool } from "@mariozechner/pi-agent-core";
import type { AgentProfile, SessionInfo, SkillDefinition } from "./types.js";
import { PROJECT_META_DIR } from "./types.js";
import { resolveModelById } from "./model-providers.js";
import { ProjectStore } from "./store/project.js";
import { SessionStore } from "./store/session.js";
import { AgentProfileStore } from "./store/agent-profile.js";
import { SkillStore } from "./store/skill.js";
import { createAiFileAccessPolicy } from "./access/ai-file-access.js";
import { createToolsForProject } from "./tools/index.js";
import { FileWriteMutex } from "./utils/file-write-mutex.js";
import { readContextFiles } from "./engine/read-context-files.js";
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
  private profileStore: AgentProfileStore;
  private sessionStore: SessionStore;
  private projectStore: ProjectStore;
  private skillStore: SkillStore;
  private activeSessions: Map<string, Agent> = new Map();
  private globalDefaultModel?: string;
  private fileWriteMutex: FileWriteMutex;
  private logger: Logger;

  setDefaultModel(model: string | undefined): void {
    this.globalDefaultModel = model;
  }

  constructor(
    profileStore: AgentProfileStore,
    sessionStore: SessionStore,
    projectStore: ProjectStore,
    skillStore: SkillStore,
    options?: { defaultModel?: string; logger?: Logger },
  ) {
    this.profileStore = profileStore;
    this.sessionStore = sessionStore;
    this.projectStore = projectStore;
    this.skillStore = skillStore;
    this.globalDefaultModel = options?.defaultModel;
    this.fileWriteMutex = new FileWriteMutex();
    this.logger = options?.logger ?? pino({ level: "silent" });
  }

  async listProfiles(): Promise<AgentProfile[]> {
    return this.profileStore.list();
  }

  async getProfile(id: string): Promise<AgentProfile | null> {
    return this.profileStore.getById(id);
  }

  async saveProfile(slug: string, content: string): Promise<AgentProfile> {
    return this.profileStore.save(slug, content);
  }

  getSession(id: string): SessionInfo | null {
    return this.sessionStore.getSession(id);
  }

  listSessions(agentId?: string): SessionInfo[] {
    return this.sessionStore.listSessions(agentId);
  }

  renameSession(sessionId: string, title: string): SessionInfo {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) throw new Error("title is required");
    if (trimmedTitle.length > 80) {
      throw new Error("title must be 80 characters or less");
    }

    const session = this.sessionStore.getSession(sessionId);
    if (!session) throw new Error(`Session "${sessionId}" not found`);

    this.sessionStore.updateSessionTitle(sessionId, trimmedTitle);
    return { ...session, title: trimmedTitle };
  }

  async createSession(agentId: string): Promise<string> {
    const profile = await this.profileStore.getById(agentId);
    if (!profile) throw new Error(`Agent profile "${agentId}" not found`);

    const sessionId = this.sessionStore.createSession(agentId);
    const agent = await this.buildAgent(profile, sessionId);
    this.activeSessions.set(sessionId, agent);
    this.logger.info({ sessionId, agentId }, "session created");
    return sessionId;
  }

  async restoreSession(sessionId: string): Promise<string> {
    if (this.activeSessions.has(sessionId)) return sessionId;

    const session = this.sessionStore.getSession(sessionId);
    if (!session) throw new Error(`Session "${sessionId}" not found`);

    const profile = await this.profileStore.getById(session.agentId);
    if (!profile)
      throw new Error(`Agent profile for session "${sessionId}" not found`);

    const agent = await this.buildAgent(profile, sessionId);
    agent.state.messages = this.sessionStore.getSessionMessages(sessionId);
    this.activeSessions.set(sessionId, agent);
    this.logger.info({ sessionId }, "session restored");
    return sessionId;
  }

  async sendMessage(
    sessionId: string,
    message: string,
    onEvent: AgentEventHandler,
  ): Promise<void> {
    const agent = this.activeSessions.get(sessionId);
    if (!agent) throw new Error(`No active session "${sessionId}"`);

    const sessionLogger = this.logger.child({ sessionId });

    const unsubscribe = agent.subscribe((event) => {
      logAgentEvent(sessionLogger, event);
      onEvent(event);
      if (event.type === "message_end") {
        this.sessionStore.appendMessage(sessionId, event.message);
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

  deleteSession(sessionId: string): void {
    this.activeSessions.delete(sessionId);
    this.sessionStore.archiveSession(sessionId);
  }

  hasActiveSession(sessionId: string): boolean {
    return this.activeSessions.has(sessionId);
  }

  getSessionHistory(sessionId: string): any[] {
    return this.sessionStore.getSessionMessages(sessionId);
  }

  abortSession(sessionId: string): void {
    const agent = this.activeSessions.get(sessionId);
    if (agent) agent.abort();
  }

  async getRawContent(id: string): Promise<string | null> {
    return this.profileStore.getRawContent(id);
  }

  async deleteProfile(agentId: string): Promise<void> {
    const sessions = this.sessionStore.listSessions(agentId);
    for (const session of sessions) {
      this.activeSessions.delete(session.id);
    }
    this.sessionStore.archiveByAgentId(agentId);
    await this.profileStore.delete(agentId);
  }

  async getAgentTheme(agentId: string): Promise<string> {
    return this.profileStore.getTheme(agentId);
  }

  async saveAgentTheme(agentId: string, content: string): Promise<void> {
    await this.profileStore.saveTheme(agentId, content);
  }

  async listSkills(): Promise<SkillDefinition[]> {
    return this.skillStore.list();
  }

  async getSkill(name: string): Promise<SkillDefinition | null> {
    return this.skillStore.get(name);
  }

  getFileWriteMutex(): FileWriteMutex {
    return this.fileWriteMutex;
  }

  getTurnContext(sessionId: string): TurnContextSnapshot {
    const agent = this.activeSessions.get(sessionId);
    if (!agent) throw new Error(`No active session "${sessionId}"`);

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

  private async buildAgent(
    profile: AgentProfile,
    sessionId: string,
  ): Promise<Agent> {
    const config = this.projectStore.getConfig()!;
    const projectRoot = this.projectStore.getRootPath();
    const skillDir = path.join(projectRoot, PROJECT_META_DIR, "skills");
    const getAiFileAccessPolicy = () => createAiFileAccessPolicy(
      projectRoot,
      this.projectStore.getAiAccessSettings().deniedPaths,
    );
    const allTools = createToolsForProject(
      projectRoot,
      this.fileWriteMutex,
      config.paths.changelog,
      skillDir,
      getAiFileAccessPolicy,
    );

    const toolNames = profile.tools ?? Object.keys(allTools);
    const tools: AgentTool[] = toolNames
      .map((name) => allTools[name])
      .filter(Boolean);

    const agentsMd = await this.projectStore.readIndex();
    let systemPrompt = `${agentsMd}\n\n---\n\n${profile.systemPrompt}`;

    const skills = await this.skillStore.list();
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
