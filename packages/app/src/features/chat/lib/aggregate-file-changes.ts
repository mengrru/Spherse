import type { ChatMessage, FileChangeCard, FileChangeOp } from "../types"

const FILE_CHANGE_TOOLS = new Set(["write_file", "edit_file"])

function findRunStart(messages: ChatMessage[], runEndIndex: number): number {
  for (let i = Math.min(runEndIndex, messages.length - 1); i > 0; i--) {
    if (messages[i].role === "user") {
      return i + 1
    }
  }
  return 0
}

export function aggregateFileChanges(
  messages: ChatMessage[],
  runEndIndex: number,
): FileChangeCard[] {
  const runStart = findRunStart(messages, runEndIndex)
  const end = Math.min(runEndIndex, messages.length - 1)
  const groups = new Map<string, FileChangeOp[]>()
  const order: string[] = []

  for (let i = runStart; i <= end; i++) {
    const msg = messages[i]
    if (msg.role !== "assistant" || !msg._toolCalls) continue

    for (const tc of msg._toolCalls) {
      if (tc.status !== "completed") continue
      if (!FILE_CHANGE_TOOLS.has(tc.toolName)) continue
      const path = tc.args?.path
      if (typeof path !== "string") continue

      const op: FileChangeOp = {
        toolCallId: tc.toolCallId,
        toolName: tc.toolName as "write_file" | "edit_file",
        args: tc.args,
      }

      const existing = groups.get(path)
      if (existing) {
        existing.push(op)
      } else {
        groups.set(path, [op])
        order.push(path)
      }
    }
  }

  return order.map((path) => ({ path, ops: groups.get(path)! }))
}

export function attachRunChanges(
  messages: ChatMessage[],
  runEndIndex: number,
  changes: FileChangeCard[],
): ChatMessage[] {
  const runStart = findRunStart(messages, runEndIndex)
  const end = Math.min(runEndIndex, messages.length - 1)

  let targetIndex = -1
  for (let i = end; i >= runStart; i--) {
    if (messages[i].role === "assistant") {
      targetIndex = i
      break
    }
  }

  if (targetIndex === -1) return messages

  const next = messages.slice()
  next[targetIndex] = { ...next[targetIndex], _runChanges: changes }
  return next
}
