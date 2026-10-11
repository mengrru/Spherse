import { fireEvent, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FileTree } from "./index";
import { createApiClient } from "../../lib/api";
import { invalidateProjectFileQueries } from "../../queries/content";
import { renderWithProviders } from "../../test/render";

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

const pickedFiles = [
  new File(["x"], "n.txt", { type: "text/plain" }),
  new File(["y"], "m.txt", { type: "text/plain" }),
];

function setup(uploadsEnabled: boolean) {
  const utils = renderWithProviders(
    <FileTree onSelectFile={() => {}} uploadsEnabled={uploadsEnabled} />,
    { locale: "en" },
  );
  return utils;
}

async function pickViaContextMenu(rowLabel: string) {
  fireEvent.contextMenu(screen.getByText(rowLabel));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Upload Files" }));
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  expect(input).not.toBeNull();
  fireEvent.change(input, { target: { files: pickedFiles } });
}

describe("FileTree context menu upload entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploadFile.mockResolvedValue({ path: "docs/n.txt", bytes: 1, renamed: false });
  });

  it("uploads picked files to the right-clicked directory", async () => {
    setup(true);
    await pickViaContextMenu("docs");
    expect(uploadFile).toHaveBeenCalledWith("docs", pickedFiles[0]);
    expect(uploadFile).toHaveBeenCalledWith("docs", pickedFiles[1]);
    await waitFor(() => expect(invalidateProjectFileQueries).toHaveBeenCalled());
  });

  it("uploads to the parent directory when picked from a file row", async () => {
    setup(true);
    await pickViaContextMenu("a.md");
    expect(uploadFile).toHaveBeenCalledWith("", pickedFiles[0]);
    expect(uploadFile).toHaveBeenCalledTimes(2);
  });

  it("hides the entry and the input when uploads are not enabled", async () => {
    setup(false);
    expect(document.querySelector('input[type="file"]')).toBeNull();
    fireEvent.contextMenu(screen.getByText("docs"));
    await screen.findByRole("menuitem", { name: "New File" });
    expect(screen.queryByRole("menuitem", { name: "Upload Files" })).toBeNull();
  });
});
