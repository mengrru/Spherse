import type { Capability } from "../../kernel/capability.js";
import { createAppendChangelogTool } from "../../tools/append-changelog.js";
import { createRenderCardTool } from "../../tools/render-card.js";
import { llmPolicyOf } from "../shared/llm-policy.js";
import type { ChangelogEntry } from "../../store/project.js";

export function changelogCapability(): Capability {
  return {
    id: "changelog",
    tools: (host) => [
      createAppendChangelogTool((entry: ChangelogEntry) =>
        host.projectStore.appendChangelog(entry),
      ),
    ],
  };
}

export function renderCapability(): Capability {
  return {
    id: "render",
    tools: (host) => [
      createRenderCardTool(host.projectRoot, llmPolicyOf(host)),
    ],
  };
}
