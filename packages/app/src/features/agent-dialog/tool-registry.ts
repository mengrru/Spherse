import type { TranslationKey } from "@spherse/i18n";

export interface ToolGroup {
  label: TranslationKey;
  toolIds: string[];
}

export const TOOL_GROUPS: ToolGroup[] = [
  { label: "agent-dialog.permRead", toolIds: ["read_file", "list_files", "search_content"] },
  { label: "agent-dialog.permWrite", toolIds: ["write_file", "edit_file", "move_file", "copy_file"] },
  { label: "tool.append_log", toolIds: ["append_changelog"] },
  { label: "tool.load_skill", toolIds: ["load_skill"] },
  { label: "tool.render_card", toolIds: ["render_card"] },
  { label: "tool.generate_image", toolIds: ["generate_image"] },
];
