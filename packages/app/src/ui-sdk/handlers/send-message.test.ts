import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWsSend = vi.fn();
const mockSetInitialMessage = vi.fn();
const mockSetFloatingChat = vi.fn();
const mockNavigate = vi.fn();
const mockPostMessage = vi.fn();

const sessionsState = vi.fn(() => ({} as Record<string, unknown>));

vi.mock("../../features/chat/streaming-store", () => ({
  useStreamingStore: {
    getState: () => ({
      sendMessage: mockWsSend,
      sessions: sessionsState(),
    }),
  },
}));

vi.mock("../../stores/project-data-store", () => ({
  useProjectDataStore: { getState: () => ({ setInitialMessage: mockSetInitialMessage }) },
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
    ...overrides,
  } as any;
}

describe("sendMessage action", () => {
  beforeEach(() => {
    mockWsSend.mockReset();
    mockSetInitialMessage.mockReset();
    mockSetFloatingChat.mockReset();
    mockNavigate.mockReset();
    mockPostMessage.mockReset();
    sessionsState.mockReset();
    sessionsState.mockReturnValue({});
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
    sessionsState.mockReturnValue({
      "s1": { ws: { readyState: WebSocket.OPEN }, streaming: false },
    });
    await dispatchAction("sendMessage", { sessionId: "s1", message: "hi" }, makeCtx());
    expect(mockWsSend).toHaveBeenCalledWith("s1", "hi");
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "spherse:response", requestId: "req-1", ok: true }),
      "*",
    );
  });

  it("stores initial message when websocket not connected", async () => {
    sessionsState.mockReturnValue({ "s1": { ws: null, streaming: false } });
    await dispatchAction("sendMessage", { sessionId: "s1", message: "hi" }, makeCtx());
    expect(mockWsSend).not.toHaveBeenCalled();
    expect(mockSetInitialMessage).toHaveBeenCalledWith("proj-1", "s1", "hi");
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true }),
      "*",
    );
  });

  it("responds session_busy and skips send when streaming", async () => {
    sessionsState.mockReturnValue({
      "s1": { ws: { readyState: WebSocket.OPEN }, streaming: true },
    });
    await dispatchAction("sendMessage", { sessionId: "s1", message: "hi" }, makeCtx());
    expect(mockWsSend).not.toHaveBeenCalled();
    expect(mockSetInitialMessage).not.toHaveBeenCalled();
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
      "s1": { ws: { readyState: WebSocket.OPEN }, streaming: true },
    });
    await dispatchAction(
      "sendMessage",
      { sessionId: "s1", message: "hi" },
      { projectId: "proj-1", navigate: mockNavigate } as any,
    );
    expect(mockWsSend).not.toHaveBeenCalled();
    expect(mockSetInitialMessage).not.toHaveBeenCalled();
    expect(mockPostMessage).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/project/proj-1/chat/s1");
  });

  it("navigates to chat route by default", async () => {
    sessionsState.mockReturnValue({
      "s1": { ws: { readyState: WebSocket.OPEN }, streaming: false },
    });
    await dispatchAction("sendMessage", { sessionId: "s1", message: "hi" }, makeCtx());
    expect(mockNavigate).toHaveBeenCalledWith("/project/proj-1/chat/s1");
  });

  it("opens floating chat when float is true", async () => {
    sessionsState.mockReturnValue({
      "s1": { ws: { readyState: WebSocket.OPEN }, streaming: false },
    });
    await dispatchAction(
      "sendMessage",
      { sessionId: "s1", message: "hi", float: true },
      makeCtx(),
    );
    expect(mockSetFloatingChat).toHaveBeenCalledWith("proj-1", { sessionId: "s1" });
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
