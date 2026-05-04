import type { AgentTool } from "@mariozechner/pi-agent-core";
import { createReadFileTool } from "./read-file.js";
import { createWriteFileTool } from "./write-file.js";
import { createListFilesTool } from "./list-files.js";
import { createSearchContentTool } from "./search-content.js";
import { createAppendChangelogTool } from "./append-changelog.js";

export { createReadFileTool } from "./read-file.js";
export { createWriteFileTool } from "./write-file.js";
export { createListFilesTool } from "./list-files.js";
export { createSearchContentTool } from "./search-content.js";
export { createAppendChangelogTool } from "./append-changelog.js";

export function createToolsForProject(projectRoot: string, changelogPath?: string): Record<string, AgentTool<any>> {
  return {
    read_file: createReadFileTool(projectRoot),
    write_file: createWriteFileTool(projectRoot),
    list_files: createListFilesTool(projectRoot),
    search_content: createSearchContentTool(projectRoot),
    append_changelog: createAppendChangelogTool(projectRoot, changelogPath),
  };
}
