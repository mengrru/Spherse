import type { TranslationKey } from "@spherse/i18n";

export interface ToolGroup {
  label: TranslationKey;
  hint?: TranslationKey;
  toolIds: string[];
  /** Advanced groups render collapsed under a warning header. */
  advanced?: boolean;
}

export const TOOL_GROUPS: ToolGroup[] = [
  {
    label: "agent-dialog.permRead",
    hint: "agent-dialog.permReadHint",
    toolIds: ["read_file", "list_files", "search_content"],
  },
  {
    label: "agent-dialog.permWrite",
    hint: "agent-dialog.permWriteHint",
    toolIds: ["write_file", "edit_file", "move_file", "copy_file"],
  },
  {
    label: "tool.data_access",
    hint: "tool.data_access_hint",
    toolIds: ["read_data", "query_data", "mutate_data"],
  },
  { label: "tool.append_log", hint: "tool.append_log_hint", toolIds: ["append_changelog"] },
  { label: "tool.load_skill", hint: "tool.load_skill_hint", toolIds: ["load_skill"] },
  { label: "tool.ask_user", hint: "tool.ask_user_hint", toolIds: ["ask_user"] },
  { label: "tool.render_card", hint: "tool.render_card_hint", toolIds: ["render_card"] },
  { label: "tool.generate_image", hint: "tool.generate_image_hint", toolIds: ["generate_image"] },
  {
    label: "tool.emit_trigger_event",
    hint: "tool.emit_trigger_event_hint",
    toolIds: ["emit_trigger_event"],
  },
  {
    label: "tool.run_command",
    hint: "tool.run_command_hint",
    toolIds: ["run_command"],
    advanced: true,
  },
  {
    label: "tool.manage_project",
    hint: "tool.manage_project_hint",
    toolIds: ["manage_agent", "manage_trigger", "manage_project_config"],
    advanced: true,
  },
];

export const ADVANCED_TOOL_IDS: string[] = TOOL_GROUPS.filter((g) => g.advanced).flatMap(
  (g) => g.toolIds,
);
