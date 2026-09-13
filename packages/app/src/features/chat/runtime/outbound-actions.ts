import type { SendableImage } from "../types";
import { markRetrying } from "../model/entry-reducer";
import { lastWithdrawableUserEntry, planRetry } from "../model/group-derivations";
import type { UserEntry } from "../model/entry";
import type { SessionLink } from "./session-link";
import type { ChatSessionState } from "./session-state";

export interface OutboundHost {
  getSession(sessionId: string): ChatSessionState | undefined;
  updateSession(sessionId: string, updater: (session: ChatSessionState) => ChatSessionState): void;
  getLink(sessionId: string): SessionLink | undefined;
  getInitialMessage(sessionId: string): string | undefined;
}

export interface OutboundActions {
  sendMessage(sessionId: string, text: string, image?: SendableImage): boolean;
  sendInitialMessage(sessionId: string): void;
  retry(sessionId: string): void;
  withdrawLastTurn(sessionId: string): void;
  abort(sessionId: string): void;
  respondApproval(sessionId: string, requestId: string, approved: boolean): boolean;
  respondQuestion(sessionId: string, requestId: string, answer: string): boolean;
}

function createClientId(): string {
  return globalThis.crypto.randomUUID();
}

export function createOutboundActions(host: OutboundHost): OutboundActions {
  function sendMessage(sessionId: string, text: string, image?: SendableImage): boolean {
    const session = host.getSession(sessionId);
    if (!session) return false;
    const content = text.trim();
    if (!content || session.streaming) return false;

    const link = host.getLink(sessionId);
    const canSend = link?.isOpen() ?? false;
    const clientId = createClientId();
    const attachments = image
      ? [{
          type: "image" as const,
          path: image.path,
          mimeType: image.mimeType,
          ...(image.width !== undefined ? { width: image.width } : {}),
          ...(image.height !== undefined ? { height: image.height } : {}),
        }]
      : undefined;

    const entry: UserEntry = {
      kind: "user",
      id: clientId,
      text: content,
      clientId,
      optimistic: true,
      time: Date.now(),
      ...(attachments ? { attachments } : {}),
      ...(!canSend ? { sendFailed: true } : {}),
    };
    host.updateSession(sessionId, (current) => ({
      ...current,
      entries: [...current.entries, entry],
      ...(canSend ? { streaming: true } : {}),
    }));

    if (!canSend) return true;
    link!.send({
      type: "message",
      content,
      clientId,
      ...(attachments
        ? { attachments: attachments.map((item) => ({ type: item.type, path: item.path, mimeType: item.mimeType })) }
        : {}),
    });
    return true;
  }

  return {
    sendMessage,

    sendInitialMessage(sessionId) {
      const session = host.getSession(sessionId);
      const content = host.getInitialMessage(sessionId);
      if (!session || !content || session.initialMessageSent) return;
      const clientId = createClientId();
      host.updateSession(sessionId, (current) => ({
        ...current,
        initialMessageSent: true,
        streaming: true,
        entries: [
          ...current.entries,
          {
            kind: "user",
            id: clientId,
            text: content,
            clientId,
            optimistic: true,
            time: Date.now(),
          },
        ],
      }));
      host.getLink(sessionId)?.send({ type: "message", content, clientId });
    },

    retry(sessionId) {
      const session = host.getSession(sessionId);
      const link = host.getLink(sessionId);
      if (!session || session.streaming || !link?.isOpen()) return;
      const plan = planRetry(session.entries);
      if (plan.kind === "none") return;
      if (plan.kind === "retry-last") {
        host.updateSession(sessionId, (current) => ({ ...markRetrying(current), streaming: true }));
        link.send({ type: "retry" });
        return;
      }
      host.updateSession(sessionId, (current) => ({
        ...current,
        entries: current.entries.slice(0, current.entries.length - plan.dropCount),
      }));
      sendMessage(sessionId, plan.content, plan.attachment);
    },

    withdrawLastTurn(sessionId) {
      const session = host.getSession(sessionId);
      if (!session || session.streaming) return;
      if (!lastWithdrawableUserEntry(session.entries)) return;
      const link = host.getLink(sessionId);
      if (!link?.isOpen()) return;
      host.updateSession(sessionId, (current) => ({ ...current, pendingWithdraw: true }));
      link.send({ type: "withdraw" });
    },

    abort(sessionId) {
      const session = host.getSession(sessionId);
      if (!session) return;
      host.getLink(sessionId)?.send({ type: "abort" });
      host.updateSession(sessionId, (current) => (
        current.streaming ? { ...current, streaming: false } : current
      ));
    },

    respondApproval(sessionId, requestId, approved) {
      const link = host.getLink(sessionId);
      if (!link?.isOpen()) return false;
      return link.send({
        type: "resolve_control_request",
        requestId,
        kind: "approval",
        approved,
      });
    },

    respondQuestion(sessionId, requestId, answer) {
      const link = host.getLink(sessionId);
      if (!link?.isOpen()) return false;
      return link.send({
        type: "resolve_control_request",
        requestId,
        kind: "question",
        answer,
      });
    },
  };
}
