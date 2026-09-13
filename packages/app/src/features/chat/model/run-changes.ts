import type { FileChangeCard, FileChangeOp } from "../types";
import type { MessageGroup } from "./message-group";

const FILE_CHANGE_TOOLS = new Set(["write_file", "edit_file"]);

export function applyRunChanges(group: MessageGroup): void {
  const opsByPath = new Map<string, FileChangeOp[]>();
  const order: string[] = [];
  for (const bubble of group.bubbles) {
    if (bubble.kind !== "assistant") continue;
    for (const tool of bubble.tools) {
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
  }
  if (order.length === 0) return;
  const changes: FileChangeCard[] = order.map((path) => ({ path, ops: opsByPath.get(path)! }));
  for (let index = group.bubbles.length - 1; index >= 0; index--) {
    const bubble = group.bubbles[index];
    if (bubble.kind === "assistant") {
      group.bubbles[index] = { ...bubble, runChanges: changes };
      return;
    }
  }
}
