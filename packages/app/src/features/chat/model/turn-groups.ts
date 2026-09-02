import type { ChatMessage } from "../types";
import type { KeyedMessage } from "../replica/derive";

export interface TurnGroupItem {
  message: ChatMessage;
  key: string;
  index: number;
}

export type TurnGroup =
  | { kind: "plain"; item: TurnGroupItem }
  | { kind: "trigger"; items: TurnGroupItem[]; triggerName?: string; hasError: boolean };

export function groupTurns(items: KeyedMessage[]): TurnGroup[] {
  const groups: TurnGroup[] = [];
  let current: Extract<TurnGroup, { kind: "trigger" }> | null = null;

  const closeCurrent = () => {
    if (current) {
      groups.push(current);
      current = null;
    }
  };

  for (let index = 0; index < items.length; index++) {
    const message = items[index].message;
    if (message.role === "user") {
      closeCurrent();
      if (message._triggered) {
        current = {
          kind: "trigger",
          items: [{ message, key: items[index].key, index }],
          ...(message._triggerName !== undefined ? { triggerName: message._triggerName } : {}),
          hasError: false,
        };
        continue;
      }
    }
    const item: TurnGroupItem = { message, key: items[index].key, index };
    if (current) {
      current.items.push(item);
      if (message._turnError || message._error) current.hasError = true;
      continue;
    }
    groups.push({ kind: "plain", item });
  }
  closeCurrent();

  return groups;
}
