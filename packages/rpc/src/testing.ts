import { vi } from "vitest";
import type { SessionManager, TriggerManager, ProjectManager, ProjectRuntime } from "@spherse/core";
import type { ChatAttachment, RpcChatHub, RpcContext, RpcLogger, RpcMethodEntry } from "./context.js";
import { RpcAppError, RpcDispatcher } from "./context.js";
import { RpcConnectionHandler } from "./connection.js";

export const testLogger: RpcLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

export const UNKNOWN_PROJECT_ID = "missing";

export async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

export interface RpcResultFrame {
  type: "result";
  id: number;
  ok: boolean;
  data?: unknown;
  error?: { code: number; message: string };
}

export async function callMethod(harness: RpcHarness, method: string, params: unknown): Promise<RpcResultFrame> {
  const id = (callMethod.nextId += 1);
  harness.receive({ type: "call", id, method, params });
  for (let i = 0; i < 200; i += 1) {
    const frame = harness.sent().find((sent) => {
      const candidate = sent as RpcResultFrame;
      return candidate.type === "result" && candidate.id === id;
    });
    if (frame) return frame as RpcResultFrame;
    await flush();
  }
  throw new Error(`no result frame for ${method}`);
}
callMethod.nextId = 0;

export interface FakeRpcProjectContext {
  runtime: Partial<ProjectRuntime>;
  projectManager: Partial<ProjectManager>;
  sessionRuntime: Partial<SessionManager>;
  triggerManager: Partial<TriggerManager>;
}

export function createFakeProjectCtx(overrides: Partial<FakeRpcProjectContext> = {}) {
  const base = {
    runtime: { deleteSession: vi.fn() },
    projectManager: {
      listProjectSessions: vi.fn(() => ({ sessions: [], byAgent: {} })),
      searchProjectMessages: vi.fn(() => []),
      listSessions: vi.fn(() => []),
      listSessionsPage: vi.fn(() => ({ items: [], hasMore: false })),
      getSession: vi.fn(),
      renameSession: vi.fn(),
      getSessionHistory: vi.fn(() => []),
      getRecentSessionHistory: vi.fn(() => ({ entries: [], hasMore: false, oldestId: null })),
    },
    sessionRuntime: {
      createSession: vi.fn().mockResolvedValue("s1"),
      getSessionStatus: vi.fn(() => ({ currentTokens: 0, contextWindowLimit: null })),
    },
    triggerManager: { onUserEvent: vi.fn() },
  };
  return {
    runtime: { ...base.runtime, ...overrides.runtime },
    projectManager: { ...base.projectManager, ...overrides.projectManager },
    sessionRuntime: { ...base.sessionRuntime, ...overrides.sessionRuntime },
    triggerManager: { ...base.triggerManager, ...overrides.triggerManager },
  } as unknown as FakeRpcProjectContext & Record<string, unknown>;
}

export interface ChatAttachmentMock {
  close: ReturnType<typeof vi.fn>;
  ready: Promise<void>;
  sendMessage: ReturnType<typeof vi.fn>;
  retryLastTurn: ReturnType<typeof vi.fn>;
  withdrawLastTurn: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  resolveControlRequest: ReturnType<typeof vi.fn>;
}

export interface HubMock {
  hub: RpcChatHub;
  attach: ReturnType<typeof vi.fn>;
  startDetachedRun: ReturnType<typeof vi.fn>;
  emit: (ev: unknown) => void;
  attachments: ChatAttachmentMock[];
}

export function createHubMock(): HubMock {
  const attachments: ChatAttachmentMock[] = [];
  let currentSubscriber: ((ev: unknown) => void) | undefined;
  const attach = vi.fn(
    (
      _runtime: unknown,
      _agentId: string,
      _sessionId: string,
      subscriber: (ev: unknown) => void,
      options: { since?: number } | undefined,
    ) => {
      currentSubscriber = subscriber;
      const attachment: ChatAttachmentMock = {
        close: vi.fn(),
        ready: Promise.resolve(),
        sendMessage: vi.fn(async () => {}),
        retryLastTurn: vi.fn(async () => {}),
        withdrawLastTurn: vi.fn(async () => {}),
        abort: vi.fn(),
        resolveControlRequest: vi.fn(),
      };
      attachments.push(attachment);
      void options;
      return attachment as unknown as ChatAttachment;
    },
  );
  const startDetachedRun = vi.fn(async () => {});
  return {
    hub: { attach, startDetachedRun } as unknown as RpcChatHub,
    attach,
    startDetachedRun,
    attachments,
    emit: (ev: unknown) => currentSubscriber?.(ev),
  };
}

export interface BusSourceMock {
  attach: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
  emit: (event: { type: string; payload: unknown }) => void;
}

export function createBusSourceMock(): { source: import("./context.js").RpcBusSource; mock: BusSourceMock } {
  let currentEmit: ((event: { type: string; payload: unknown }) => void) | undefined;
  const detach = vi.fn();
  const attach = vi.fn(
    (
      _projectId: string,
      _channel: string,
      emit: (event: { type: string; payload: unknown }) => void,
    ) => {
      currentEmit = emit;
      return { ok: true as const, detach };
    },
  );
  return {
    source: { attach } as never,
    mock: {
      attach,
      detach,
      emit: (event) => currentEmit?.(event),
    },
  };
}

export interface RpcHarnessOptions {
  methods?: Record<string, RpcMethodEntry>;
  projectCtx?: ReturnType<typeof createFakeProjectCtx>;
  registry?: Record<string, unknown>;
  modelSettings?: Record<string, unknown>;
  authRequired?: boolean;
  appVersion?: string | null;
  hubMock?: HubMock;
  busSource?: import("./context.js").RpcBusSource;
}

export interface RpcHarness {
  handler: RpcConnectionHandler;
  receive: (payload: unknown) => void;
  sent: () => unknown[];
  known: ReturnType<typeof createFakeProjectCtx>;
  ctx: RpcContext;
  hubMock: HubMock;
}

export function createRpcHarness(options: RpcHarnessOptions = {}): RpcHarness {
  const known = options.projectCtx ?? createFakeProjectCtx();
  const hubMock = options.hubMock ?? createHubMock();
  const registryBase = {
    get: vi.fn((projectId: string) =>
      projectId === UNKNOWN_PROJECT_ID ? undefined : known,
    ),
  };
  const registry = Object.assign(registryBase, options.registry ?? {}) as never;
  const modelSettings = Object.assign(
    {
      sanitize: vi.fn(() => ({ text: {}, image: {}, providers: {} })),
      apply: vi.fn(() => ({ text: {}, image: {}, providers: {} })),
    },
    options.modelSettings ?? {},
  ) as never;
  const ctx: RpcContext = {
    resolveProject(projectId: string) {
      if (projectId === UNKNOWN_PROJECT_ID) {
        throw new RpcAppError(100, "Unknown project");
      }
      return known as never;
    },
    registry,
    modelSettings,
    authRequired: options.authRequired ?? false,
    appVersion: options.appVersion ?? "test",
    hub: hubMock.hub,
    ...(options.busSource !== undefined ? { bus: options.busSource } : {}),
  };
  const dispatcher = new RpcDispatcher({
    methods: new Map<string, RpcMethodEntry>(Object.entries(options.methods ?? {})),
    ctx,
    logger: testLogger,
  });
  const sentFrames: string[] = [];
  const socket = { send: (data: string) => sentFrames.push(data) };
  const handler = new RpcConnectionHandler(socket, dispatcher, hubMock.hub, ctx, testLogger);
  return {
    handler,
    receive: (payload: unknown) => handler.onMessage(Buffer.from(JSON.stringify(payload))),
    sent: () => sentFrames.map((raw) => JSON.parse(raw)),
    known,
    ctx,
    hubMock,
  };
}
