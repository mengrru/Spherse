import type { ChatMessage, SendableImage } from "../types";

export type RetryPlan =
  | { kind: "none" }
  | { kind: "retry-last" }
  | { kind: "resend"; content: string; attachment?: SendableImage; failedIntent: boolean };

export function planRetry(messages: ChatMessage[]): RetryPlan {
  const last = messages[messages.length - 1];

  if (last?.role === "assistant" && last._error) {
    if (last._withdrawError) {
      return { kind: "none" };
    }
    if (last._turnError) {
      return { kind: "retry-last" };
    }
    const userMsg = findLastUser(messages);
    if (userMsg?._messageId !== undefined) {
      return {
        kind: "resend",
        content: userMsg.content,
        attachment: toSendable(userMsg),
        failedIntent: false,
      };
    }
    if (userMsg) {
      return {
        kind: "resend",
        content: userMsg.content,
        attachment: toSendable(userMsg),
        failedIntent: true,
      };
    }
    return { kind: "none" };
  }

  if (last?.role === "user" && last._sendFailed) {
    return {
      kind: "resend",
      content: last.content,
      attachment: toSendable(last),
      failedIntent: true,
    };
  }

  return { kind: "none" };
}

function findLastUser(messages: ChatMessage[]): ChatMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i];
  }
  return undefined;
}

function toSendable(msg: ChatMessage): SendableImage | undefined {
  const a = msg._attachments?.[0];
  if (!a) return undefined;
  return {
    path: a.path,
    mimeType: a.mimeType,
    ...(a.width != null && { width: a.width }),
    ...(a.height != null && { height: a.height }),
  };
}
