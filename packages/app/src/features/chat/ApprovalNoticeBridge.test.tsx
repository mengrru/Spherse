import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalNoticeBridge } from "./ApprovalNoticeBridge";
import { useChatSessionStore } from "./runtime/session-store";
import type { ChatSessionState } from "./runtime/session-state";
import { useSettingsStore } from "../../stores/settings-store";
import { renderWithProviders } from "../../test/render";
import type { HostBridge } from "../../lib/host-bridge";

function createBridgeWithNotifications(show: (request: { title: string; body: string }) => void): HostBridge {
  return {
    kind: "electron",
    capabilities: {
      filePicker: true,
      mobileAccess: false,
      openFileExternal: false,
      tray: true,
      systemNotifications: true,
      content: { editable: true },
    },
    getServerBaseUrl: async () => "http://localhost:1",
    getSettings: async () => ({}),
    saveSettings: async () => ({ success: true }),
    openExternal: async () => {},
    notifications: { show },
  };
}

function seedPendingApprovalSession(): void {
  const session: ChatSessionState = {
    entries: [
      {
        kind: "tool-result",
        id: "tr1" as never,
        toolCallId: "tc1",
        toolName: "run_command",
        args: { command: "ls" },
        status: "completed",
        control: { requestId: "r1", kind: "approval", status: "pending" },
      } as never,
    ],
    openStreamId: null,
    ownerAssistantId: null,
    streaming: false,
    pendingWithdraw: false,
    cursor: 0,
    seqByMessageId: {},
    sessionId: "s1",
    generation: 1,
    projectId: "p1",
    agentId: "a1",
    initialMessageSent: true,
    connection: "connected" as never,
    history: {} as never,
    scrollPosition: 0,
    attachedCount: 1,
    lastActivityAt: 1,
  };
  useChatSessionStore.setState({ sessions: { s1: session } });
}

vi.mock("../../queries/project", () => ({
  getCachedSession: () => ({ sessionId: "s1", projectId: "p1", agentId: "a1" }),
  getCachedAgents: () => [{ id: "a1", name: "Test Agent" }],
}));

describe("ApprovalNoticeBridge system notification", () => {
  beforeEach(() => {
    useSettingsStore.setState({ systemNotifications: true });
    document.hasFocus = vi.fn(() => false);
  });

  afterEach(() => {
    useChatSessionStore.setState({ sessions: {} });
    vi.restoreAllMocks();
  });

  it("shows a system notification when unfocused with notifications enabled", () => {
    const show = vi.fn<(request: { title: string; body: string }) => void>();
    seedPendingApprovalSession();
    renderWithProviders(<ApprovalNoticeBridge />, {
      bridge: createBridgeWithNotifications(show),
      route: "/project/p1/chat/other",
    });
    expect(show).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining("run_command") }),
    );
  });

  it("skips the system notification when the window is focused", () => {
    document.hasFocus = vi.fn(() => true);
    const show = vi.fn<(request: { title: string; body: string }) => void>();
    seedPendingApprovalSession();
    renderWithProviders(<ApprovalNoticeBridge />, {
      bridge: createBridgeWithNotifications(show),
      route: "/project/p1/chat/other",
    });
    expect(show).not.toHaveBeenCalled();
  });

  it("skips the system notification when the setting is off", () => {
    useSettingsStore.setState({ systemNotifications: false });
    const show = vi.fn<(request: { title: string; body: string }) => void>();
    seedPendingApprovalSession();
    renderWithProviders(<ApprovalNoticeBridge />, {
      bridge: createBridgeWithNotifications(show),
      route: "/project/p1/chat/other",
    });
    expect(show).not.toHaveBeenCalled();
  });
});
