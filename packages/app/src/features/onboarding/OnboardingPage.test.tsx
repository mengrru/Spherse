import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockHostBridge } from "../../test/host-bridge";
import { createTestQueryClient, renderWithProviders } from "../../test/render";
import { useAppStore } from "../../stores/app-store";
import { OnboardingPage } from "./OnboardingPage";
import type { ProjectHostApi } from "../../lib/host-bridge";

let openProject: ReturnType<typeof vi.fn>;
let refreshProjects: ReturnType<typeof vi.fn>;

beforeEach(() => {
  openProject = vi.fn();
  refreshProjects = vi.fn(async () => {});
  useAppStore.setState({
    openProject,
    refreshProjects,
    connection: { baseUrl: "http://localhost:4567", accessToken: null },
  } as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderOnboarding() {
  renderWithProviders(<OnboardingPage />, {
    bridge: createMockHostBridge(),
    queryClient: createTestQueryClient(),
  });
}

function renderBrowserOnboarding() {
  const openProjectRpc = vi.fn(async (name: string) => ({ projectId: `p-${name}` }));
  const project: ProjectHostApi = {
    selectDirectory: vi.fn(async () => null),
    selectSkillZip: vi.fn(async () => null),
    openProject: openProjectRpc,
    restoreProjects: vi.fn(async () => []),
    addOpenProject: vi.fn(async () => {}),
    closeProject: vi.fn(async () => {}),
    openProjectFolder: vi.fn(async () => {}),
    openFileExternal: vi.fn(async () => {}),
    setLastActiveProject: vi.fn(async () => {}),
    getLastActiveProject: vi.fn(async () => null),
  };
  renderWithProviders(<OnboardingPage />, {
    bridge: createMockHostBridge({ kind: "browser", project }),
    queryClient: createTestQueryClient(),
  });
  return openProjectRpc;
}

describe("OnboardingPage re-entry guard", () => {
  it("guards open-or-create against rapid re-entry while busy", async () => {
    let release!: (value: string | null) => void;
    openProject.mockImplementation(
      () => new Promise((resolve) => (release = resolve)),
    );
    const user = userEvent.setup();
    renderOnboarding();

    const card = screen.getByRole("button", { name: /打开或创建项目/ });
    await user.click(card);
    await user.click(card);
    await user.click(card);
    expect(openProject).toHaveBeenCalledTimes(1);

    release("p-new");
    await user.click(card);
    expect(openProject).toHaveBeenCalledTimes(2);
  });

  it("recovers the guard after a failed open", async () => {
    openProject.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    renderOnboarding();

    const card = screen.getByRole("button", { name: /打开或创建项目/ });
    await user.click(card);
    await vi.waitFor(() => expect(openProject).toHaveBeenCalledTimes(1));

    await user.click(card);
    expect(openProject).toHaveBeenCalledTimes(2);
  });
});

describe("OnboardingPage project market", () => {
  it("opens the project market dialog from the market card", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            schemaVersion: 1,
            generatedAt: "2026-01-01T00:00:00.000Z",
            projects: [
              {
                name: "harry-potter",
                description: "A sample world",
                version: "1.0.0",
                category: "示例",
                zipUrl: "https://example.com/harry-potter.zip",
                size: 1024,
                updatedAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const user = userEvent.setup();
    renderOnboarding();

    expect(screen.queryByText("项目市场")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /逛逛项目市场/ }));
    expect(await screen.findByText("harry-potter")).toBeInTheDocument();
  });

  it("does not render an explore-more link", () => {
    renderOnboarding();
    expect(screen.queryByText(/探索更多/)).not.toBeInTheDocument();
  });

  it("hides the market card when there is no server connection", () => {
    useAppStore.setState({
      connection: { baseUrl: "", accessToken: null },
    } as never);
    renderOnboarding();
    expect(screen.queryByRole("button", { name: /逛逛项目市场/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /打开或创建项目/ })).toBeInTheDocument();
  });
});

describe("OnboardingPage browser host", () => {
  it("does not render the market card on the browser host", () => {
    renderBrowserOnboarding();
    expect(screen.queryByRole("button", { name: /逛逛项目市场/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /打开或创建项目/ })).toBeInTheDocument();
  });

  it("creates a project by name through the inline dialog on the browser host", async () => {
    const openProjectRpc = renderBrowserOnboarding();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /打开或创建项目/ }));
    await user.type(screen.getByLabelText("项目名称"), "我的世界");
    await user.click(screen.getByRole("button", { name: "创建" }));

    await vi.waitFor(() => expect(openProjectRpc).toHaveBeenCalledWith("我的世界"));
    expect(refreshProjects).toHaveBeenCalledTimes(1);
  });
});
