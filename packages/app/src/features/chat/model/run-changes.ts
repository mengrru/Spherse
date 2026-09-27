import type { FileChangeCard, FileChangeOp } from "../types";
import type { MessageGroup } from "./message-group";
import type { ToolItem } from "./tool-item";

const FILE_CHANGE_TOOLS = new Set(["write_file", "edit_file"]);

export function applyRunChanges(group: MessageGroup): void {
  const opsByPath = new Map<string, FileChangeOp[]>();
  const order: string[] = [];
  const tools: ToolItem[] = [];
  for (const bubble of group.bubbles) {
    if (bubble.kind === "thought" || bubble.kind === "cards") tools.push(...bubble.tools);
    else if (bubble.kind === "tool-result") tools.push(bubble.tool);
  }
  for (const tool of tools) {
    if (tool.status !== "completed") continue;
    if (!FILE_CHANGE_TOOLS.has(tool.toolName)) continue;
    const path = tool.args.path;
    if (typeof path !== "string") continue;
    const op: FileChangeOp = {
      toolCallId: tool.toolCallId,
      toolName: tool.toolName as "write_file" | "edit_file",
      args: tool.args,
    };
    const existing = opsByPath.get(path);
    if (existing) {
      existing.push(op);
      continue;
    }
    opsByPath.set(path, [op]);
    order.push(path);
  }
  if (order.length === 0) return;
  const changes: FileChangeCard[] = order.map((path) => ({ path, ops: opsByPath.get(path)! }));
  for (let index = group.bubbles.length - 1; index >= 0; index--) {
    const bubble = group.bubbles[index];
    if (bubble.kind === "assistant" || bubble.kind === "thought") {
      group.bubbles[index] = { ...bubble, runChanges: changes };
      return;
    }
  }
}
