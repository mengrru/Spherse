import { chatScope } from "@spherse/contracts";
import type { RpcClient } from "../../../lib/rpc/client";
import type { SessionLink, SessionLinkHandlers, SessionLinkParams } from "./session-link";
import { decodeServerFrame } from "./decode";

export function createRpcSessionLink(
  getParams: () => SessionLinkParams,
  handlers: SessionLinkHandlers,
  getRpc: () => RpcClient,
): SessionLink {
  let open = false;
  let disposed = false;
  let removeEvent: (() => void) | undefined;
  let removeReopen: (() => void) | undefined;

  const scopeOf = (): string => {
    const params = getParams();
    return chatScope(params.projectId, params.agentId, params.sessionId);
  };

  const emitError = (message: string): void => {
    handlers.onFrame(decodeServerFrame({ type: "error", message }));
  };

  const subscribe = (): void => {
    const rpc = getRpc();
    const params = getParams();
    const since = handlers.getSince();
    rpc
      .subscribe(scopeOf(), since !== undefined ? { since } : {})
      .then(() => {
        if (disposed) return;
        open = true;
        handlers.onOpen(since);
      })
      .catch((err: unknown) => {
        if (disposed) return;
        emitError(err instanceof Error ? err.message : "subscribe failed");
        if (open) {
          open = false;
          handlers.onClose();
        }
      });
    void params;
  };

  const sendCall = (method: string, params: Record<string, unknown>): void => {
    void getRpc()
      .call(method, params)
      .catch((err: unknown) => {
        emitError(err instanceof Error ? err.message : `${method} failed`);
      });
  };

  return {
    connect: () => {
      const rpc = getRpc();
      removeEvent?.();
      removeEvent = rpc.onEvent(scopeOf(), (event) => {
        handlers.onFrame(decodeServerFrame(event.payload));
      });
      removeReopen?.();
      removeReopen = rpc.onReopen(() => {
        if (disposed) return;
        subscribe();
      });
      void rpc.connect().catch(() => {});
      subscribe();
    },
    reconnect: () => {
      if (disposed) return;
      getRpc().unsubscribe(scopeOf());
      subscribe();
    },
    probe: () => {
      void getRpc().connect().catch(() => {});
    },
    send: (message) => {
      if (disposed) return false;
      const { projectId, agentId, sessionId } = getParams();
      const base = { projectId, agentId, sessionId };
      switch (message.type) {
        case "message":
          sendCall("chat.send", {
            ...base,
            content: message.content,
            ...(message.attachments !== undefined ? { attachments: message.attachments } : {}),
            ...(message.clientId !== undefined ? { clientId: message.clientId } : {}),
          });
          return true;
        case "retry":
          sendCall("chat.retry", { ...base });
          return true;
        case "withdraw":
          sendCall("chat.withdraw", { ...base });
          return true;
        case "abort":
          sendCall("chat.abort", { ...base });
          return true;
        case "resolve_control_request":
          if (message.kind === "question") {
            sendCall("chat.resolveControlRequest", {
              ...base,
              requestId: message.requestId,
              kind: "question",
              answer: message.answer,
            });
          } else {
            sendCall("chat.resolveControlRequest", {
              ...base,
              requestId: message.requestId,
              kind: "approval",
              approved: message.approved,
              ...(message.reason !== undefined ? { reason: message.reason } : {}),
            });
          }
          return true;
        case "ping":
          return true;
      }
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      open = false;
      removeEvent?.();
      removeReopen?.();
      getRpc().unsubscribe(scopeOf());
    },
    isOpen: () => open,
  };
}
