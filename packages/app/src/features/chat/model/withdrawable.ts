import type { RenderItem } from "../types";

export function lastWithdrawableUserIndex(items: RenderItem[]): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].message.role !== "user") continue;
    return items[i].sendFailed ? -1 : i;
  }
  return -1;
}
