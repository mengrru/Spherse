import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createMockHostBridge } from "../../test/host-bridge";
import { renderWithProviders } from "../../test/render";
import { ContentView } from "./ContentView";

vi.mock("../../lib/use-connection", () => ({
  useApiClient: () => ({
    getPreviewUrl: (path: string) => `http://localhost:5173/api/projects/p1/preview/${path}`,
    getContent: vi.fn(),
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
