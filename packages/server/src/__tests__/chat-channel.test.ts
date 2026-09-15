import { describe, expect, it, vi } from "vitest";
import { ChatSessionHub } from "../chat/chat-session-hub.js";
import { ChatChannel } from "../chat/chat-channel.js";

function createRuntime() {
  let logListener: ((event: any) => void) | undefined;
  const runtime = {
    restoreSession: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn(
      (_sessionId: string, _content: string, _attachments: unknown, onEvent: (event: any) => void) => {
        onEvent({ type: "agent_start" });
        return Promise.resolve();
      },
    ),
    retryLastTurn: vi.fn().mockResolvedValue(undefined),
    withdrawLastTurn: vi.fn().mockResolvedValue(1),
    abortSession: vi.fn(),
    resolveControlRequest: vi.fn(),
    releaseSession: vi.fn(() => true),
    subscribeSessionEvents: vi.fn((_sessionId: string, listener: (event: any) => void) => {
      logListener = listener;
      return () => {
        logListener = undefined;
      };
    }),
    readSessionEventsAfter: vi.fn(() => []),
    getSessionLastSeq: vi.fn(() => -1),
  };
  return {
    runtime,
    appendLog: (event: any) => logListener?.(event),
  };
}

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as never;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("ChatChannel lifecycle", () => {
  it("does not restore until the first attach, then restores once for concurrent attaches", async () => {
    const mock = createRuntime();
    const hub = new ChatSessionHub(logger);
    expect(mock.runtime.restoreSession).not.toHaveBeenCalled();

    const first = hub.attach(mock.runtime as never, "a1", "s1", () => {});
    const second = hub.attach(mock.runtime as never, "a1", "s1", () => {});
    expect(mock.runtime.restoreSession).toHaveBeenCalledTimes(1);

    await first.ready;
    await second.ready;
    expect(mock.runtime.subscribeSessionEvents).toHaveBeenCalledTimes(1);

    first.close();
    second.close();
  });

  it("releases and closes after restore settles when the last attachment closed during opening", async () => {
    const mock = createRuntime();
    let resolveRestore: (() => void) | undefined;
    mock.runtime.restoreSession.mockImplementation(
      () => new Promise<void>((resolve) => { resolveRestore = resolve; }),
    );
    const hub = new ChatSessionHub(logger);
    const attachment = hub.attach(mock.runtime as never, "a1", "s1", () => {});
    attachment.close();

    expect(mock.runtime.releaseSession).not.toHaveBeenCalled();
    resolveRestore!();
    await tick();

    expect(mock.runtime.subscribeSessionEvents).toHaveBeenCalledTimes(1);
    expect(mock.runtime.releaseSession).toHaveBeenCalledWith("s1");

    mock.runtime.restoreSession.mockResolvedValue(undefined);
    const next = hub.attach(mock.runtime as never, "a1", "s1", () => {});
    expect(mock.runtime.restoreSession).toHaveBeenCalledTimes(2);
    await next.ready;
    next.close();
  });

  it("rejects the attachment and skips subscription when the runtime is closed during opening", async () => {
    const mock = createRuntime();
    let resolveRestore: (() => void) | undefined;
    mock.runtime.restoreSession.mockImplementation(
      () => new Promise<void>((resolve) => { resolveRestore = resolve; }),
    );
    const hub = new ChatSessionHub(logger);
    const attachment = hub.attach(mock.runtime as never, "a1", "s1", () => {});
    const readyResult = attachment.ready.catch((err: unknown) => err);

    hub.closeRuntime(mock.runtime as never);
    resolveRestore!();

    await expect(readyResult).resolves.toMatchObject({ name: "ChannelClosedError" });
    expect(mock.runtime.subscribeSessionEvents).not.toHaveBeenCalled();
    expect(mock.runtime.releaseSession).not.toHaveBeenCalled();
  });

  it("resolves the attachment ready promise silently when the attachment closes before ready", async () => {
    const mock = createRuntime();
    let resolveRestore: (() => void) | undefined;
    mock.runtime.restoreSession.mockImplementation(
      () => new Promise<void>((resolve) => { resolveRestore = resolve; }),
    );
    const hub = new ChatSessionHub(logger);
    const attachment = hub.attach(mock.runtime as never, "a1", "s1", () => {});
    attachment.close();
    resolveRestore!();

    await expect(attachment.ready).resolves.toBeUndefined();
  });

  it("rejects commands with ChannelClosedError after the runtime is closed and keeps signals idempotent", async () => {
    const mock = createRuntime();
    const hub = new ChatSessionHub(logger);
    const attachment = hub.attach(mock.runtime as never, "a1", "s1", () => {});
    await attachment.ready;

    hub.closeRuntime(mock.runtime as never);

    await expect(attachment.sendMessage("hi")).rejects.toThrow(/closed/);
    await expect(attachment.retryLastTurn()).rejects.toThrow(/closed/);
    await expect(attachment.withdrawLastTurn()).rejects.toThrow(/closed/);
    expect(() => attachment.abort()).not.toThrow();
    expect(() => attachment.resolveControlRequest("r1", { approved: true })).not.toThrow();
    expect(() => attachment.close()).not.toThrow();
    expect(mock.runtime.sendMessage).not.toHaveBeenCalled();
    expect(mock.runtime.abortSession).not.toHaveBeenCalled();
  });

  it("rejects startDetachedRun when the runtime is closed while restore is in flight", async () => {
    const mock = createRuntime();
    let resolveRestore: (() => void) | undefined;
    mock.runtime.restoreSession.mockImplementation(
      () => new Promise<void>((resolve) => { resolveRestore = resolve; }),
    );
    const hub = new ChatSessionHub(logger);
    const detached = hub.startDetachedRun(mock.runtime as never, "a1", "s1", "hi");

    hub.closeRuntime(mock.runtime as never);
    resolveRestore!();

    await expect(detached).rejects.toThrow(/closed/);
    expect(mock.runtime.sendMessage).not.toHaveBeenCalled();
    expect(mock.runtime.releaseSession).not.toHaveBeenCalled();
  });

  it("keeps the channel alive until a detached run settles, then releases it", async () => {
    const mock = createRuntime();
    let finish: (() => void) | undefined;
    mock.runtime.sendMessage.mockImplementation(
      (_sessionId: string, _content: string, _attachments: unknown, onEvent: (event: any) => void) => {
        onEvent({ type: "agent_start" });
        return new Promise<void>((resolve) => { finish = resolve; });
      },
    );
    const hub = new ChatSessionHub(logger);
    const attachment = hub.attach(mock.runtime as never, "a1", "s1", () => {});
    await attachment.ready;

    await hub.startDetachedRun(mock.runtime as never, "a1", "s1", "hi");
    attachment.close();

    expect(mock.runtime.releaseSession).not.toHaveBeenCalled();
    mock.appendLog({ type: "turn/end", seq: 1, time: 1, data: { reason: "completed" } });
    finish!();
    await tick();

    expect(mock.runtime.releaseSession).toHaveBeenCalledWith("s1");
  });

  it("stops invoking subscribers and unsubscribes exactly once after close", async () => {
    const mock = createRuntime();
    const unsubscribe = vi.fn();
    mock.runtime.subscribeSessionEvents.mockReturnValue(unsubscribe);
    const hub = new ChatSessionHub(logger);
    const events: unknown[] = [];
    const attachment = hub.attach(mock.runtime as never, "a1", "s1", (event) => events.push(event));
    await attachment.ready;
    events.length = 0;

    hub.closeRuntime(mock.runtime as never);
    attachment.close();
    attachment.close();
    mock.appendLog({ type: "turn/start", seq: 1, time: 1, data: {} });

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(events).toEqual([]);
  });

  it("restore failure closes and disposes the channel so a later attach starts fresh", async () => {
    const mock = createRuntime();
    mock.runtime.restoreSession.mockRejectedValueOnce(new Error("boom"));
    const hub = new ChatSessionHub(logger);
    const attachment = hub.attach(mock.runtime as never, "a1", "s1", () => {});
    await expect(attachment.ready).rejects.toThrow("boom");

    mock.runtime.restoreSession.mockResolvedValue(undefined);
    const next = hub.attach(mock.runtime as never, "a1", "s1", () => {});
    await expect(next.ready).resolves.toBeUndefined();
    expect(mock.runtime.restoreSession).toHaveBeenCalledTimes(2);
    next.close();
  });
});

describe("ChatChannel unit seams", () => {
  it("close is idempotent and dispose runs once", () => {
    const mock = createRuntime();
    const dispose = vi.fn();
    const channel = ChatChannel.open(mock.runtime as never, logger, "a1", "s1", dispose);
    channel.close("runtime-closed");
    channel.close("idle");
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
