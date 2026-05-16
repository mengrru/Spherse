import path from "node:path";
import { Agent } from "@mariozechner/pi-agent-core";
import { streamSimple, getModel } from "@mariozechner/pi-ai";
import type { AgentEvent, AgentTool } from "@mariozechner/pi-agent-core";
import type { AgentProfile, SessionInfo, SkillDefinition } from "./types.js";
import { PROJECT_META_DIR } from "./types.js";
import { SUPPORTED_PROVIDERS } from "./types.js";
import { ProjectStore } from "./store/project.js";
import { SessionStore } from "./store/session.js";
import { AgentProfileStore } from "./store/agent-profile.js";
import { SkillStore } from "./store/skill.js";
import { createToolsForProject } from "./tools/index.js";

export type AgentEventHandler = (event: AgentEvent) => void;

export class Engine {
  private profileStore: AgentProfileStore;
  private sessionStore: SessionStore;
  private projectStore: ProjectStore;
  private skillStore: SkillStore;
  private activeSessions: Map<string, Agent> = new Map();
  private globalDefaultModel?: string;

  constructor(
    profileStore: AgentProfileStore,
    sessionStore: SessionStore,
    projectStore: ProjectStore,
    skillStore: SkillStore,
    options?: { defaultModel?: string },
  ) {
    this.profileStore = profileStore;
    this.sessionStore = sessionStore;
    this.projectStore = projectStore;
    this.skillStore = skillStore;
    this.globalDefaultModel = options?.defaultModel;
  }

  async listProfiles(): Promise<AgentProfile[]> {
    return this.profileStore.list();
  }

  async getProfile(id: string): Promise<AgentProfile | null> {
    return this.profileStore.getById(id);
  }

  async saveProfile(filename: string, content: string): Promise<AgentProfile> {
    return this.profileStore.save(filename, content);
  }

  getSession(id: string): SessionInfo | null {
    return this.sessionStore.getSession(id);
  }

  listSessions(agentId?: string): SessionInfo[] {
    return this.sessionStore.listSessions(agentId);
  }

  async createSession(agentId: string): Promise<string> {
    const profile = await this.profileStore.getById(agentId);
    if (!profile) throw new Error(`Agent profile "${agentId}" not found`);

    const sessionId = this.sessionStore.createSession(agentId);
    const agent = await this.buildAgent(profile, sessionId);
    this.activeSessions.set(sessionId, agent);
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
    return sessionId;
  }

  async sendMessage(
    sessionId: string,
    message: string,
    onEvent: AgentEventHandler,
  ): Promise<void> {
    const agent = this.activeSessions.get(sessionId);
    if (!agent) throw new Error(`No active session "${sessionId}"`);

    const unsubscribe = agent.subscribe((event) => {
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

  async deleteProfile(agentId: string): Promise<void> {
    const sessions = this.sessionStore.listSessions(agentId);
    for (const session of sessions) {
      this.activeSessions.delete(session.id);
    }
    this.sessionStore.archiveByAgentId(agentId);
    await this.profileStore.delete(agentId);
  }

  async listSkills(): Promise<SkillDefinition[]> {
    return this.skillStore.list();
  }

  async getSkill(name: string): Promise<SkillDefinition | null> {
    return this.skillStore.get(name);
  }

  private async buildAgent(
    profile: AgentProfile,
    sessionId: string,
  ): Promise<Agent> {
    const config = this.projectStore.getConfig()!;
    const projectRoot = this.projectStore.getRootPath();
    const skillDir = path.join(projectRoot, PROJECT_META_DIR, "skills");
    const allTools = createToolsForProject(
      projectRoot,
      config.paths.changelog,
      skillDir,
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
      streamFn: async (model, context, options) => {
        return streamSimple(model, context, options);
      },
    });
  }

  private resolveModel(modelId: string): any {
    const providers: string[] = [
      ...Object.keys(SUPPORTED_PROVIDERS),
      "google",
      "anthropic",
      "openai",
    ];
    for (const provider of providers) {
      const model = (getModel as any)(provider, modelId);
      if (model) return model;
    }
    throw new Error(`Could not resolve model: ${modelId}`);
  }
}
