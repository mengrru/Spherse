import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders, createTestQueryClient } from "../../test/render";
import { ContextPathField } from "./ContextPathField";
import { SearchFileField } from "./SearchFileField";
import { CONTEXT_TOTAL_SIZE_LIMIT_BYTES } from "@spherse/presets";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const inspectContextFiles = vi.fn();
const getFileTree = vi.fn();

vi.mock("../../lib/use-connection", () => ({
  useApiClient: () => mockClient,
}));

const mockClient = {
  getFileTree,
  inspectContextFiles,
} as unknown as import("../../lib/api").ApiClient;

import { toast } from "sonner";

function stat(path: string, sizeBytes: number, allowed = true) {
  return { path, exists: sizeBytes > 0, sizeBytes, allowed };
}

describe("ContextPathField", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function render(props?: { contextPaths?: string[] }) {
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    renderWithProviders(
      <ContextPathField
        contextPaths={props?.contextPaths ?? []}
        onAdd={onAdd}
        onRemove={onRemove}
      />,
      { queryClient: createTestQueryClient() },
    );
    return { onAdd, onRemove };
  }

  it("shows the total usage of existing context files", async () => {
    inspectContextFiles.mockResolvedValue([stat("a.md", 2048), stat("b.txt", 1024)]);
    render({ contextPaths: ["a.md", "b.txt"] });

    await waitFor(() => {
      expect(screen.getByText(/已用 3\.0 kB \/ 512 kB/)).toBeInTheDocument();
    });
  });

  it("marks the usage line as destructive when over the limit", async () => {
    inspectContextFiles.mockResolvedValue([stat("big.md", CONTEXT_TOTAL_SIZE_LIMIT_BYTES + 1)]);
    render({ contextPaths: ["big.md"] });

    const usage = await waitFor(() => {
      const el = screen.getByText(/已用/);
      expect(el.className).toContain("text-destructive");
      return el;
    });
    expect(usage).toBeInTheDocument();
  });

  it("hides the usage line when there are no context files", () => {
    render({ contextPaths: [] });
    expect(screen.queryByText(/已用/)).not.toBeInTheDocument();
  });

  it("rejects adding a non plain-text path with a toast and never calls onAdd", async () => {
    const { onAdd } = render({ contextPaths: [] });
    const input = screen.getByPlaceholderText(/输入路径搜索文件/);

    fireEvent.change(input, { target: { value: "img/cover.png" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("不支持的文件格式：仅允许纯文本文件");
    });
    expect(onAdd).not.toHaveBeenCalled();
    expect(inspectContextFiles).not.toHaveBeenCalled();
  });

  it("rejects adding a file that pushes the total over the limit", async () => {
    inspectContextFiles.mockImplementation(async (paths: string[]) =>
      paths.map((p) => (p === "used.md" ? stat("used.md", CONTEXT_TOTAL_SIZE_LIMIT_BYTES - 10) : stat(p, 100))),
    );
    const { onAdd } = render({ contextPaths: ["used.md"] });
    const input = screen.getByPlaceholderText(/输入路径搜索文件/);

    fireEvent.change(input, { target: { value: "extra.md" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("参考资料总大小不能超过 512 kB");
    });
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("adds a file when format and size checks pass", async () => {
    inspectContextFiles.mockImplementation(async (paths: string[]) =>
      paths.map((p) => stat(p, p === "used.md" ? 1000 : 500)),
    );
    const { onAdd } = render({ contextPaths: ["used.md"] });
    const input = screen.getByPlaceholderText(/输入路径搜索文件/);

    fireEvent.change(input, { target: { value: "new.md" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledWith("new.md");
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("ignores duplicate paths", async () => {
    const { onAdd } = render({ contextPaths: ["used.md"] });
    const input = screen.getByPlaceholderText(/输入路径搜索文件/);

    fireEvent.change(input, { target: { value: "used.md" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await Promise.resolve();
    expect(onAdd).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("toasts an inspect error when the request fails", async () => {
    inspectContextFiles.mockRejectedValue(new Error("network"));
    const { onAdd } = render({ contextPaths: [] });
    const input = screen.getByPlaceholderText(/输入路径搜索文件/);

    fireEvent.change(input, { target: { value: "new.md" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("检查参考资料失败");
    });
    expect(onAdd).not.toHaveBeenCalled();
  });
});

describe("SearchFileField filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("only suggests files accepted by the filter", async () => {
    getFileTree.mockResolvedValue(["notes/a.md", "img/cover.png", "Makefile"]);
    const onSelect = vi.fn();
    renderWithProviders(
      <SearchFileField
        exclude={[]}
        onSelect={onSelect}
        filter={(p) => p.endsWith(".md")}
        placeholder="p"
      />,
      { queryClient: createTestQueryClient() },
    );

    const input = screen.getByPlaceholderText("p");
    await waitFor(() => expect(getFileTree).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    fireEvent.change(input, { target: { value: "o" } });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "notes/a.md" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "img/cover.png" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Makefile" })).not.toBeInTheDocument();
  });
});
