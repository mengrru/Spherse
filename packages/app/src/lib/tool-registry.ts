import type { TranslationKey } from "@spherse/i18n";

export interface ToolInfo {
  id: string;
  label: TranslationKey;
}

export const ALL_TOOLS: ToolInfo[] = [
  { id: "read_file", label: "tool.read_file" },
  { id: "write_file", label: "tool.write_file" },
  { id: "edit_file", label: "tool.edit_file" },
  { id: "list_files", label: "tool.list_files" },
  { id: "search_content", label: "tool.search_content" },
  { id: "append_changelog", label: "tool.append_log" },
  { id: "load_skill", label: "tool.load_skill" },
  { id: "render_card", label: "tool.render_card" },
];

export const ALL_TOOL_IDS = ALL_TOOLS.map((t) => t.id);

export function getToolLabel(id: string): TranslationKey {
  return ALL_TOOLS.find((t) => t.id === id)?.label ?? (id as TranslationKey);
}
