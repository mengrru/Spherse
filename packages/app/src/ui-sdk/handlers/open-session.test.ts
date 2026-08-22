import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSetFloatingChat = vi.fn();
const mockNavigate = vi.fn();
const mockToastError = vi.fn();
const mockPostMessage = vi.fn();
const mockGetState = vi.fn(() => ({
  byProject: {} as Record<string, unknown>,
  setFloatingChat: mockSetFloatingChat,
}));
const projectSessions = vi.fn(() => [{ id: "s1" }] as any[]);

vi.mock("sonner", () => ({
  toast: { error: mockToastError },
}));

vi.mock("../../features/floating-chat/store", () => ({
  useFloatingChatStore: { getState: () => mockGetState() },
}));

vi.mock("../../features/floating-chat", () => ({
  getDefaultFloatingState: (sessionId: string) => ({ sessionId } as any),
}));

vi.mock("../../lib/project-queries", () => ({
  ensureProjectSession: (_projectId: string, _client: unknown, sessionId: string) =>
    Promise.resolve(projectSessions().find((session) => session.id === sessionId) ?? null),
}));

vi.mock("../../stores/settings-store", () => ({
  useSettingsStore: { getState: () => ({ locale: "zh-CN" }) },
}));

const { dispatchAction } = await import("../registry");
await import("./open-session");

function makeCtx(hostKind: "electron" | "web" = "electron", withRespond = false) {
  return {
    projectId: "proj-1",
    navigate: mockNavigate,
    hostKind,
    client: {},
    ...(withRespond
      ? { source: { postMessage: mockPostMessage } as any, requestId: "req-1" }
      : {}),
  } as any;
}

describe("openSession action", () => {
  beforeEach(() => {
    mockSetFloatingChat.mockReset();
    mockNavigate.mockReset();
    mockToastError.mockReset();
    mockPostMessage.mockReset();
    mockGetState.mockReset();
    mockGetState.mockReturnValue({
      byProject: {},
      setFloatingChat: mockSetFloatingChat,
    });
    projectSessions.mockReset();
    projectSessions.mockReturnValue([{ id: "s1" }]);
  });

  it("is a no-op when sessionId is missing", async () => {
    await dispatchAction("openSession", {}, makeCtx());
    expect(mockSetFloatingChat).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("navigates to chat page by default (no float) on electron", async () => {
    await dispatchAction("openSession", { sessionId: "s1" }, makeCtx("electron"));
    expect(mockNavigate).toHaveBeenCalledWith("/project/proj-1/chat/s1");
    expect(mockSetFloatingChat).not.toHaveBeenCalled();
  });

  it("opens floating chat when float is true on electron", async () => {
    await dispatchAction(
      "openSession",
      { sessionId: "s1", float: true },
      makeCtx("electron"),
    );
    expect(mockSetFloatingChat).toHaveBeenCalledWith("proj-1", { sessionId: "s1" });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("navigates on web regardless of float", async () => {
    await dispatchAction(
      "openSession",
      { sessionId: "s1", float: true },
      makeCtx("web"),
    );
    expect(mockSetFloatingChat).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/project/proj-1/chat/s1");
  });

  it("does not send any message (open-only)", async () => {
    await dispatchAction("openSession", { sessionId: "s1" }, makeCtx("electron"));
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown sessionId with toast and session_not_found error", async () => {
    await dispatchAction(
      "openSession",
      { sessionId: "nonexistent" },
      makeCtx("electron", true),
    );
    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(mockSetFloatingChat).not.toHaveBeenCalled();
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
