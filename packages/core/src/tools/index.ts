import type { AgentTool } from "@mariozechner/pi-agent-core";
import { createReadFileTool } from "./read-file.js";
import { createWriteFileTool } from "./write-file.js";
import { createListFilesTool } from "./list-files.js";
import { createSearchContentTool } from "./search-content.js";
import { createAppendChangelogTool } from "./append-changelog.js";
import { createEditFileTool } from "./edit-file.js";
import { createLoadSkillTool } from "./load-skill.js";
import { createRenderCardTool } from "./render-card.js";
import { createMoveFileTool } from "./move-file.js";
import { createCopyFileTool } from "./copy-file.js";
import { ToolContext } from "./tool-context.js";

export { ToolContext };

export function createToolsForProject(
  ctx: ToolContext,
): Record<string, AgentTool<any>> {
  const getPolicy = () => ctx.getAiFileAccessPolicy();
  const tools: Record<string, AgentTool<any>> = {
    read_file: createReadFileTool(ctx.root, getPolicy),
    write_file: createWriteFileTool(ctx.root, ctx.mutex),
    edit_file: createEditFileTool(ctx.root, ctx.mutex, getPolicy),
    list_files: createListFilesTool(ctx.root, getPolicy),
    search_content: createSearchContentTool(ctx.root, getPolicy),
    append_changelog: createAppendChangelogTool(ctx),
    render_card: createRenderCardTool(ctx.root, getPolicy),
    move_file: createMoveFileTool(ctx.root, ctx.mutex, getPolicy),
    copy_file: createCopyFileTool(ctx.root, ctx.mutex, getPolicy),
    load_skill: createLoadSkillTool(ctx.skill),
  };

  return tools;
}
