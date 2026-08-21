import type { AgentProfile, SessionInfo, SkillDefinition } from "./types.js";
import type { AgentMcpConfig } from "./mcp/index.js";
import { ProjectStore } from "./store/project.js";
import type { ChangelogEntry, AgentChangePayload } from "./store/project.js";
import { FileWriteMutex } from "./utils/file-write-mutex.js";
import { resolveProjectPath } from "./utils/path-safety.js";
import { serverAccessPolicy } from "./access/access-policy.js";
import { type Logger, createSilentLogger } from "./logger.js";
import { ConflictError, NotFoundError, ValidationError } from "./errors.js";
import { deriveHistoryEntries } from "./session/fold.js";
import { migrateLegacySession } from "./session/legacy-migrate.js";
import fs from "node:fs/promises";
import path from "node:path";

export class ProjectManager {
  private projectStore: ProjectStore;
  private fileWriteMutex: FileWriteMutex;
  private logger: Logger;

  private serverPolicy: ReturnType<typeof serverAccessPolicy> | undefined;

  constructor(projectStore: ProjectStore, logger: Logger, fileWriteMutex: FileWriteMutex) {
    this.projectStore = projectStore;
    this.fileWriteMutex = fileWriteMutex;
    this.logger = logger ?? createSilentLogger();
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

  async createAgent(slugBase: string | undefined, content: string, themeContent?: string): Promise<AgentProfile> {
    const agentStore = await this.projectStore.createAgent(slugBase, content, themeContent);
    return agentStore.getProfile();
  }

  async updateAgent(agentId: string, content: string, themeContent?: string): Promise<AgentProfile> {
    const agentStore = await this.projectStore.updateAgent(agentId, content, themeContent);
    return agentStore.getProfile();
  }

  onAgentChange(listener: (payload: AgentChangePayload) => void): void {
    this.projectStore.on("agent_updated", listener);
  }

  offAgentChange(listener: (payload: AgentChangePayload) => void): void {
    this.projectStore.off("agent_updated", listener);
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
    if (!agentStore) throw new NotFoundError(`Agent "${agentId}" not found`);
    await agentStore.profile.saveTheme(content);
  }

  async getAgentMcp(agentId: string): Promise<AgentMcpConfig> {
    const agentStore = this.projectStore.getAgent(agentId);
    if (!agentStore) throw new NotFoundError(`Agent "${agentId}" not found`);
    return agentStore.mcp.getConfig();
  }

  async updateAgentMcp(
    agentId: string,
    config: { servers: ReadonlyArray<Record<string, unknown>> },
  ): Promise<AgentMcpConfig> {
    const agentStore = this.projectStore.getAgent(agentId);
    if (!agentStore) throw new NotFoundError(`Agent "${agentId}" not found`);
    return agentStore.mcp.saveConfig(config);
  }

  getSession(agentId: string, sessionId: string): (SessionInfo & { needsMigration: boolean }) | null {
    const agentStore = this.projectStore.getAgent(agentId);
    if (!agentStore) return null;
    const session = agentStore.sessions.getSession(sessionId);
    return session
      ? { ...session, needsMigration: agentStore.sessions.sessionNeedsMigration(sessionId) }
      : null;
  }

  listSessions(agentId: string): Array<SessionInfo & { needsMigration: boolean }> {
    const agentStore = this.projectStore.getAgent(agentId);
    if (!agentStore) return [];
    return agentStore.sessions.listSessions().map((session) => ({
      ...session,
      needsMigration: agentStore.sessions.sessionNeedsMigration(session.id),
    }));
  }

  listSessionsPage(
    agentId: string,
    limit: number,
    offset: number,
  ): { items: Array<SessionInfo & { needsMigration: boolean }>; hasMore: boolean } {
    const agentStore = this.projectStore.getAgent(agentId);
    if (!agentStore) return { items: [], hasMore: false };
    const result = agentStore.sessions.listSessionsPage(limit, offset);
    return {
      ...result,
      items: result.items.map((session) => ({
        ...session,
        needsMigration: agentStore.sessions.sessionNeedsMigration(session.id),
      })),
    };
  }

  renameSession(
    agentId: string,
    sessionId: string,
    title: string,
  ): SessionInfo & { needsMigration: boolean } {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) throw new ValidationError("title is required");
    if (trimmedTitle.length > 80) {
      throw new ValidationError("title must be 80 characters or less");
    }

    const agentStore = this.projectStore.getAgent(agentId);
    if (!agentStore) throw new NotFoundError(`Agent "${agentId}" not found`);

    const session = agentStore.sessions.getSession(sessionId);
    if (!session) throw new NotFoundError(`Session "${sessionId}" not found`);

    agentStore.sessions.updateSessionTitle(sessionId, trimmedTitle);
    return {
      ...session,
      title: trimmedTitle,
      needsMigration: agentStore.sessions.sessionNeedsMigration(sessionId),
    };
  }

  getSessionHistory(agentId: string, sessionId: string): unknown[] {
    const agentStore = this.projectStore.getAgent(agentId);
    if (!agentStore) return [];
    const sessions = agentStore.sessions;
    if (sessions.sessionNeedsMigration(sessionId)) {
      return sessions.getSessionMessages(sessionId);
    }
    return deriveHistoryEntries(sessions.readEvents(sessionId)).map((entry) => entry.message);
  }

  getRecentSessionHistory(
    agentId: string,
    sessionId: string,
    turns: number,
    beforeId?: number,
  ): { entries: Array<{ id: number; message: unknown }>; hasMore: boolean; oldestId: number | null } {
    const agentStore = this.projectStore.getAgent(agentId);
    if (!agentStore) return { entries: [], hasMore: false, oldestId: null };
    const sessions = agentStore.sessions;
    if (sessions.sessionNeedsMigration(sessionId)) {
      const result = sessions.getRecentTurns(sessionId, turns, beforeId);
      return {
        entries: result.entries,
        hasMore: result.hasMore,
        oldestId: result.oldestId,
      };
    }
    const projected = deriveHistoryEntries(sessions.readEvents(sessionId));
    const before = beforeId ?? Number.POSITIVE_INFINITY;
    const eligible = projected.filter((entry) => entry.seq < before);
    const selected: typeof eligible = [];
    let turnCount = 0;
    for (let i = eligible.length - 1; i >= 0; i--) {
      const entry = eligible[i];
      if (entry.message.role === "user") {
        turnCount++;
        if (turnCount > turns) break;
      }
      selected.push(entry);
    }
    selected.reverse();
    return {
      entries: selected.map((entry) => ({ id: entry.seq, message: entry.message })),
      hasMore: selected.length < eligible.length,
      oldestId: selected[0]?.seq ?? null,
    };
  }

  sessionNeedsMigration(agentId: string, sessionId: string): boolean {
    const agentStore = this.projectStore.getAgent(agentId);
    if (!agentStore) return false;
    return agentStore.sessions.sessionNeedsMigration(sessionId);
  }

  migrateSession(agentId: string, sessionId: string): {
    sessionId: string;
    migrated: boolean;
    eventCount: number;
  } {
    const agentStore = this.projectStore.getAgent(agentId);
    if (!agentStore) throw new NotFoundError(`Agent "${agentId}" not found`);
    return migrateLegacySession(agentStore.sessions, sessionId);
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

  async createSkill(name: string, description: string, instructions: string): Promise<SkillDefinition> {
    return this.projectStore.skill.createSkill(name, description, instructions);
  }

  async installSkill(zipPath: string): Promise<SkillDefinition> {
    return this.projectStore.skill.installSkill(zipPath);
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

  private policy(): ReturnType<typeof serverAccessPolicy> {
    this.serverPolicy ??= serverAccessPolicy(this.projectStore.getRootPath());
    return this.serverPolicy;
  }

  async writeFile(relativePath: string, content: string): Promise<void> {
    const resolved = resolveProjectPath(this.getRootPath(), relativePath);
    this.policy().assertWrite(relativePath);
    await this.fileWriteMutex.run(resolved, async () => {
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, content, "utf-8");
    });
  }

  async createEntry(relativePath: string, action: "mkdir" | "touch"): Promise<void> {
    const resolved = resolveProjectPath(this.getRootPath(), relativePath);
    this.policy().assertWrite(relativePath);
    await this.fileWriteMutex.run(resolved, async () => {
      const stat = await fs.stat(resolved).catch(() => null);
      if (stat) throw new ConflictError(`Entry already exists: ${relativePath}`);
      if (action === "mkdir") {
        await fs.mkdir(resolved, { recursive: true });
      } else {
        await fs.mkdir(path.dirname(resolved), { recursive: true });
        await fs.writeFile(resolved, "", "utf-8");
      }
    });
  }

  async deletePath(relativePath: string): Promise<void> {
    const resolved = resolveProjectPath(this.getRootPath(), relativePath);
    this.policy().assertWrite(relativePath);
    await this.fileWriteMutex.run(resolved, async () => {
      const stat = await fs.stat(resolved).catch(() => null);
      if (!stat) return;
      if (stat.isDirectory()) {
        await fs.rm(resolved, { recursive: true });
      } else {
        await fs.unlink(resolved);
      }
    });
  }

  async copyFileWithin(fromRelative: string, toRelative: string): Promise<void> {
    const src = resolveProjectPath(this.getRootPath(), fromRelative);
    const dest = resolveProjectPath(this.getRootPath(), toRelative);
    this.policy().assertRead(fromRelative);
    this.policy().assertWrite(toRelative);
    await this.fileWriteMutex.run(dest, async () => {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(src, dest);
    });
  }

  async writeBinaryFile(relativePath: string, data: Uint8Array): Promise<void> {
    const resolved = resolveProjectPath(this.getRootPath(), relativePath);
    this.policy().assertWrite(relativePath);
    await this.fileWriteMutex.run(resolved, async () => {
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, data);
    });
  }

}
