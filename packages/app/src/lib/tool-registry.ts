export interface ToolInfo {
  id: string;
  label: string;
}

export const ALL_TOOLS: ToolInfo[] = [
  { id: "read_file", label: "读取文件" },
  { id: "write_file", label: "写入文件" },
  { id: "edit_file", label: "编辑文件" },
  { id: "list_files", label: "列出文件" },
  { id: "search_content", label: "搜索内容" },
  { id: "append_changelog", label: "追加日志" },
  { id: "load_skill", label: "加载技能" },
  { id: "render_card", label: "渲染卡片" },
];

export const ALL_TOOL_IDS = ALL_TOOLS.map((t) => t.id);

export function getToolLabel(id: string): string {
  return ALL_TOOLS.find((t) => t.id === id)?.label ?? id;
}
