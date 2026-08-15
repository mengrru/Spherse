import type { ProjectStore, ChangelogEntry } from "../store/project.js";
import type { SkillStore } from "../store/skill.js";
import type { FileWriteMutex } from "../utils/file-write-mutex.js";
import type { TriggerManager } from "../trigger/trigger-manager.js";
import type { ApprovalGate } from "./with-approval.js";
import type { AskGate } from "./ask-user.js";
import { llmAccessPolicy, type AccessPolicy } from "../access/access-policy.js";

export class ToolContext {
  private readonly triggerManagerField?: TriggerManager;
  private readonly approvalGateField?: ApprovalGate;
  private readonly askGateField?: AskGate;

  constructor(
    private projectStore: ProjectStore,
    readonly mutex: FileWriteMutex,
    readonly agentSlug?: string,
    private readonly agentSkillStore?: SkillStore,
    triggerManager?: TriggerManager,
    approvalGate?: ApprovalGate,
    readonly agentId?: string,
    askGate?: AskGate,
  ) {
    this.triggerManagerField = triggerManager;
    this.approvalGateField = approvalGate;
    this.askGateField = askGate;
  }

  get store(): ProjectStore {
    return this.projectStore;
  }

  get root(): string {
    return this.projectStore.getRootPath();
  }

  get skill(): SkillStore {
    return this.projectStore.skill;
  }

  get agentSkill(): SkillStore | undefined {
    return this.agentSkillStore;
  }

  get approvalGate(): ApprovalGate | undefined {
    return this.approvalGateField;
  }

  get askGate(): AskGate | undefined {
    return this.askGateField;
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

  get triggerManager(): TriggerManager | undefined {
    return this.triggerManagerField;
  }
}
