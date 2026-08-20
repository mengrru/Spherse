import type { Capability } from "../../kernel/capability.js";
import { createAppendChangelogTool } from "../../tools/append-changelog.js";
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
