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

describe("FileTreeContextMenu rename item", () => {
  it("places Rename after Upload Files (last of the create group) and calls back with the node", async () => {
    const onRename = vi.fn();
    open(file, { onRename, onUploadFiles: vi.fn(), onFloatFile: vi.fn(), floatedFilePaths: new Set() });
    const names = (await screen.findAllByRole("menuitem")).map((el) => el.textContent);
    expect(names).toEqual([
      "Float",
      "New File",
      "New Folder",
      "Upload Files",
      "Rename",
      "Copy Path",
      "Delete",
    ]);
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(onRename).toHaveBeenCalledWith(file);
  });

  it("keeps Rename after Upload Files for directories", async () => {
    const onRename = vi.fn();
    open(dir, { onRename, onUploadFiles: vi.fn() });
    const names = (await screen.findAllByRole("menuitem")).map((el) => el.textContent);
    expect(names).toEqual([
      "New File",
      "New Folder",
      "Upload Files",
      "Rename",
      "Copy Path",
      "Delete",
    ]);
  });

  it("keeps Rename available after New Folder when the upload item is gated off", async () => {
    open(dir, { onRename: vi.fn() });
    const names = (await screen.findAllByRole("menuitem")).map((el) => el.textContent);
    expect(names).toEqual(["New File", "New Folder", "Rename", "Copy Path", "Delete"]);
  });

  it("does not offer Rename when no handler is provided", async () => {
    open(file);
    await screen.findByRole("menuitem", { name: "New File" });
    expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
  });

  it("keeps other actions available with Rename in the create group: Float and Delete still work", async () => {
    const onFloatFile = vi.fn();
    const onDelete = vi.fn();
    open(file, { onRename: vi.fn(), onFloatFile, floatedFilePaths: new Set(), onDelete });
    await userEvent.click(await screen.findByRole("menuitem", { name: "Float" }));
    expect(onFloatFile).toHaveBeenCalledWith("docs/a.md");
    fireEvent.contextMenu(screen.getByText("row"));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalled();
  });
});

describe("FileTreeContextMenu upload item", () => {
  it("uploads to the directory itself for directories", async () => {
    const onUploadFiles = vi.fn();
    open(dir, { onUploadFiles });
    await userEvent.click(await screen.findByRole("menuitem", { name: "Upload Files" }));
    expect(onUploadFiles).toHaveBeenCalledWith("docs");
  });

  it("uploads to the parent directory for files", async () => {
    const onUploadFiles = vi.fn();
    open(file, { onUploadFiles });
    await userEvent.click(await screen.findByRole("menuitem", { name: "Upload Files" }));
    expect(onUploadFiles).toHaveBeenCalledWith("docs");
  });

  it("does not offer upload when no handler is provided", async () => {
    open(file);
    await screen.findByRole("menuitem", { name: "New File" });
    expect(screen.queryByRole("menuitem", { name: "Upload Files" })).toBeNull();
  });
});
