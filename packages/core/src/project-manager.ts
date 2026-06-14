import type { AgentProfile, SessionInfo, SkillDefinition } from "./types.js";
import { ProjectStore } from "./store/project.js";
import type { ChangelogEntry } from "./store/project.js";
import { FileWriteMutex } from "./utils/file-write-mutex.js";
import type { Logger } from "./logger.js";
import pino from "pino";

export class ProjectManager {
  private projectStore: ProjectStore;
  private fileWriteMutex: FileWriteMutex;
  private logger: Logger;

  constructor(projectStore: ProjectStore, logger?: Logger) {
    this.projectStore = projectStore;
    this.fileWriteMutex = new FileWriteMutex();
    this.logger = logger ?? pino({ level: "silent" });
  }

  close(): void {
    this.projectStore.close();
  }

  getRootPath(): string {
    return this.projectStore.getRootPath();
  }

  getProjectId(): string {
    return this.projectStore.config.getProjectId();
  }

  async regenerateProjectId(newId: string): Promise<void> {
    await this.projectStore.config.regenerateProjectId(newId);
  }

  listAgents(): AgentProfile[] {
    return this.projectStore.listAgents();
  }

  getAgentProfile(agentId: string): AgentProfile | null {
    const agentStore = this.projectStore.getAgent(agentId);
    return agentStore ? agentStore.getProfile() : null;
  }

  async createAgent(slug: string, content: string, themeContent?: string): Promise<AgentProfile> {
    const agentStore = await this.projectStore.createAgent(slug, content, themeContent);
    return agentStore.getProfile();
  }

  async updateAgent(agentId: string, content: string, themeContent?: string): Promise<AgentProfile> {
    const agentStore = this.projectStore.getAgent(agentId);
    if (!agentStore) throw new Error(`Agent "${agentId}" not found`);
    const updated = await agentStore.profile.save(content);
    if (themeContent !== undefined) {
      await agentStore.profile.saveTheme(themeContent);
    }
    return updated;
  }

  async deleteAgent(agentId: string): Promise<void> {
    await this.projectStore.deleteAgent(agentId);
  }

  async getRawContent(agentId: string): Promise<string | null> {
    const agentStore = this.projectStore.getAgent(agentId);
    if (!agentStore) return null;
    return agentStore.profile.getRawContent();
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

  getSession(agentId: string, sessionId: string): SessionInfo | null {
    const agentStore = this.projectStore.getAgent(agentId);
    if (!agentStore) return null;
    return agentStore.sessions.getSession(sessionId);
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

  getSessionHistory(agentId: string, sessionId: string): unknown[] {
    const agentStore = this.projectStore.getAgent(agentId);
    if (!agentStore) return [];
    return agentStore.sessions.getSessionMessages(sessionId);
  }

  deleteSession(agentId: string, sessionId: string): void {
    const agentStore = this.projectStore.getAgent(agentId);
    if (!agentStore) return;
    agentStore.sessions.archiveSession(sessionId);
  }

  async listSkills(): Promise<SkillDefinition[]> {
    return this.projectStore.skill.list();
  }

  async getSkill(name: string): Promise<SkillDefinition | null> {
    return this.projectStore.skill.get(name);
  }

  getAiAccessSettings(): { deniedPaths: string[] } {
    return this.projectStore.config.getAiAccessSettings();
  }

  async updateAiAccessSettings(paths: string[]): Promise<{ deniedPaths: string[] }> {
    return this.projectStore.config.updateAiAccessSettings(paths);
  }

  getWelcomePageSettings(): { path: string | null } {
    return this.projectStore.config.getWelcomePageSettings();
  }

  async updateWelcomePageSettings(path: string | null): Promise<{ path: string | null }> {
    return this.projectStore.config.updateWelcomePageSettings(path);
  }

  async readIndex(): Promise<string> {
    return this.projectStore.readIndex();
  }

  async updateIndex(content: string): Promise<void> {
    await this.projectStore.updateIndex(content);
  }

  async appendChangelog(entry: ChangelogEntry): Promise<void> {
    await this.projectStore.appendChangelog(entry);
  }

  getFileWriteMutex(): FileWriteMutex {
    return this.fileWriteMutex;
  }
}
