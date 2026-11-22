import { vi } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import type { ProjectContextCompat } from "../registry.js";
import type { ChatSessionAttachment } from "../chat/chat-channel.js";
import type { ChatSessionHub } from "../chat/chat-session-hub.js";
import {
  RpcAppError,
  RpcDispatcher,
  type RpcContext,
  type RpcMethodEntry,
} from "../rpc/context.js";
import { RpcConnectionHandler } from "../rpc/ws-rpc.js";

export const testLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: vi.fn(),
} as unknown as FastifyBaseLogger;

export const UNKNOWN_PROJECT_ID = "missing";

export async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

export function createFakeProjectCtx(
  overrides: Partial<ProjectContextCompat> = {},
): ProjectContextCompat {
  return {
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
    sessionRuntime: { createSession: vi.fn().mockResolvedValue("s1") },
    triggerManager: {},
    ...overrides,
  } as unknown as ProjectContextCompat;
}

export interface HubMock {
  hub: ChatSessionHub;
  attach: ReturnType<typeof vi.fn>;
  emit: (ev: unknown) => void;
  attachments: ChatAttachmentMock[];
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
      return attachment as unknown as ChatSessionAttachment;
    },
  );
  return {
    hub: { attach } as unknown as ChatSessionHub,
    attach,
    attachments,
    emit: (ev: unknown) => currentSubscriber?.(ev),
  };
}

export interface RpcHarnessOptions {
  methods?: Record<string, RpcMethodEntry>;
  projectCtx?: ProjectContextCompat;
  registry?: Record<string, unknown>;
  modelSettingsStore?: Record<string, unknown>;
  modelCatalog?: Record<string, unknown>;
  authRequired?: boolean;
  hubMock?: HubMock;
}

export interface RpcHarness {
  handler: RpcConnectionHandler;
  receive: (payload: unknown) => void;
  sent: () => unknown[];
  known: ProjectContextCompat;
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
  const modelSettingsStore = Object.assign(
    {
      get: vi.fn(() => ({ text: {}, image: {}, providers: {} })),
      sanitize: vi.fn(() => ({ text: {}, image: {}, providers: {} })),
      applyUpdate: vi.fn(),
    },
    options.modelSettingsStore ?? {},
  ) as never;
  const modelCatalog = Object.assign({}, options.modelCatalog ?? {}) as never;
  const ctx: RpcContext = {
    resolveProject(projectId: string) {
      if (projectId === UNKNOWN_PROJECT_ID) {
        throw new RpcAppError(100, "Unknown project");
      }
      return known;
    },
    registry,
    modelSettingsStore,
    modelCatalog,
    authRequired: options.authRequired ?? false,
    appVersion: "test",
  };
  const dispatcher = new RpcDispatcher({
    methods: new Map<string, RpcMethodEntry>(Object.entries(options.methods ?? {})),
    ctx,
    logger: testLogger,
  });
  const sentFrames: string[] = [];
  const socket = { send: (data: string) => sentFrames.push(data) };
  const handler = new RpcConnectionHandler(socket as never, dispatcher, hubMock.hub, ctx, testLogger);
  return {
    handler,
    receive: (payload: unknown) => handler.onMessage(Buffer.from(JSON.stringify(payload))),
    sent: () => sentFrames.map((raw) => JSON.parse(raw)),
    known,
    ctx,
    hubMock,
  };
}
