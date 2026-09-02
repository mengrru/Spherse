import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";

const mockWsSend = vi.fn();
const mockSetFloatingChat = vi.fn();
const mockNavigate = vi.fn();
const mockPostMessage = vi.fn();
const mockToastError = vi.fn();
const mockClientSendMessage = vi.fn();

const sessionsState = vi.fn(() => ({} as Record<string, unknown>));
const projectSessions = vi.fn(() => [{ id: "s1", agentId: "a1" }] as any[]);

vi.mock("sonner", () => ({
  toast: { error: mockToastError },
}));

vi.mock("../../features/chat/replica-store", () => ({
  useStreamingStore: {
    getState: () => ({
      sendMessage: mockWsSend,
      sessions: sessionsState(),
    }),
  },
}));

vi.mock("../../queries/project", () => ({
  ensureProjectSession: (_projectId: string, _client: unknown, sessionId: string) =>
    Promise.resolve(projectSessions().find((session) => session.id === sessionId) ?? null),
}));

vi.mock("../../stores/settings-store", () => ({
  useSettingsStore: { getState: () => ({ locale: "zh-CN" }) },
}));

vi.mock("../../features/floating-chat/store", () => ({
  useFloatingChatStore: {
    getState: () => ({ byProject: {}, setFloatingChat: mockSetFloatingChat }),
  },
}));

vi.mock("../../features/floating-chat", () => ({
  getDefaultFloatingState: (sessionId: string) => ({ sessionId } as any),
}));

const { dispatchAction } = await import("../registry");
await import("./send-message");

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    projectId: "proj-1",
    navigate: mockNavigate,
    source: { postMessage: mockPostMessage } as any,
    requestId: "req-1",
    hostKind: "electron" as const,
    ...overrides,
  } as any;
}

function makeClient() {
  return { sendMessage: mockClientSendMessage } as any;
}

describe("sendMessage action", () => {
  beforeEach(() => {
    mockWsSend.mockReset();
    mockWsSend.mockReturnValue(false);
    mockSetFloatingChat.mockReset();
    mockNavigate.mockReset();
    mockPostMessage.mockReset();
    mockToastError.mockReset();
    mockClientSendMessage.mockReset();
    mockClientSendMessage.mockResolvedValue({ ok: true });
    sessionsState.mockReset();
    sessionsState.mockReturnValue({});
    projectSessions.mockReset();
    projectSessions.mockReturnValue([{ id: "s1", agentId: "a1" }]);
  });

  it("is a no-op when sessionId is missing", async () => {
    await dispatchAction("sendMessage", { message: "hi" }, makeCtx());
    expect(mockWsSend).not.toHaveBeenCalled();
    expect(mockPostMessage).not.toHaveBeenCalled();
  });

  it("is a no-op when message is missing", async () => {
    await dispatchAction("sendMessage", { sessionId: "s1" }, makeCtx());
    expect(mockWsSend).not.toHaveBeenCalled();
  });

  it("sends over websocket when connected and responds ok", async () => {
    mockWsSend.mockReturnValue(true);
    sessionsState.mockReturnValue({
      "s1": { streaming: false },
    });
    await dispatchAction("sendMessage", { sessionId: "s1", message: "hi" }, makeCtx());
    expect(mockWsSend).toHaveBeenCalledWith("s1", "hi");
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "spherse:response", requestId: "req-1", ok: true }),
      "*",
    );
  });

  it("falls back to the http client when websocket is not connected", async () => {
    sessionsState.mockReturnValue({ "s1": { streaming: false } });
    await dispatchAction(
      "sendMessage",
      { sessionId: "s1", message: "hi" },
      makeCtx({ client: makeClient() }),
    );
    expect(mockClientSendMessage).toHaveBeenCalledWith("a1", "s1", "hi");
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true }),
      "*",
    );
  });

  it("maps http 409 to session_busy", async () => {
    sessionsState.mockReturnValue({ "s1": { streaming: false } });
    mockClientSendMessage.mockRejectedValue(
      new ApiError("Session \"s1\" is already running", 409),
    );
    await dispatchAction(
      "sendMessage",
      { sessionId: "s1", message: "hi" },
      makeCtx({ client: makeClient() }),
    );
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        data: { error: "session_busy" },
      }),
      "*",
    );
  });

  it("maps generic http failure to send_failed", async () => {
    sessionsState.mockReturnValue({ "s1": { streaming: false } });
    mockClientSendMessage.mockRejectedValue(new Error("network"));
    await dispatchAction(
      "sendMessage",
      { sessionId: "s1", message: "hi" },
      makeCtx({ client: makeClient() }),
    );
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        data: { error: "send_failed" },
      }),
      "*",
    );
  });

  it("responds send_failed when websocket is down and ctx has no client", async () => {
    sessionsState.mockReturnValue({ "s1": { streaming: false } });
    await dispatchAction("sendMessage", { sessionId: "s1", message: "hi" }, makeCtx());
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        data: { error: "send_failed" },
      }),
      "*",
    );
  });

  it("responds session_busy and skips send when streaming", async () => {
    sessionsState.mockReturnValue({
      "s1": { streaming: true },
    });
    await dispatchAction("sendMessage", { sessionId: "s1", message: "hi" }, makeCtx());
    expect(mockWsSend).not.toHaveBeenCalled();
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "spherse:response",
        requestId: "req-1",
        ok: false,
        data: { error: "session_busy" },
      }),
      "*",
    );
  });

  it("does not respond when no requestId/source (fire-and-forget), still navigates", async () => {
    sessionsState.mockReturnValue({
      "s1": { streaming: true },
    });
    await dispatchAction(
      "sendMessage",
      { sessionId: "s1", message: "hi" },
      { projectId: "proj-1", navigate: mockNavigate } as any,
    );
    expect(mockWsSend).not.toHaveBeenCalled();
    expect(mockPostMessage).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/project/proj-1/chat/s1");
  });

  it("navigates to chat route by default", async () => {
    mockWsSend.mockReturnValue(true);
    sessionsState.mockReturnValue({
      "s1": { streaming: false },
    });
    await dispatchAction("sendMessage", { sessionId: "s1", message: "hi" }, makeCtx());
    expect(mockNavigate).toHaveBeenCalledWith("/project/proj-1/chat/s1");
  });

  it("skips navigation when open is false", async () => {
    mockWsSend.mockReturnValue(true);
    sessionsState.mockReturnValue({
      "s1": { streaming: false },
    });
    await dispatchAction(
      "sendMessage",
      { sessionId: "s1", message: "hi", open: false },
      makeCtx(),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("skips navigation when open is false even with float", async () => {
    mockWsSend.mockReturnValue(true);
    sessionsState.mockReturnValue({
      "s1": { streaming: false },
    });
    await dispatchAction(
      "sendMessage",
      { sessionId: "s1", message: "hi", open: false, float: true },
      makeCtx(),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockSetFloatingChat).not.toHaveBeenCalled();
  });

  it("opens floating chat when float is true", async () => {
    mockWsSend.mockReturnValue(true);
    sessionsState.mockReturnValue({
      "s1": { streaming: false },
    });
    await dispatchAction(
      "sendMessage",
      { sessionId: "s1", message: "hi", float: true },
      makeCtx(),
    );
    expect(mockSetFloatingChat).toHaveBeenCalledWith("proj-1", { sessionId: "s1" });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("downgrades float to chat page navigation on web", async () => {
    mockWsSend.mockReturnValue(true);
    sessionsState.mockReturnValue({
      "s1": { streaming: false },
    });
    await dispatchAction(
      "sendMessage",
      { sessionId: "s1", message: "hi", float: true },
      makeCtx({ hostKind: "web" }),
    );
    expect(mockSetFloatingChat).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/project/proj-1/chat/s1");
  });

  it("rejects unknown sessionId with toast and session_not_found error", async () => {
    await dispatchAction(
      "sendMessage",
      { sessionId: "nonexistent", message: "hi" },
      makeCtx(),
    );
    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(mockWsSend).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        data: { error: "session_not_found" },
      }),
      "*",
    );
  });
});
