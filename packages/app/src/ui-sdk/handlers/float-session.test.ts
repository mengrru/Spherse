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

vi.mock("../../stores/project-data-store", () => ({
  useProjectDataStore: {
    getState: () => ({
      projects: { "proj-1": { sessions: projectSessions() } },
    }),
  },
}));

vi.mock("../../lib/project-queries", () => ({
  getCachedSession: (_projectId: string, sessionId: string) =>
    projectSessions().find((session) => session.id === sessionId),
  ensureProjectSession: (_projectId: string, _client: unknown, sessionId: string) =>
    Promise.resolve(projectSessions().find((session) => session.id === sessionId) ?? null),
}));

vi.mock("../../stores/settings-store", () => ({
  useSettingsStore: { getState: () => ({ locale: "zh-CN" }) },
}));

const { dispatchAction } = await import("../registry");
await import("./float-session");

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

describe("floatSession action", () => {
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
    await dispatchAction("floatSession", {}, makeCtx());
    expect(mockSetFloatingChat).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("opens floating chat on electron", async () => {
    await dispatchAction("floatSession", { sessionId: "s1" }, makeCtx("electron"));
    expect(mockSetFloatingChat).toHaveBeenCalledWith("proj-1", { sessionId: "s1" });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("is idempotent on electron when session is already floating", async () => {
    mockGetState.mockReturnValueOnce({
      byProject: { "proj-1": { sessionId: "s1" } },
      setFloatingChat: mockSetFloatingChat,
    });
    await dispatchAction("floatSession", { sessionId: "s1" }, makeCtx("electron"));
    expect(mockSetFloatingChat).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("downgrades to chat page navigation on web", async () => {
    await dispatchAction("floatSession", { sessionId: "s1" }, makeCtx("web"));
    expect(mockSetFloatingChat).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/project/proj-1/chat/s1");
  });

  it("rejects unknown sessionId with toast and session_not_found error", async () => {
    await dispatchAction(
      "floatSession",
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
