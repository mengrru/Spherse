import type { ChatMessage } from "../types";

export function lastWithdrawableUserIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "user") continue;
    return messages[i]._sendFailed ? -1 : i;
  }
  return -1;
}
