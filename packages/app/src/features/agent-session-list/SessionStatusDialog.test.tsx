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

function num(value: number): string {
  return value.toLocaleString();
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

  it("renders turn stats and context message counts", async () => {
    clientMock.getSessionStatus.mockResolvedValue(statusPayload());
    renderDialog();

    await waitFor(() => {
      expect(screen.getByText("本轮缓存命中率")).toBeInTheDocument();
    });
    expect(screen.getByText("61.5%")).toBeInTheDocument();
    expect(
      screen.getByText(`缓存读取 / (缓存读取 + 输入)：${num(3000)} / ${num(4880)}`),
    ).toBeInTheDocument();
    expect(screen.getByText("本轮 Token 用量")).toBeInTheDocument();
    expect(screen.getAllByText(num(1880)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(num(62)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(num(3000)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(num(500)).length).toBeGreaterThan(0);
    expect(screen.getByText("上下文用户消息数")).toBeInTheDocument();
    expect(screen.getByText("上下文总消息数")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("11")).toBeInTheDocument();
  });

  it("shows the unknown placeholder for every new metric when usage is unavailable (null)", async () => {
    clientMock.getSessionStatus.mockResolvedValue(
      statusPayload({
        cacheHitRate: null,
        turnInputTokens: null,
        turnCacheReadTokens: null,
        turnCacheWriteTokens: null,
        turnOutputTokens: null,
      }),
    );
    renderDialog();

    await waitFor(() => {
      expect(screen.getByText("上下文用户消息数")).toBeInTheDocument();
    });
    const hitRateRow = screen.getByText("本轮缓存命中率").closest("div");
    expect(hitRateRow!.textContent).toContain("未知");
    expect(screen.queryByText(/缓存读取 \/ \(缓存读取 \+ 输入\)/)).not.toBeInTheDocument();

    const tokenRow = screen.getByText("本轮 Token 用量").closest("div");
    const tokenCells = tokenRow!.querySelectorAll(".tabular-nums");
    expect(tokenCells.length).toBe(4);
    for (const cell of tokenCells) {
      expect(cell.textContent).toContain("未知");
    }
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("11")).toBeInTheDocument();
  });

  it("keeps legacy metrics and marks new metrics unknown for an old-server payload without new fields", async () => {
    clientMock.getSessionStatus.mockResolvedValue({
      currentTokens: 1234,
      contextWindowLimit: 8192,
    });
    renderDialog();

    await waitFor(() => {
      expect(screen.getByText(num(1234))).toBeInTheDocument();
    });
    expect(screen.getByText(num(8192))).toBeInTheDocument();
    expect(screen.getByText("本轮缓存命中率")).toBeInTheDocument();
    const hitRateRow = screen.getByText("本轮缓存命中率").closest("div");
    expect(hitRateRow!.textContent).toContain("未知");
    const tokenRow = screen.getByText("本轮 Token 用量").closest("div");
    for (const cell of tokenRow!.querySelectorAll(".tabular-nums")) {
      expect(cell.textContent).toContain("未知");
    }
    const userRow = screen.getByText("上下文用户消息数").closest("div");
    expect(userRow!.textContent).toContain("未知");
    const totalRow = screen.getByText("上下文总消息数").closest("div");
    expect(totalRow!.textContent).toContain("未知");
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
