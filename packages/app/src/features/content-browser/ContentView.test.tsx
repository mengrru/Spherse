import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createMockHostBridge } from "../../test/host-bridge";
import { renderWithProviders } from "../../test/render";
import { ContentView } from "./ContentView";
import { FindScopeRoot } from "./FindScopeRoot";

const getContent = vi.fn();

vi.mock("../../lib/use-connection", () => ({
  useApiClient: () => ({
    getPreviewUrl: (path: string) => `http://localhost:5173/api/projects/p1/preview/${path}`,
    getContent,
  }),
  useConnection: () => ({ baseUrl: "http://localhost:5173", accessToken: null }),
}));

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    filePath: "notes/todo.md",
    content: "# hello",
    binary: false,
    loading: false,
    error: null,
    isMarkdown: true,
    isHtml: false,
    isImage: false,
    htmlView: "source" as const,
    isEditing: false,
    editedContent: "",
    onEditedContentChange: vi.fn(),
    refreshKey: 0,
    ...overrides,
  };
}

describe("ContentView find gating", () => {
  it("binds Cmd/Ctrl+F to open the find bar when enabled", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContentView {...baseProps()} />, { bridge: createMockHostBridge() });

    expect(screen.queryByPlaceholderText("查找")).not.toBeInTheDocument();

    await user.type(document.body, "{Control>}f{/Control}");
    expect(screen.getByPlaceholderText("查找")).toBeInTheDocument();
  });

  it("does not open find for non-searchable views (binary content)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContentView {...baseProps({ binary: true, content: null })} />, { bridge: createMockHostBridge() });

    await user.type(document.body, "{Control>}f{/Control}");
    expect(screen.queryByPlaceholderText("查找")).not.toBeInTheDocument();
  });

  it("does not open find for html preview views", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ContentView {...baseProps({ isMarkdown: false, isHtml: true, htmlView: "preview", content: "<p>x</p>" })} />,
      { bridge: createMockHostBridge() },
    );

    await user.type(document.body, "{Control>}f{/Control}");
    expect(screen.queryByPlaceholderText("查找")).not.toBeInTheDocument();
  });

  it("supports a parent-controlled findOpen and falls back to internal state", () => {
    const onFindOpenChange = vi.fn();
    renderWithProviders(
      <ContentView {...baseProps({ findOpen: true, onFindOpenChange })} />,
      { bridge: createMockHostBridge() },
    );
    expect(screen.getByPlaceholderText("查找")).toBeInTheDocument();
  });

  it("closes find when the view becomes non-searchable", async () => {
    const onFindOpenChange = vi.fn();
    const view = renderWithProviders(
      <ContentView {...baseProps({ findOpen: true, onFindOpenChange })} />,
      { bridge: createMockHostBridge() },
    );
    expect(screen.getByPlaceholderText("查找")).toBeInTheDocument();

    view.rerender(<ContentView {...baseProps({ findOpen: true, onFindOpenChange, binary: true, content: null })} />);
    await vi.waitFor(() => expect(onFindOpenChange).toHaveBeenCalledWith(false));
    expect(screen.queryByPlaceholderText("查找")).not.toBeInTheDocument();
  });
});

describe("ContentView find scope", () => {
  function TwoViews() {
    return (
      <>
        <FindScopeRoot data-testid="left">
          <button type="button">left-header</button>
          <ContentView {...baseProps({ filePath: "left.md", content: "left" })} />
        </FindScopeRoot>
        <FindScopeRoot data-testid="right">
          <button type="button">right-header</button>
          <ContentView {...baseProps({ filePath: "right.md", content: "right" })} />
        </FindScopeRoot>
      </>
    );
  }

  it("opens find only in the most recently interacted scope", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TwoViews />, { bridge: createMockHostBridge() });

    await user.click(screen.getByRole("button", { name: "left-header" }));
    await user.keyboard("{Control>}f{/Control}");
    expect(screen.getAllByPlaceholderText("查找")).toHaveLength(1);
    expect(screen.getByTestId("left")).toContainElement(screen.getByPlaceholderText("查找"));
  });

  it("falls back to the latest mounted scope before any interaction", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TwoViews />, { bridge: createMockHostBridge() });

    await user.keyboard("{Control>}f{/Control}");
    expect(screen.getAllByPlaceholderText("查找")).toHaveLength(1);
    expect(screen.getByTestId("right")).toContainElement(screen.getByPlaceholderText("查找"));
  });

  it("does not open find after interacting outside every scope", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <TwoViews />
        <textarea aria-label="composer" />
      </>,
      { bridge: createMockHostBridge() },
    );

    await user.click(screen.getByRole("button", { name: "right-header" }));
    await user.click(screen.getByRole("textbox", { name: "composer" }));
    await user.keyboard("{Control>}f{/Control}");
    expect(screen.queryByPlaceholderText("查找")).toBeNull();
  });

  it("falls back to a remaining scope after the active one unmounts", async () => {
    const user = userEvent.setup();
    const view = renderWithProviders(<TwoViews />, { bridge: createMockHostBridge() });
    await user.click(screen.getByRole("button", { name: "right-header" }));

    view.rerender(
      <FindScopeRoot data-testid="left">
        <ContentView {...baseProps({ filePath: "left.md", content: "left" })} />
      </FindScopeRoot>,
    );
    await user.keyboard("{Control>}f{/Control}");
    expect(screen.getByTestId("left")).toContainElement(screen.getByPlaceholderText("查找"));
  });
});

describe("ContentView internal links", () => {
  it("delegates internal links to onOpenFile when provided", async () => {
    const user = userEvent.setup();
    const onOpenFile = vi.fn();
    getContent.mockResolvedValue({ path: "notes/other.md", content: "", binary: false });
    renderWithProviders(
      <ContentView {...baseProps({ content: "[other](other.md)", onOpenFile })} />,
      { bridge: createMockHostBridge(), route: "/project/p1/content?path=notes%2Ftodo.md" },
    );

    await user.click(screen.getByRole("link", { name: "other" }));
    await vi.waitFor(() => expect(onOpenFile).toHaveBeenCalledWith("notes/other.md"));
  });
});
