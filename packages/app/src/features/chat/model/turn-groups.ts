import type { RenderItem } from "../types";

export interface TurnGroupItem {
  item: RenderItem;
  index: number;
}

export type TurnGroup =
  | { kind: "plain"; item: TurnGroupItem }
  | { kind: "trigger"; items: TurnGroupItem[]; triggerName?: string; hasError: boolean };

export function groupTurns(items: RenderItem[]): TurnGroup[] {
  const groups: TurnGroup[] = [];
  let current: Extract<TurnGroup, { kind: "trigger" }> | null = null;

  const closeCurrent = () => {
    if (current) {
      groups.push(current);
      current = null;
    }
  };

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (item.message.role === "user") {
      closeCurrent();
      if (item.message._triggered) {
        current = {
          kind: "trigger",
          items: [{ item, index }],
          ...(item.message._triggerName !== undefined ? { triggerName: item.message._triggerName } : {}),
          hasError: false,
        };
        continue;
      }
    }
    if (current) {
      current.items.push({ item, index });
      if (item.message._turnError || item.message._error) current.hasError = true;
      continue;
    }
    groups.push({ kind: "plain", item: { item, index } });
  }
  closeCurrent();

  return groups;
}
