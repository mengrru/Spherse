import { fireEvent, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render";
import { FileTreeContextMenu } from "./FileTreeContextMenu";
import type { TreeItem } from "./tree-model";

const file = { name: "a.md", path: "docs/a.md", type: "file" } as TreeItem;
const dir = { name: "docs", path: "docs", type: "directory" } as TreeItem;

function open(node: TreeItem, props: Record<string, unknown> = {}) {
  renderWithProviders(
    <FileTreeContextMenu node={node} onCreate={vi.fn()} onDelete={vi.fn()} {...props}>
      <span>row</span>
    </FileTreeContextMenu>,
    { locale: "en" },
  );
  fireEvent.contextMenu(screen.getByText("row"));
}

describe("FileTreeContextMenu split item", () => {
  it("offers split for files and calls back with the path", async () => {
    const onSplitFile = vi.fn();
    open(file, { onSplitFile, splitFilePath: null });
    await userEvent.click(await screen.findByRole("menuitem", { name: "Split" }));
    expect(onSplitFile).toHaveBeenCalledWith("docs/a.md");
  });

  it("offers cancel split when the file is already split", async () => {
    open(file, { onSplitFile: vi.fn(), splitFilePath: "docs/a.md" });
    expect(await screen.findByRole("menuitem", { name: "Cancel Split" })).toBeInTheDocument();
  });

  it("does not offer split for directories or when unavailable", async () => {
    open(dir, { onSplitFile: vi.fn() });
    await screen.findByRole("menuitem", { name: "New File" });
    expect(screen.queryByRole("menuitem", { name: "Split" })).toBeNull();
  });

  it("does not offer split when no handler is provided", async () => {
    open(file);
    await screen.findByRole("menuitem", { name: "New File" });
    expect(screen.queryByRole("menuitem", { name: "Split" })).toBeNull();
  });
});
