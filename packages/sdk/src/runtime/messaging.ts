import { SDK_VERSION } from "../meta.js";

/**
 * Request/response + fire-and-forget messaging over `window.postMessage`.
 *
 * The iframe is the sender; the host (renderer) is the listener that owns the real
 * ApiClient. `call()` tags a request with an id and resolves when the matching
 * `spherse:response` message arrives (or rejects on the 10s timeout).
 */

type Resolver = (ok: boolean, data: unknown) => void;

const pending: Record<string, Resolver> = {};
const DEFAULT_TIMEOUT = 10_000;

function genId(): string {
  return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

interface ActionMessage {
  type: "spherse:action";
  action: string;
  params: Record<string, unknown>;
  sdk: string;
  requestId?: string;
}

interface ResponseMessage {
  type: "spherse:response";
  requestId: string;
  ok: boolean;
  data?: unknown;
}

/** Send an action to the host. With `requestId`, expects a `spherse:response` reply. */
export function postAction(
  action: string,
  params: Record<string, unknown> | null,
  requestId: string | null,
): void {
  const msg: ActionMessage = {
    type: "spherse:action",
    action,
    params: params ?? {},
    sdk: SDK_VERSION,
  };
  if (requestId) msg.requestId = requestId;
  window.parent.postMessage(msg, "*");
}

/** Call a host action and await its reply. Rejects on timeout or host error. */
export function call(
  action: string,
  params: Record<string, unknown> | null,
  timeoutMs = DEFAULT_TIMEOUT,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = genId();
    const timer = setTimeout(() => {
      if (!pending[id]) return;
      delete pending[id];
      reject(new Error("spherse:timeout"));
    }, timeoutMs);

    pending[id] = (ok, data) => {
      clearTimeout(timer);
      delete pending[id];
      if (ok) resolve(data);
      else reject(new Error((data as { error?: string } | null)?.error ?? "spherse:error"));
    };

    postAction(action, params, id);
  });
}

/** Fire an action without waiting for a reply. */
export function fire(action: string, params: Record<string, unknown> | null): void {
  postAction(action, params, null);
}

/** Wire up the single `message` listener that resolves pending `call()`s. */
export function installResponseListener(): void {
  window.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as ResponseMessage | null;
    if (!data || data.type !== "spherse:response") return;
    const resolver = pending[data.requestId];
    if (resolver) resolver(data.ok, data.data);
  });
}
