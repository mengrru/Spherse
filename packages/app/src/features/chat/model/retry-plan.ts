import type { ChatSessionData, RenderItem, SendableImage } from "../types";

export type RetryPlan =
  | { kind: "none" }
  | { kind: "retry-last" }
  | { kind: "resend"; content: string; attachment?: SendableImage };

export function planRetry(
  items: RenderItem[],
  session: ChatSessionData,
): RetryPlan {
  const last = items[items.length - 1];

  if (last?.message.role === "assistant" && last.message._error) {
    if (session.withdrawError) {
      return { kind: "none" };
    }
    if (last.message._turnError) {
      return { kind: "retry-last" };
    }
    const userItem = findLastUser(items);
    if (userItem) {
      return {
        kind: "resend",
        content: userItem.message.content,
        attachment: toSendable(userItem.message),
      };
    }
    return { kind: "none" };
  }

  if (last?.message.role === "user" && last.sendFailed) {
    return {
      kind: "resend",
      content: last.message.content,
      attachment: toSendable(last.message),
    };
  }

  return { kind: "none" };
}

function findLastUser(items: RenderItem[]): RenderItem | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].message.role === "user") return items[i];
  }
  return undefined;
}

function toSendable(message: RenderItem["message"]): SendableImage | undefined {
  const a = message._attachments?.[0];
  if (!a) return undefined;
  return {
    path: a.path,
    mimeType: a.mimeType,
    ...(a.width != null && { width: a.width }),
    ...(a.height != null && { height: a.height }),
  };
}
