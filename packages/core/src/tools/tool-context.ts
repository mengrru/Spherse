import type { ProjectStore, ChangelogEntry } from "../store/project.js";
import type { SkillStore } from "../store/skill.js";
import type { FileWriteMutex } from "../utils/file-write-mutex.js";
import { createAiFileAccessPolicy, type AiFileAccessPolicy } from "../access/ai-file-access.js";

export class ToolContext {
  constructor(
    private projectStore: ProjectStore,
    readonly mutex: FileWriteMutex,
  ) {}

  get root(): string {
    return this.projectStore.getRootPath();
  }

  get skill(): SkillStore {
    return this.projectStore.skill;
  }

  getAiFileAccessPolicy(): AiFileAccessPolicy {
    return createAiFileAccessPolicy(
      this.projectStore.getRootPath(),
      this.projectStore.config.getAiAccessSettings().deniedPaths,
    );
  }

  appendChangelog(entry: ChangelogEntry): Promise<void> {
    return this.projectStore.appendChangelog(entry);
  }
}
