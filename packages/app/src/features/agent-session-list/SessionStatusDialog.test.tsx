import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render";
import type { SessionInfo } from "../../lib/types";
import { SessionStatusDialog } from "./SessionStatusDialog";

const clientMock = {
  getSessionStatus: vi.fn(),
};

vi.mock("../../lib/use-connection", () => ({
  useApiClient: () => clientMock,
  useConnection: () => ({ baseUrl: "http://localhost:5173", accessToken: null }),
}));

const session: SessionInfo = {
  id: "s1",
  agentId: "a1",
  title: "My session",
  createdAt: 1,
  updatedAt: 2,
  status: "active",
};

function statusPayload(overrides: Record<string, unknown> = {}) {
  return {
    currentTokens: 1234,
    contextWindowLimit: 8192,
    cacheHitRate: 0.615,
    turnInputTokens: 1880,
    turnCacheReadTokens: 3000,
    turnCacheWriteTokens: 500,
    turnOutputTokens: 62,
    userMessageCount: 4,
    messageCount: 11,
    ...overrides,
  };
}

function renderDialog() {
  return renderWithProviders(
    <SessionStatusDialog session={session} open onOpenChange={() => {}} />,
  );
}

describe("SessionStatusDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders turn stats and session message counts", async () => {
    clientMock.getSessionStatus.mockResolvedValue(statusPayload());
    renderDialog();

    await waitFor(() => {
      expect(screen.getByText("本轮缓存命中率")).toBeInTheDocument();
    });
    expect(screen.getByText("61.5%")).toBeInTheDocument();
    expect(screen.getByText("缓存读取 / (缓存读取 + 输入)：3,000 / 4,880")).toBeInTheDocument();
    expect(screen.getByText("本轮 Token 用量")).toBeInTheDocument();
    expect(screen.getByText("1,880")).toBeInTheDocument();
    expect(screen.getByText("62")).toBeInTheDocument();
    expect(screen.getByText("3,000")).toBeInTheDocument();
    expect(screen.getByText("500")).toBeInTheDocument();
    expect(screen.getByText("会话用户消息数")).toBeInTheDocument();
    expect(screen.getByText("会话总消息数")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("11")).toBeInTheDocument();
  });

  it("shows the unknown placeholder when cache hit rate is null", async () => {
    clientMock.getSessionStatus.mockResolvedValue(statusPayload({ cacheHitRate: null }));
    renderDialog();

    await waitFor(() => {
      expect(screen.getByText("会话用户消息数")).toBeInTheDocument();
    });
    const hitRateRow = screen.getByText("本轮缓存命中率").closest("div");
    expect(hitRateRow).not.toBeNull();
    expect(hitRateRow!.textContent).toContain("未知");
    expect(screen.queryByText(/缓存读取 \/ \(缓存读取 \+ 输入\)/)).not.toBeInTheDocument();
  });

  it("shows the loading state first", () => {
    clientMock.getSessionStatus.mockReturnValue(new Promise(() => {}));
    renderDialog();
    expect(screen.getByText("加载中…")).toBeInTheDocument();
  });

  it("shows the error message when loading fails", async () => {
    clientMock.getSessionStatus.mockRejectedValue(new Error("boom"));
    renderDialog();

    await waitFor(() => {
      expect(screen.getByText("状态加载失败")).toBeInTheDocument();
    });
  });
});
