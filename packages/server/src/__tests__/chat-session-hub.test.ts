import { describe, expect, it, vi } from "vitest";
import { ChatSessionHub } from "../chat-session-hub.js";

function createRuntime() {
  let emit: ((event: any) => void) | undefined;
  let finish: (() => void) | undefined;
  const runtime = {
    restoreSession: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn(
      (_sessionId: string, _content: string, _attachments: unknown, onEvent: (event: any) => void) => {
        emit = onEvent;
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
    ),
    retryLastTurn: vi.fn(
      (_sessionId: string, onEvent: (event: any) => void) => {
        emit = onEvent;
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
    ),
    abortSession: vi.fn(),
    resolveControlRequest: vi.fn(),
    destroySession: vi.fn(),
  };
  return {
    runtime,
    emit: (event: any) => emit?.(event),
    finish: () => finish?.(),
  };
}

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: vi.fn(),
  level: "debug",
  silent: vi.fn(),
} as never;

describe("ChatSessionHub", () => {
  it("keeps a run alive across socket replacement and replays its snapshot", async () => {
    const mock = createRuntime();
    const hub = new ChatSessionHub(logger);
    const firstEvents: any[] = [];
    const first = hub.attach(
      "p1",
      mock.runtime as never,
      "a1",
      "s1",
      (event) => firstEvents.push(event),
    );
    await first.ready;

    const run = first.sendMessage("hi");
    await vi.waitFor(() => expect(mock.runtime.sendMessage).toHaveBeenCalled());
    mock.emit({ type: "agent_start" });
    mock.emit({
      type: "message_update",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "partial" }],
      },
    });
    first.close();

    expect(mock.runtime.destroySession).not.toHaveBeenCalled();

    const replayed: any[] = [];
    const second = hub.attach(
      "p1",
      mock.runtime as never,
      "a1",
      "s1",
      (event) => replayed.push(event),
    );
    await second.ready;

    expect(mock.runtime.restoreSession).toHaveBeenCalledTimes(1);
    expect(replayed.map((event) => event.type)).toEqual([
      "agent_start",
      "message_update",
      "run_status",
    ]);
    expect(replayed.at(-1)).toEqual({ type: "run_status", active: true });

    mock.emit({ type: "agent_end", messages: [] });
    mock.finish();
    await run;
    second.close();

    expect(mock.runtime.destroySession).toHaveBeenCalledWith("s1");
  });

  it("routes retryLastTurn to the runtime and emits run_status", async () => {
    const mock = createRuntime();
    const hub = new ChatSessionHub(logger);
    const events: any[] = [];
    const attachment = hub.attach(
      "p1",
      mock.runtime as never,
      "a1",
      "s1",
      (event) => events.push(event),
    );
    await attachment.ready;
    events.length = 0;

    const run = attachment.retryLastTurn();
    await vi.waitFor(() => expect(mock.runtime.retryLastTurn).toHaveBeenCalled());
    mock.emit({ type: "agent_start" });
    mock.emit({ type: "agent_end", messages: [] });
    mock.finish();
    await run;

    expect(mock.runtime.retryLastTurn).toHaveBeenCalledWith("s1", expect.any(Function));
    expect(events.map((e) => e.type)).toEqual([
      "run_status",
      "agent_start",
      "agent_end",
      "run_status",
    ]);
    expect(events[0]).toEqual({ type: "run_status", active: true });
    expect(events.at(-1)).toEqual({ type: "run_status", active: false });
    attachment.close();
  });

  it("rejects retryLastTurn with ConflictError when a run is already active", async () => {
    const mock = createRuntime();
    const hub = new ChatSessionHub(logger);
    const attachment = hub.attach(
      "p1",
      mock.runtime as never,
      "a1",
      "s1",
      () => {},
    );
    await attachment.ready;

    const firstRun = attachment.sendMessage("hi");
    await vi.waitFor(() => expect(mock.runtime.sendMessage).toHaveBeenCalled());

    await expect(attachment.retryLastTurn()).rejects.toThrow(/already running/);

    mock.finish();
    await firstRun;
    attachment.close();
  });

  it("isolates a failed subscriber from the core run callback", async () => {
    const mock = createRuntime();
    const hub = new ChatSessionHub(logger);
    const attachment = hub.attach(
      "p1",
      mock.runtime as never,
      "a1",
      "s1",
      () => {
        throw new Error("closed socket");
      },
    );
    await attachment.ready;

    const run = attachment.sendMessage("hi");
    await vi.waitFor(() => expect(mock.runtime.sendMessage).toHaveBeenCalled());
    expect(() => mock.emit({ type: "agent_start" })).not.toThrow();
    mock.finish();
    await expect(run).resolves.toBeUndefined();
  });

  it("startDetachedRun resolves before the run completes and publishes events to subscribers", async () => {
    const mock = createRuntime();
    const hub = new ChatSessionHub(logger);
    const events: any[] = [];
    const attachment = hub.attach("p1", mock.runtime as never, "a1", "s1", (event) =>
      events.push(event),
    );
    await attachment.ready;
    events.length = 0;

    await hub.startDetachedRun("p1", mock.runtime as never, "a1", "s1", "hi");

    expect(mock.runtime.sendMessage).toHaveBeenCalledWith("s1", "hi", [], expect.any(Function));
    expect(events).toContainEqual({ type: "run_status", active: true });
    expect(mock.runtime.destroySession).not.toHaveBeenCalled();

    mock.emit({ type: "agent_end", messages: [] });
    mock.finish();
    await vi.waitFor(() =>
      expect(events).toContainEqual({ type: "run_status", active: false }),
    );
    attachment.close();
  });

  it("startDetachedRun rejects with ConflictError when a run is already active", async () => {
    const mock = createRuntime();
    const hub = new ChatSessionHub(logger);
    const attachment = hub.attach("p1", mock.runtime as never, "a1", "s1", () => {});
    await attachment.ready;

    const run = attachment.sendMessage("hi");
    await vi.waitFor(() => expect(mock.runtime.sendMessage).toHaveBeenCalled());

    await expect(
      hub.startDetachedRun("p1", mock.runtime as never, "a1", "s1", "again"),
    ).rejects.toThrow(/already running/);

    mock.finish();
    await run;
    attachment.close();
  });

  it("startDetachedRun logs and publishes an error event when the detached run fails", async () => {
    const mock = createRuntime();
    mock.runtime.sendMessage.mockRejectedValue(new Error("provider down"));
    const hub = new ChatSessionHub(logger);
    const events: any[] = [];
    const attachment = hub.attach("p1", mock.runtime as never, "a1", "s1", (event) =>
      events.push(event),
    );
    await attachment.ready;
    events.length = 0;

    await expect(
      hub.startDetachedRun("p1", mock.runtime as never, "a1", "s1", "hi"),
    ).resolves.toBeUndefined();

    await vi.waitFor(() =>
      expect(events).toContainEqual({
        type: "error",
        message: "provider down",
        code: "TRANSIENT",
      }),
    );
    expect(logger.error).toHaveBeenCalled();
    attachment.close();
  });

  it("startDetachedRun rethrows restore failures", async () => {
    const mock = createRuntime();
    mock.runtime.restoreSession.mockRejectedValue(new Error("no such session"));
    const hub = new ChatSessionHub(logger);

    await expect(
      hub.startDetachedRun("p1", mock.runtime as never, "a1", "s1", "hi"),
    ).rejects.toThrow("no such session");
  });
});
