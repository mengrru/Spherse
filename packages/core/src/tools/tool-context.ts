import type { ProjectStore, ChangelogEntry } from "../store/project.js";
import type { SkillStore } from "../store/skill.js";
import type { FileWriteMutex } from "../utils/file-write-mutex.js";
import { llmAccessPolicy, type AccessPolicy } from "../access/access-policy.js";

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

  get llmPolicy(): AccessPolicy {
    return llmAccessPolicy(
      this.projectStore.getRootPath(),
      this.projectStore.config.getAiAccessSettings().deniedPaths,
    );
  }

  appendChangelog(entry: ChangelogEntry): Promise<void> {
    return this.projectStore.appendChangelog(entry);
  }
}
