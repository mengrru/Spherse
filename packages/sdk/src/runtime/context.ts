/**
 * Runtime context (project / agent / session identity).
 *
 * Two delivery paths, matching how the SDK is injected:
 *  - srcDoc inline injection: the host writes `window.__SPHERSE__` synchronously into the
 *    iframe document before the script runs → available immediately.
 *  - `<script src>` preview serving: the host posts `spherse:runtime` asynchronously after
 *    the iframe loads → resolved via `getRuntime()`.
 */

export interface SpherseRuntime {
  sessionId: string;
  agentId?: string;
  projectId?: string;
}

declare global {
  interface Window {
    __SPHERSE__?: SpherseRuntime;
  }
}

type RuntimeWaiter = (value: SpherseRuntime) => void;

let runtime: SpherseRuntime | null = null;
let waiters: RuntimeWaiter[] = [];

type RuntimeMessage = { type: "spherse:runtime" } & Partial<SpherseRuntime>;

function applyRuntime(message: RuntimeMessage): void {
  if (!message.sessionId) return;
  runtime = {
    sessionId: message.sessionId,
    agentId: message.agentId,
    projectId: message.projectId,
  };
  // Mirror to the injected global so HTML that reads window.__SPHERSE__ directly still
  // works under the async (<script src>) delivery path.
  try {
    window.__SPHERSE__ = runtime;
  } catch {
    // window may be read-only in some embedding contexts; ignore.
  }
  const pending = waiters;
  waiters = [];
  for (const resolve of pending) resolve(runtime);
}

/** Read the synchronous injected global, if present (srcDoc path). */
export function seedFromInjectedGlobal(): void {
  try {
    const injected = window.__SPHERSE__;
    if (injected && injected.sessionId) runtime = injected;
  } catch {
    // ignore read-only access
  }
}

/** Wire up the `message` listener that receives `spherse:runtime` (preview path). */
export function installRuntimeListener(): void {
  window.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as RuntimeMessage | null;
    if (data && data.type === "spherse:runtime") applyRuntime(data);
  });
}

/** Resolve once runtime is available (immediately if already seeded). */
export function getRuntime(): Promise<SpherseRuntime> {
  return new Promise((resolve) => {
    if (runtime) resolve(runtime);
    else waiters.push(resolve);
  });
}

/** Synchronous accessor used by the `spherse.runtime` getter; null until seeded. */
export function peekRuntime(): SpherseRuntime | null {
  return runtime;
}
