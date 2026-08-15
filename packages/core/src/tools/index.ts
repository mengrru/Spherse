import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createReadFileTool } from "./read-file.js";
import { createWriteFileTool } from "./write-file.js";
import { createListFilesTool } from "./list-files.js";
import { createSearchContentTool } from "./search-content.js";
import { createAppendChangelogTool } from "./append-changelog.js";
import { createEditFileTool } from "./edit-file.js";
import { createLoadSkillTool } from "./load-skill.js";
import { createRenderCardTool } from "./render-card.js";
import { createGenerateImageTool } from "./generate-image.js";
import { createMoveFileTool } from "./move-file.js";
import { createCopyFileTool } from "./copy-file.js";
import { createEmitTriggerEventTool } from "./emit-trigger-event.js";
import { createRunCommandTool } from "./run-command.js";
import { createAskUserTool } from "./ask-user.js";
import { createManageAgentTool, isManageAgentWriteAction } from "./manage-agent.js";
import { createManageTriggerTool, isManageTriggerWriteAction } from "./manage-trigger.js";
import { withApproval } from "./with-approval.js";
import { ToolContext } from "./tool-context.js";

export { ToolContext };

/** Every built-in tool name an agent profile may enable. */
export const BUILTIN_TOOL_NAMES = [
  "read_file",
  "write_file",
  "edit_file",
  "list_files",
  "search_content",
  "append_changelog",
  "render_card",
  "generate_image",
  "move_file",
  "copy_file",
  "load_skill",
  "run_command",
  "manage_agent",
  "manage_trigger",
  "emit_trigger_event",
  "ask_user",
] as const;

export function createToolsForProject(
  ctx: ToolContext,
): Record<string, AgentTool<any>> {
  const getPolicy = () => ctx.llmPolicy;
  const tools: Record<string, AgentTool<any>> = {
    read_file: createReadFileTool(ctx.root, getPolicy),
    write_file: createWriteFileTool(ctx.root, ctx.mutex, getPolicy),
    edit_file: createEditFileTool(ctx.root, ctx.mutex, getPolicy),
    list_files: createListFilesTool(ctx.root, getPolicy),
    search_content: createSearchContentTool(ctx.root, getPolicy),
    append_changelog: createAppendChangelogTool(ctx),
    render_card: createRenderCardTool(ctx.root, getPolicy),
    generate_image: createGenerateImageTool(ctx.root),
    move_file: createMoveFileTool(ctx.root, ctx.mutex, getPolicy),
    copy_file: createCopyFileTool(ctx.root, ctx.mutex, getPolicy),
    load_skill: createLoadSkillTool(ctx.root, ctx.skill, ctx.agentSkill),
    run_command: withApproval(createRunCommandTool(ctx.root), ctx.approvalGate),
    ask_user: createAskUserTool(ctx.askGate),
    manage_agent: withApproval(
      createManageAgentTool(ctx.store, BUILTIN_TOOL_NAMES, ctx.agentId),
      ctx.approvalGate,
      isManageAgentWriteAction,
    ),
  };

  if (ctx.triggerManager) {
    tools.emit_trigger_event = createEmitTriggerEventTool(ctx.triggerManager);
    tools.manage_trigger = withApproval(
      createManageTriggerTool(ctx.triggerManager, ctx.store, ctx.agentId),
      ctx.approvalGate,
      isManageTriggerWriteAction,
    );
  }

  return tools;
}
