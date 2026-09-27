import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FileTree } from "./index";
import { createApiClient } from "../../lib/api";
import { invalidateProjectFileQueries } from "../../queries/content";
import { renderWithProviders } from "../../test/render";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

vi.mock("../../lib/use-connection", () => ({
  useApiClient: () => fakeClient,
}));

vi.mock("../../queries/content", () => ({
  useProjectDirectory: () => ({
    data: [
      { name: "docs", type: "directory" },
      { name: "a.md", type: "file" },
    ],
    isPending: false,
  }),
  useProjectFileTree: () => ({ data: [] }),
  invalidateProjectFileQueries: vi.fn(async () => {}),
}));

const uploadFile = vi.fn<(dir: string, file: File) => Promise<{ path: string; bytes: number; renamed: boolean }>>();
const fakeClient = { ...createApiClient("http://localhost:1", "p1"), uploadFile } as ReturnType<typeof createApiClient>;

const fileDrag = { types: ["Files"], dropEffect: "", items: [], files: [] };
const fileDragWithFile = {
  types: ["Files"],
  dropEffect: "",
  items: [],
  files: [new File(["x"], "n.txt", { type: "text/plain" })],
};

function setup() {
  const utils = renderWithProviders(
    <FileTree onSelectFile={() => {}} uploadsEnabled />,
  );
  return { rootEl: utils.container.firstElementChild as HTMLElement, ...utils };
}

function dragLeaveWithRelated(el: Element, related: Node | null) {
  const event = new Event("dragleave", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "relatedTarget", { value: related });
  Object.defineProperty(event, "dataTransfer", { value: fileDrag });
  act(() => {
    el.dispatchEvent(event);
  });
}

describe("FileTree drag highlight state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploadFile.mockResolvedValue({ path: "docs/n.txt", bytes: 1, renamed: false });
  });

  it("activates the root zone over empty area, then hands over to a row without sticking", () => {
    const { rootEl } = setup();
    const dirRow = screen.getByText("docs").closest("button") as HTMLElement;

    fireEvent.dragOver(rootEl, { dataTransfer: fileDrag });
    expect(rootEl).toHaveClass("ring-sidebar-ring");

    fireEvent.dragOver(dirRow, { dataTransfer: fileDrag });
    expect(dirRow).toHaveClass("ring-sidebar-ring");
    expect(rootEl).not.toHaveClass("ring-sidebar-ring");

    fireEvent.drop(dirRow, { dataTransfer: fileDragWithFile });
    expect(dirRow).not.toHaveClass("ring-sidebar-ring");
    expect(rootEl).not.toHaveClass("ring-sidebar-ring");
    expect(uploadFile).toHaveBeenCalledWith("docs", fileDragWithFile.files[0]);
  });

  it("focuses the containing folder when hovering a file row, not the file itself", () => {
    const { rootEl } = setup();
    const fileRow = screen.getByText("a.md").closest("button") as HTMLElement;
    const dirRow = screen.getByText("docs").closest("button") as HTMLElement;

    fireEvent.dragOver(fileRow, { dataTransfer: fileDrag });
    expect(fileRow).not.toHaveClass("ring-sidebar-ring");
    expect(rootEl).toHaveClass("ring-sidebar-ring");

    fireEvent.dragOver(dirRow, { dataTransfer: fileDrag });
    expect(dirRow).toHaveClass("ring-sidebar-ring");
    expect(rootEl).not.toHaveClass("ring-sidebar-ring");

    fireEvent.drop(fileRow, { dataTransfer: fileDragWithFile });
    expect(uploadFile).toHaveBeenCalledWith("", fileDragWithFile.files[0]);
    expect(dirRow).not.toHaveClass("ring-sidebar-ring");
  });

  it("clears the root zone when the drag leaves the panel", () => {
    const { rootEl } = setup();
    fireEvent.dragOver(rootEl, { dataTransfer: fileDrag });
    expect(rootEl).toHaveClass("ring-sidebar-ring");

    dragLeaveWithRelated(rootEl, null);
    expect(rootEl).not.toHaveClass("ring-sidebar-ring");
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("keeps the root zone active while moving between inner elements", () => {
    const { rootEl } = setup();
    fireEvent.dragOver(rootEl, { dataTransfer: fileDrag });

    dragLeaveWithRelated(rootEl, screen.getByText("docs"));
    expect(rootEl).toHaveClass("ring-sidebar-ring");
  });

  it("uploads to the root dir when dropped on the empty area", async () => {
    const { rootEl } = setup();
    fireEvent.dragOver(rootEl, { dataTransfer: fileDrag });
    fireEvent.drop(rootEl, { dataTransfer: fileDragWithFile });

    expect(uploadFile).toHaveBeenCalledWith("", fileDragWithFile.files[0]);
    await waitFor(() => expect(invalidateProjectFileQueries).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith("已上传 1 个文件");
  });
});
