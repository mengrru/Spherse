import { describe, expect, it, vi } from "vitest";
import { NotFoundError } from "@spherse/core";
import { chatMethods, sessionMethods } from "@spherse/rpc/methods";
import type { RpcChatHub } from "@spherse/rpc/host";
import {
  callMethod,
  createFakeProjectCtx,
  createRpcHarness,
  flush,
  type HubMock,
  type RpcHarness,
} from "@spherse/rpc/testing";
import { ChatSessionHub } from "@spherse/rpc/chat";

const SESSION = { projectId: "p1", agentId: "a1", sessionId: "s1" };
const SCOPE = "chat:p1:a1:s1";
const SUB_ID = 9000;

function createRuntime() {
  let emit: ((event: any) => void) | undefined;
  let finish: (() => void) | undefined;
  let logListener: ((event: any) => void) | undefined;
  const appendLog = (event: any) => logListener?.(event);
  const runtime = {
    restoreSession: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn(
      (_sessionId: string, _content: string, _attachments: unknown, onEvent: (event: any) => void) => {
        emit = onEvent;
        appendLog({ type: "turn/start", seq: 0, time: 1, data: {} });
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
    ),
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
    emit: (event: any) => emit?.(event),
    appendLog,
    finish: () => finish?.(),
  };
}

type RuntimeMock = ReturnType<typeof createRuntime>;

function completeRun(mock: RuntimeMock) {
  mock.emit({ type: "agent_end", messages: [] });
  mock.appendLog({ type: "turn/end", seq: 1, time: 1, data: { reason: "completed" } });
  mock.finish();
}

const hubLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function createHarness() {
  const mock = createRuntime();
  const hub = new ChatSessionHub(hubLogger as never);
  const attach = vi.fn((...args: Parameters<ChatSessionHub["attach"]>) => hub.attach(...args));
  const startDetachedRun = vi.fn((...args: Parameters<ChatSessionHub["startDetachedRun"]>) =>
    hub.startDetachedRun(...args),
  );
  const hubMock: HubMock = {
    hub: { attach, startDetachedRun } as unknown as RpcChatHub,
    attach,
    startDetachedRun,
    emit: () => {},
    attachments: [],
  };
  const harness = createRpcHarness({
    methods: { ...sessionMethods, ...chatMethods },
    projectCtx: createFakeProjectCtx({ sessionRuntime: mock.runtime as never }),
    hubMock,
  });
  return { harness, hub, hubMock, mock };
}

async function subscribe(harness: RpcHarness, hubMock: HubMock): Promise<number> {
  harness.receive({ type: "sub", id: SUB_ID, scope: SCOPE });
  await hubMock.attach.mock.results[0].value.ready;
  return harness.sent().length;
}

function framesAfter(harness: RpcHarness, from: number): Array<Record<string, unknown>> {
  return harness.sent().slice(from) as Array<Record<string, unknown>>;
}

function eventPayloads(harness: RpcHarness, from = 0): unknown[] {
  return framesAfter(harness, from)
    .filter((frame) => frame.type === "event")
    .map((frame) => frame.payload);
}

function resultFrames(harness: RpcHarness): Array<Record<string, unknown>> {
  return framesAfter(harness, 0).filter((frame) => frame.type === "result");
}


describe("sessions.sendMessage", () => {
  it("starts a detached run and responds ok without waiting for the run", async () => {
    const { harness, mock } = createHarness();
    const frame = await callMethod(harness, "sessions.sendMessage", { ...SESSION, content: "hi" });
    expect(frame).toMatchObject({ type: "result", ok: true, data: { ok: true } });
    expect(harness.hubMock.startDetachedRun).toHaveBeenCalledWith(
      harness.known.sessionRuntime,
      "a1",
      "s1",
      "hi",
    );
    expect(mock.runtime.sendMessage).toHaveBeenCalledWith("s1", "hi", [], expect.any(Function));
    expect(mock.runtime.releaseSession).not.toHaveBeenCalled();

    completeRun(mock);
    await vi.waitFor(() => expect(mock.runtime.releaseSession).toHaveBeenCalledWith("s1"));
  });

  it("rejects empty content with invalid params without touching the hub", async () => {
    const { harness, mock } = createHarness();
    const frame = await callMethod(harness, "sessions.sendMessage", { ...SESSION, content: "" });
    expect(frame).toMatchObject({ type: "result", ok: false, error: { code: -32602 } });
    expect(harness.hubMock.startDetachedRun).not.toHaveBeenCalled();
    expect(mock.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it("responds invalid state when the session is already running", async () => {
    const { harness, mock } = createHarness();
    const first = await callMethod(harness, "sessions.sendMessage", { ...SESSION, content: "first" });
    expect(first).toMatchObject({ type: "result", ok: true });

    const second = await callMethod(harness, "sessions.sendMessage", { ...SESSION, content: "second" });
    expect(second).toMatchObject({ type: "result", ok: false, error: { code: 102 } });
    expect(mock.runtime.sendMessage).toHaveBeenCalledTimes(1);

    completeRun(mock);
  });

  it("responds not found when restoreSession rejects NotFoundError", async () => {
    const { harness, mock } = createHarness();
    mock.runtime.restoreSession.mockRejectedValue(new NotFoundError("Session s1 not found"));

    const frame = await callMethod(harness, "sessions.sendMessage", { ...SESSION, content: "hi" });
    expect(frame).toMatchObject({
      type: "result",
      ok: false,
      error: { code: 100, message: "Session s1 not found" },
    });
    expect(mock.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it("shares the channel with chat subscribers — run events fan out to an attached listener", async () => {
    const { harness, mock, hubMock } = createHarness();
    const baseline = await subscribe(harness, hubMock);

    const frame = await callMethod(harness, "sessions.sendMessage", { ...SESSION, content: "hi" });
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect(eventPayloads(harness, baseline)).toContainEqual({ type: "run_status", active: true });
    expect(framesAfter(harness, baseline)).toContainEqual(
      expect.objectContaining({ type: "event", scope: SCOPE, event: "run_status" }),
    );

    completeRun(mock);
    await vi.waitFor(() =>
      expect(eventPayloads(harness, baseline)).toContainEqual({ type: "run_status", active: false }),
    );
    expect(mock.runtime.restoreSession).toHaveBeenCalledTimes(1);
  });

  it("surfaces a closed project runtime as an error without starting a run", async () => {
    const { harness, hub, mock } = createHarness();
    hub.closeRuntime(harness.known.sessionRuntime as never);

    const frame = await callMethod(harness, "sessions.sendMessage", { ...SESSION, content: "hi" });
    expect(frame).toMatchObject({
      type: "result",
      ok: false,
      error: { code: 100, message: "Project runtime is not available" },
    });
    expect(mock.runtime.sendMessage).not.toHaveBeenCalled();
  });
});

describe("chat.send", () => {
  it("awaits the run and responds ok once it completes", async () => {
    const { harness, mock, hubMock } = createHarness();
    await subscribe(harness, hubMock);

    const pending = callMethod(harness, "chat.send", { ...SESSION, content: "hi" });
    await flush();
    expect(mock.runtime.sendMessage).toHaveBeenCalledWith("s1", "hi", [], expect.any(Function));
    expect(resultFrames(harness)).toHaveLength(0);

    completeRun(mock);
    await expect(pending).resolves.toMatchObject({ type: "result", ok: true, data: { ok: true } });
  });

  it("responds invalid state when the session is already running", async () => {
    const { harness, mock, hubMock } = createHarness();
    await subscribe(harness, hubMock);

    const first = callMethod(harness, "chat.send", { ...SESSION, content: "first" });
    await flush();
    expect(mock.runtime.sendMessage).toHaveBeenCalledTimes(1);

    const second = await callMethod(harness, "chat.send", { ...SESSION, content: "second" });
    expect(second).toMatchObject({ type: "result", ok: false, error: { code: 102 } });
    expect(mock.runtime.sendMessage).toHaveBeenCalledTimes(1);

    completeRun(mock);
    await expect(first).resolves.toMatchObject({ type: "result", ok: true });
  });

  it("responds not found when restoreSession rejects NotFoundError", async () => {
    const { harness, mock } = createHarness();
    mock.runtime.restoreSession.mockRejectedValue(new NotFoundError("Session s1 not found"));
    harness.receive({ type: "sub", id: SUB_ID, scope: SCOPE });

    const frame = await callMethod(harness, "chat.send", { ...SESSION, content: "hi" });
    expect(frame).toMatchObject({
      type: "result",
      ok: false,
      error: { code: 100, message: "Session s1 not found" },
    });
    expect(eventPayloads(harness)).toContainEqual({ type: "error", message: "Session s1 not found" });
    expect(mock.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it("fans run events out to the chat subscriber as rpc event frames", async () => {
    const { harness, mock, hubMock } = createHarness();
    const baseline = await subscribe(harness, hubMock);

    const pending = callMethod(harness, "chat.send", { ...SESSION, content: "hi" });
    await flush();
    expect(eventPayloads(harness, baseline)).toContainEqual({ type: "run_status", active: true });

    completeRun(mock);
    await pending;
    expect(eventPayloads(harness, baseline)).toContainEqual({ type: "run_status", active: false });
    expect(framesAfter(harness, baseline)).toContainEqual(
      expect.objectContaining({ type: "event", scope: SCOPE, event: "run_status" }),
    );
    expect(mock.runtime.restoreSession).toHaveBeenCalledTimes(1);
    expect(hubMock.attach).toHaveBeenCalledTimes(1);
  });

  it("rejects the subscription and the send when the project runtime was closed", async () => {
    const { harness, hub, mock } = createHarness();
    hub.closeRuntime(harness.known.sessionRuntime as never);
    harness.receive({ type: "sub", id: SUB_ID, scope: SCOPE });
    expect(resultFrames(harness)[0]).toMatchObject({
      type: "result",
      id: SUB_ID,
      ok: false,
      error: { code: 100, message: "Project runtime is not available" },
    });

    const frame = await callMethod(harness, "chat.send", { ...SESSION, content: "hi" });
    expect(frame).toMatchObject({
      type: "result",
      ok: false,
      error: { code: 102, message: "Not subscribed to session" },
    });
    expect(mock.runtime.sendMessage).not.toHaveBeenCalled();
  });
});
