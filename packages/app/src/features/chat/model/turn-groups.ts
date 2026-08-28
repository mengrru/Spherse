import type { ChatMessage } from "../types";

export interface TurnGroupItem {
  message: ChatMessage;
  index: number;
}

export type TurnGroup =
  | { kind: "plain"; item: TurnGroupItem }
  | { kind: "trigger"; items: TurnGroupItem[]; triggerName?: string; hasError: boolean };

export function groupTurns(messages: ChatMessage[]): TurnGroup[] {
  const groups: TurnGroup[] = [];
  let current: Extract<TurnGroup, { kind: "trigger" }> | null = null;

  const closeCurrent = () => {
    if (current) {
      groups.push(current);
      current = null;
    }
  };

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.role === "user") {
      closeCurrent();
      if (message._triggered) {
        current = {
          kind: "trigger",
          items: [{ message, index }],
          ...(message._triggerName !== undefined ? { triggerName: message._triggerName } : {}),
          hasError: false,
        };
        continue;
      }
    }
    if (current) {
      current.items.push({ message, index });
      if (message._turnError || message._error) current.hasError = true;
      continue;
    }
    groups.push({ kind: "plain", item: { message, index } });
  }
  closeCurrent();

  return groups;
}
