import { describe, expect, it, vi } from "vitest";
import { ChatSessionHub } from "../chat-session-hub.js";

function createRuntime() {
  let emit: ((event: any) => void) | undefined;
  let finish: (() => void) | undefined;
  const runtime = {
    restoreSession: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn(
      (_sessionId: string, _content: string, onEvent: (event: any) => void) => {
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
});
