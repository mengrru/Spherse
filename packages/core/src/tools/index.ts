import type { AgentTool } from "@mariozechner/pi-agent-core";
import { createReadFileTool } from "./read-file.js";
import { createWriteFileTool } from "./write-file.js";
import { createListFilesTool } from "./list-files.js";
import { createSearchContentTool } from "./search-content.js";
import { createAppendChangelogTool } from "./append-changelog.js";
import { createEditFileTool } from "./edit-file.js";
import { createLoadSkillTool } from "./load-skill.js";
import { createRenderCardTool } from "./render-card.js";
import type { FileWriteMutex } from "../utils/file-write-mutex.js";

export { createReadFileTool } from "./read-file.js";
export { createWriteFileTool } from "./write-file.js";
export { createEditFileTool } from "./edit-file.js";
export { createListFilesTool } from "./list-files.js";
export { createSearchContentTool } from "./search-content.js";
export { createAppendChangelogTool } from "./append-changelog.js";
export { createLoadSkillTool } from "./load-skill.js";
export { createRenderCardTool } from "./render-card.js";
export { FileWriteMutex } from "../utils/file-write-mutex.js";

export function createToolsForProject(
  projectRoot: string,
  mutex: FileWriteMutex,
  changelogPath?: string,
  skillDir?: string,
): Record<string, AgentTool<any>> {
  const tools: Record<string, AgentTool<any>> = {
    read_file: createReadFileTool(projectRoot),
    write_file: createWriteFileTool(projectRoot, mutex),
    edit_file: createEditFileTool(projectRoot, mutex),
    list_files: createListFilesTool(projectRoot),
    search_content: createSearchContentTool(projectRoot),
    append_changelog: createAppendChangelogTool(projectRoot, changelogPath, mutex),
    render_card: createRenderCardTool(projectRoot),
  };

  if (skillDir) {
    tools.load_skill = createLoadSkillTool(skillDir);
  }

  return tools;
}
