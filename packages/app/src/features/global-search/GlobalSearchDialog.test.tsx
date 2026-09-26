import { screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestQueryClient, renderWithDataRouter } from "../../test/render";
import { useAppUiStore } from "../../stores/app-ui-store";
import { GlobalSearchDialog } from "./GlobalSearchDialog";

const clientMock = {
  searchSessions: vi.fn(),
  getFileTree: vi.fn(),
  listAgents: vi.fn(),
};

vi.mock("../../lib/use-connection", () => ({
  useApiClient: () => clientMock,
  useConnection: () => ({ baseUrl: "http://localhost:5173", accessToken: null }),
}));

function renderDialog() {
  return renderWithDataRouter(<GlobalSearchDialog />, {
    routePath: "/project/p1/*",
    initialEntries: ["/project/p1/chat/s0"],
    queryClient: createTestQueryClient(),
  });
}

describe("GlobalSearchDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppUiStore.getState().setGlobalSearchOpen(true);
    clientMock.listAgents.mockResolvedValue([]);
    clientMock.getFileTree.mockResolvedValue(["docs/needle-notes.md", "src/main.ts"]);
    clientMock.searchSessions.mockResolvedValue({
      results: [
        {
          agentId: "a1",
          sessionId: "s9",
          sessionTitle: "needle session",
          seq: 7,
          role: "user",
          snippet: "find the needle",
          time: 1000,
        },
      ],
    });
  });

  it("shows the initial hint before typing", () => {
    renderDialog();
    expect(screen.getByText("输入关键词,搜索当前项目的聊天记录与文件名")).toBeInTheDocument();
  });

  it("renders chat and file groups after the debounced query", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByPlaceholderText("搜索聊天与文件..."), "needle");
    await waitFor(
      () => {
        expect(screen.getByText("聊天")).toBeInTheDocument();
        expect(screen.getByText("文件")).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
    expect(screen.getByText("needle session")).toBeInTheDocument();
    expect(screen.getByText("docs/needle-notes.md")).toBeInTheDocument();
    expect(clientMock.searchSessions).toHaveBeenCalledWith("needle", undefined);
  });

  it("navigates to the chat route with messageId on Enter", async () => {
    const user = userEvent.setup();
    const { router } = renderDialog();

    await user.type(screen.getByPlaceholderText("搜索聊天与文件..."), "needle");
    await waitFor(() => expect(screen.getByText("needle session")).toBeInTheDocument(), {
      timeout: 2000,
    });
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(router.state.location.pathname + router.state.location.search).toBe(
        "/project/p1/chat/s9?messageId=7",
      ),
    );
    expect(useAppUiStore.getState().globalSearchOpen).toBe(false);
  });

  it("navigates to the file route for a file hit", async () => {
    clientMock.searchSessions.mockResolvedValue({ results: [] });
    const user = userEvent.setup();
    const { router } = renderDialog();

    await user.type(screen.getByPlaceholderText("搜索聊天与文件..."), "main.ts");
    await waitFor(() => expect(screen.getByText("src/main.ts")).toBeInTheDocument(), {
      timeout: 2000,
    });
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(router.state.location.pathname + router.state.location.search).toBe(
        "/project/p1/content?path=src%2Fmain.ts",
      ),
    );
  });
});
