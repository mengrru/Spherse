import { screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { createMockHostBridge } from "../../test/host-bridge";
import { renderWithProviders } from "../../test/render";
import { UnsupportedFileCard } from "./UnsupportedFileCard";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const downloadFileApi = vi.fn(async (_filePath: string) => new Blob(["bytes"]));

vi.mock("../../lib/use-connection", () => ({
  useApiClient: () => ({ downloadFile: downloadFileApi }),
  useConnection: () => ({ baseUrl: "http://localhost:5173", accessToken: null }),
}));

const openFileExternal = vi.fn(async () => {});
const desktopDownloadFile = vi.fn(async () => {});

function renderCard(
  overrides: {
    openFileExternalCapability?: boolean;
    projectRoot?: string;
    mode?: "desktop" | "web" | "none";
  } = {},
) {
  const mode = overrides.mode ?? "desktop";
  const bridge = createMockHostBridge({
    capabilities: { openFileExternal: overrides.openFileExternalCapability ?? false },
    ...(mode === "desktop"
      ? { project: { openFileExternal, downloadFile: desktopDownloadFile } as never }
      : {}),
    ...(mode === "web"
      ? { project: { openFileExternal } as never, saveBlob: vi.fn(async (_filename: string, _blob: Blob) => {}) }
      : {}),
    ...(mode === "none" ? { project: { openFileExternal } as never } : {}),
  });
  renderWithProviders(<UnsupportedFileCard filePath="docs/schema.bin" />, {
    bridge,
    projectRoot: overrides.projectRoot ?? "/data/proj",
  });
}

beforeEach(() => {
  downloadFileApi.mockReset();
  downloadFileApi.mockResolvedValue(new Blob(["bytes"]));
  desktopDownloadFile.mockReset();
  desktopDownloadFile.mockResolvedValue(undefined);
  openFileExternal.mockReset();
  openFileExternal.mockResolvedValue(undefined);
  vi.mocked(toast.error).mockClear();
});

describe("UnsupportedFileCard", () => {
  it("gates the open-externally button on the openFileExternal capability", () => {
    renderCard({ openFileExternalCapability: false, mode: "desktop" });
    expect(screen.queryByRole("button", { name: "用默认应用打开" })).not.toBeInTheDocument();
  });

  it("opens the file via the project host api with an absolute path", async () => {
    const user = userEvent.setup();
    renderCard({ openFileExternalCapability: true, mode: "desktop" });

    await user.click(screen.getByRole("button", { name: "用默认应用打开" }));

    expect(openFileExternal).toHaveBeenCalledWith("/data/proj/docs/schema.bin");
  });

  it("normalizes separators when joining projectRoot with the relative path", async () => {
    const user = userEvent.setup();
    renderCard({ openFileExternalCapability: true, mode: "desktop", projectRoot: "/data/proj/" });

    await user.click(screen.getByRole("button", { name: "用默认应用打开" }));

    expect(openFileExternal).toHaveBeenCalledWith("/data/proj/docs/schema.bin");
  });

  it("downloads via the desktop project api with an absolute path and without fetching", async () => {
    const user = userEvent.setup();
    renderCard({ openFileExternalCapability: false, mode: "desktop" });

    await user.click(screen.getByRole("button", { name: "下载" }));

    await waitFor(() => expect(desktopDownloadFile).toHaveBeenCalledWith("/data/proj/docs/schema.bin"));
    expect(downloadFileApi).not.toHaveBeenCalled();
  });

  it("downloads via the api client and saveBlob on web bridges without open capability", async () => {
    const user = userEvent.setup();
    const saveBlob = vi.fn(async (_filename: string, _blob: Blob) => {});
    const bridge = createMockHostBridge({
      capabilities: { openFileExternal: false },
      project: { openFileExternal } as never,
      saveBlob,
    });
    renderWithProviders(<UnsupportedFileCard filePath="docs/报告 final.bin" />, {
      bridge,
      projectRoot: "/data/proj",
    });

    expect(screen.queryByRole("button", { name: "用默认应用打开" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "下载" }));

    await waitFor(() => expect(downloadFileApi).toHaveBeenCalledWith("docs/报告 final.bin"));
    await waitFor(() => expect(saveBlob).toHaveBeenCalledTimes(1));
    const [filename, blob] = saveBlob.mock.calls[0];
    expect(filename).toBe("报告 final.bin");
    expect(blob).toBeInstanceOf(Blob);
  });

  it("surfaces a toast and does not save when the download api fails", async () => {
    const user = userEvent.setup();
    downloadFileApi.mockRejectedValue(new Error("HTTP 403"));
    const saveBlob = vi.fn(async (_filename: string, _blob: Blob) => {});
    const bridge = createMockHostBridge({
      capabilities: { openFileExternal: false },
      project: { openFileExternal } as never,
      saveBlob,
    });
    renderWithProviders(<UnsupportedFileCard filePath="docs/schema.bin" />, {
      bridge,
      projectRoot: "/data/proj",
    });

    await user.click(screen.getByRole("button", { name: "下载" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(vi.mocked(toast.error).mock.calls.at(-1)![0]).toContain("下载失败");
    expect(saveBlob).not.toHaveBeenCalled();
  });

  it("surfaces a toast when the desktop download ipc rejects", async () => {
    const user = userEvent.setup();
    desktopDownloadFile.mockRejectedValue(new Error("File is not inside an open project"));
    renderCard({ openFileExternalCapability: false, mode: "desktop" });

    await user.click(screen.getByRole("button", { name: "下载" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(vi.mocked(toast.error).mock.calls.at(-1)![0]).toContain("下载失败");
  });

  it("treats a cancelled desktop download as success without a toast", async () => {
    const user = userEvent.setup();
    desktopDownloadFile.mockResolvedValue(undefined);
    renderCard({ openFileExternalCapability: false, mode: "desktop" });

    await user.click(screen.getByRole("button", { name: "下载" }));

    await waitFor(() => expect(desktopDownloadFile).toHaveBeenCalled());
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("hides the download button when no download channel exists", () => {
    renderCard({ mode: "none" });
    expect(screen.queryByRole("button", { name: "下载" })).not.toBeInTheDocument();
  });
});
