import { describe, expect, it, vi } from "vitest";
import { ChatSessionHub } from "../chat-session-hub.js";

function createRuntime() {
  let emit: ((event: any) => void) | undefined;
  let finish: (() => void) | undefined;
  let logListener: ((event: any) => void) | undefined;
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
    withdrawLastTurn: vi.fn().mockResolvedValue(4),
    abortSession: vi.fn(),
    resolveControlRequest: vi.fn(),
    destroySession: vi.fn(),
    subscribeSessionEvents: vi.fn(
      (_sessionId: string, listener: (event: any) => void) => {
        logListener = listener;
        return () => {
          logListener = undefined;
        };
      },
    ),
    readSessionEventsAfter: vi.fn(() => []),
    getSessionLastSeq: vi.fn(() => -1),
  };
  return {
    runtime,
    emit: (event: any) => emit?.(event),
    appendLog: (event: any) => logListener?.(event),
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
      "session_ready",
      "agent_start",
      "message_update",
      "run_status",
    ]);
    expect(replayed[0]).toEqual({ type: "session_ready", lastSeq: -1, replay: true });
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

  it("withdrawLastTurn publishes turn_withdrawn with the anchor seq", async () => {
    const mock = createRuntime();
    const hub = new ChatSessionHub(logger);
    const events: any[] = [];
    const attachment = hub.attach("p1", mock.runtime as never, "a1", "s1", (event) =>
      events.push(event),
    );
    await attachment.ready;
    events.length = 0;

    await attachment.withdrawLastTurn();

    expect(mock.runtime.withdrawLastTurn).toHaveBeenCalledWith("s1");
    expect(events).toEqual([{ type: "turn_withdrawn", seq: 4 }]);
    attachment.close();
  });

  it("rejects withdrawLastTurn with ConflictError when a run is already active", async () => {
    const mock = createRuntime();
    const hub = new ChatSessionHub(logger);
    const attachment = hub.attach("p1", mock.runtime as never, "a1", "s1", () => {});
    await attachment.ready;

    const run = attachment.sendMessage("hi");
    await vi.waitFor(() => expect(mock.runtime.sendMessage).toHaveBeenCalled());

    await expect(attachment.withdrawLastTurn()).rejects.toThrow(/already running/);

    mock.finish();
    await run;
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

  it("sends session_ready, since replay, replay_done, then run_status", async () => {
    const mock = createRuntime();
    mock.runtime.getSessionLastSeq.mockReturnValue(9);
    mock.runtime.readSessionEventsAfter.mockReturnValue([
      { type: "user/message", seq: 8, time: 1, data: { message: { role: "user", content: "hi" } } },
      { type: "turn/start", seq: 9, time: 1, data: {} },
    ]);
    const hub = new ChatSessionHub(logger);
    const events: any[] = [];
    const attachment = hub.attach(
      "p1",
      mock.runtime as never,
      "a1",
      "s1",
      (event) => events.push(event),
      { since: 7 },
    );
    await attachment.ready;

    expect(mock.runtime.readSessionEventsAfter).toHaveBeenCalledWith(
      "a1",
      "s1",
      7,
      expect.any(Number),
    );
    expect(events.map((event) => event.type)).toEqual([
      "session_ready",
      "replay_events",
      "replay_done",
      "run_status",
    ]);
    expect(events[0]).toEqual({ type: "session_ready", lastSeq: 9, replay: true });
    expect(events[1].events.map((event: any) => event.seq)).toEqual([8, 9]);
    expect(events.at(-1)).toEqual({ type: "run_status", active: false });
    attachment.close();
  });

  it("skips the replay entirely when no since cursor is provided", async () => {
    const mock = createRuntime();
    const hub = new ChatSessionHub(logger);
    const events: any[] = [];
    const attachment = hub.attach("p1", mock.runtime as never, "a1", "s1", (event) =>
      events.push(event),
    );
    await attachment.ready;

    expect(mock.runtime.readSessionEventsAfter).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual(["session_ready", "run_status"]);
    attachment.close();
  });

  it("batches replay events in chunks of 200", async () => {
    const mock = createRuntime();
    mock.runtime.readSessionEventsAfter.mockReturnValue(
      Array.from({ length: 250 }, (_, i) => ({
        type: "turn/start",
        seq: i,
        time: 1,
        data: {},
      })),
    );
    const hub = new ChatSessionHub(logger);
    const events: any[] = [];
    const attachment = hub.attach(
      "p1",
      mock.runtime as never,
      "a1",
      "s1",
      (event) => events.push(event),
      { since: -1 },
    );
    await attachment.ready;

    const batches = events.filter((event) => event.type === "replay_events");
    expect(batches.map((batch) => batch.events.length)).toEqual([200, 50]);
    expect(events.at(-2)?.type).toBe("replay_done");
    attachment.close();
  });

  it("echoes persisted user/message with clientId and trigger metadata to all subscribers", async () => {
    const mock = createRuntime();
    const hub = new ChatSessionHub(logger);
    const eventsA: any[] = [];
    const eventsB: any[] = [];
    const first = hub.attach("p1", mock.runtime as never, "a1", "s1", (event) =>
      eventsA.push(event),
    );
    const second = hub.attach("p1", mock.runtime as never, "a1", "s1", (event) =>
      eventsB.push(event),
    );
    await first.ready;
    await second.ready;
    eventsA.length = 0;
    eventsB.length = 0;

    const run = first.sendMessage("hi", [], "client-1");
    await vi.waitFor(() => expect(mock.runtime.sendMessage).toHaveBeenCalled());
    mock.appendLog({
      type: "user/message",
      seq: 5,
      time: 1,
      data: {
        message: { role: "user", content: "hi" },
        source: "triggered",
        triggerName: "t1",
      },
    });

    const expectedEcho = {
      type: "user_message",
      seq: 5,
      message: { role: "user", content: "hi" },
      clientId: "client-1",
      source: "triggered",
      triggerName: "t1",
    };
    expect(eventsA).toContainEqual(expectedEcho);
    expect(eventsB).toContainEqual(expectedEcho);

    mock.emit({ type: "agent_end", messages: [] });
    mock.finish();
    await run;
    first.close();
    second.close();
  });

  it("echoes user_message without clientId for detached runs", async () => {
    const mock = createRuntime();
    const hub = new ChatSessionHub(logger);
    const events: any[] = [];
    const attachment = hub.attach("p1", mock.runtime as never, "a1", "s1", (event) =>
      events.push(event),
    );
    await attachment.ready;
    events.length = 0;

    await hub.startDetachedRun("p1", mock.runtime as never, "a1", "s1", "hi");
    mock.appendLog({
      type: "user/message",
      seq: 3,
      time: 1,
      data: { message: { role: "user", content: "hi" } },
    });

    expect(events).toContainEqual({
      type: "user_message",
      seq: 3,
      message: { role: "user", content: "hi" },
    });

    mock.emit({ type: "agent_end", messages: [] });
    mock.finish();
    await vi.waitFor(() =>
      expect(events).toContainEqual({ type: "run_status", active: false }),
    );
    attachment.close();
  });

  it("does not leak clientId from a rejected send into later echoes", async () => {
    const mock = createRuntime();
    const hub = new ChatSessionHub(logger);
    const events: any[] = [];
    const first = hub.attach("p1", mock.runtime as never, "a1", "s1", (event) =>
      events.push(event),
    );
    await first.ready;

    const run = first.sendMessage("hi");
    await vi.waitFor(() => expect(mock.runtime.sendMessage).toHaveBeenCalled());

    const second = hub.attach("p1", mock.runtime as never, "a1", "s1", () => {});
    await second.ready;
    await expect(second.sendMessage("again", [], "client-b")).rejects.toThrow(
      /already running/,
    );

    mock.appendLog({
      type: "user/message",
      seq: 2,
      time: 1,
      data: { message: { role: "user", content: "hi" } },
    });
    const echo = events.find((event) => event.type === "user_message");
    expect(echo).toEqual({
      type: "user_message",
      seq: 2,
      message: { role: "user", content: "hi" },
    });

    mock.emit({ type: "agent_end", messages: [] });
    mock.finish();
    await run;
    first.close();
    second.close();
  });

  it("broadcasts turn_retried when the log records turn/retried", async () => {
    const mock = createRuntime();
    const hub = new ChatSessionHub(logger);
    const events: any[] = [];
    const attachment = hub.attach("p1", mock.runtime as never, "a1", "s1", (event) =>
      events.push(event),
    );
    await attachment.ready;
    events.length = 0;

    const run = attachment.retryLastTurn();
    await vi.waitFor(() => expect(mock.runtime.retryLastTurn).toHaveBeenCalled());
    mock.appendLog({
      type: "turn/retried",
      seq: 7,
      time: 1,
      data: { abandonedSeqs: [5, 6] },
    });

    expect(events).toContainEqual({
      type: "turn_retried",
      seq: 7,
      abandonedSeqs: [5, 6],
    });

    mock.emit({ type: "agent_end", messages: [] });
    mock.finish();
    await run;
    attachment.close();
  });

  it("enriches the wire message stream with messageId and persisted seq", async () => {
    const mock = createRuntime();
    const hub = new ChatSessionHub(logger);
    const events: any[] = [];
    const attachment = hub.attach("p1", mock.runtime as never, "a1", "s1", (event) =>
      events.push(event),
    );
    await attachment.ready;
    events.length = 0;

    const run = attachment.sendMessage("hi");
    await vi.waitFor(() => expect(mock.runtime.sendMessage).toHaveBeenCalled());

    const assistantMessage = { role: "assistant", content: [] };
    mock.emit({ type: "message_start", message: assistantMessage });
    mock.emit({ type: "message_update", message: assistantMessage });
    mock.appendLog({
      type: "assistant/message",
      seq: 9,
      time: 1,
      data: { message: assistantMessage },
    });
    mock.emit({ type: "message_end", message: assistantMessage });
    mock.appendLog({ type: "turn/end", seq: 10, time: 1, data: { reason: "completed" } });
    mock.emit({ type: "agent_end", messages: [] });
    mock.finish();
    await run;

    expect(events).toContainEqual(
      expect.objectContaining({ type: "message_start", messageId: "m1" }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "message_update", messageId: "m1" }),
    );
    expect(events).toContainEqual({
      type: "message_end",
      message: assistantMessage,
      messageId: "m1",
      seq: 9,
    });
    expect(events).toContainEqual(
      expect.objectContaining({ type: "agent_end", seq: 10 }),
    );
    attachment.close();
  });

  it("keeps the in-flight run's clientId when a concurrent send hits ConflictError", async () => {
    const mock = createRuntime();
    const hub = new ChatSessionHub(logger);
    const events: any[] = [];
    const first = hub.attach("p1", mock.runtime as never, "a1", "s1", (event) =>
      events.push(event),
    );
    await first.ready;

    const run = first.sendMessage("hi", [], "client-a");
    await vi.waitFor(() => expect(mock.runtime.sendMessage).toHaveBeenCalled());

    const second = hub.attach("p1", mock.runtime as never, "a1", "s1", () => {});
    await second.ready;
    await expect(second.sendMessage("again", [], "client-b")).rejects.toThrow(
      /already running/,
    );

    mock.appendLog({
      type: "user/message",
      seq: 2,
      time: 1,
      data: { message: { role: "user", content: "hi" } },
    });
    expect(events).toContainEqual({
      type: "user_message",
      seq: 2,
      message: { role: "user", content: "hi" },
      clientId: "client-a",
    });

    mock.emit({ type: "agent_end", messages: [] });
    mock.finish();
    await run;
    first.close();
    second.close();
  });

  it("sends the full handshake sequence when attaching mid-run with a since cursor", async () => {
    const mock = createRuntime();
    mock.runtime.getSessionLastSeq.mockReturnValue(11);
    mock.runtime.readSessionEventsAfter.mockReturnValue([
      { type: "user/message", seq: 10, time: 1, data: { message: { role: "user", content: "hi" } } },
      { type: "turn/start", seq: 11, time: 1, data: {} },
    ]);
    const hub = new ChatSessionHub(logger);
    const liveEvents: any[] = [];
    const first = hub.attach("p1", mock.runtime as never, "a1", "s1", (event) =>
      liveEvents.push(event),
    );
    await first.ready;
    liveEvents.length = 0;

    const run = first.sendMessage("hi");
    await vi.waitFor(() => expect(mock.runtime.sendMessage).toHaveBeenCalled());
    mock.emit({ type: "agent_start" });
    mock.emit({ type: "message_update", message: { role: "assistant", content: [] } });

    const replayEvents: any[] = [];
    const second = hub.attach(
      "p1",
      mock.runtime as never,
      "a1",
      "s1",
      (event) => replayEvents.push(event),
      { since: 9 },
    );
    await second.ready;

    const types = replayEvents.map((event) => event.type);
    expect(types[0]).toBe("session_ready");
    expect(types[1]).toBe("replay_events");
    expect(types[2]).toBe("replay_done");
    expect(types.slice(3)).toEqual(["agent_start", "message_update", "run_status"]);
    expect(replayEvents.at(-1)).toEqual({ type: "run_status", active: true });

    mock.emit({ type: "agent_end", messages: [] });
    mock.finish();
    await run;
    first.close();
    second.close();
  });

  it("unsubscribes the log listener when the channel is cleaned up", async () => {
    const mock = createRuntime();
    const unsubscribe = vi.fn();
    mock.runtime.subscribeSessionEvents.mockReturnValue(unsubscribe);
    const hub = new ChatSessionHub(logger);
    const attachment = hub.attach("p1", mock.runtime as never, "a1", "s1", () => {});
    await attachment.ready;
    expect(mock.runtime.subscribeSessionEvents).toHaveBeenCalledWith(
      "s1",
      expect.any(Function),
    );

    attachment.close();

    expect(mock.runtime.destroySession).toHaveBeenCalledWith("s1");
    expect(unsubscribe).toHaveBeenCalled();
  });
});
