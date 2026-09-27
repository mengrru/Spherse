import { act, renderHook, waitFor } from "@testing-library/react";
import { I18nProvider } from "@spherse/i18n/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../../lib/api";
import { invalidateProjectFileQueries } from "../../../queries/content";
import { useFileTreeController } from "./useFileTreeController";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

vi.mock("../../../queries/content", () => ({
  invalidateProjectFileQueries: vi.fn(async () => {}),
}));

function makeFile(name: string): File {
  return new File(["content"], name, { type: "text/plain" });
}

function setup() {
  const uploadFile = vi.fn<[string, File], Promise<{ path: string; bytes: number; renamed: boolean }>>();
  const client = { uploadFile } as unknown as ApiClient;
  const utils = renderHook(() => useFileTreeController(client, undefined, "p1"), {
    wrapper: ({ children }) => <I18nProvider locale="zh-CN">{children}</I18nProvider>,
  });
  return { uploadFile, ...utils };
}

describe("useFileTreeController uploadFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uploads every file to the target dir, invalidates queries, and expands the dir", async () => {
    const { result, uploadFile } = setup();
    uploadFile.mockImplementation(async (_dir, file) => ({
      path: `docs/${file.name}`,
      bytes: file.size,
      renamed: false,
    }));
    const a = makeFile("a.txt");
    const b = makeFile("b.md");

    await act(async () => {
      await result.current.uploadFiles("docs", [a, b]);
    });

    expect(uploadFile).toHaveBeenCalledTimes(2);
    expect(uploadFile).toHaveBeenNthCalledWith(1, "docs", a);
    expect(uploadFile).toHaveBeenNthCalledWith(2, "docs", b);
    expect(invalidateProjectFileQueries).toHaveBeenCalledWith("p1", "docs/a.txt");
    expect(invalidateProjectFileQueries).toHaveBeenCalledWith("p1", "docs/b.md");
    expect(toast.success).toHaveBeenCalledWith("已上传 2 个文件");
    expect(toast.info).not.toHaveBeenCalled();
    expect(result.current.expandedPaths.has("docs")).toBe(true);
  });

  it("reports server-side renames", async () => {
    const { result, uploadFile } = setup();
    uploadFile.mockResolvedValueOnce({ path: "note (1).txt", bytes: 1, renamed: true });
    await act(async () => {
      await result.current.uploadFiles("", [makeFile("note.txt")]);
    });
    expect(toast.info).toHaveBeenCalledWith("同名文件已自动重命名：note (1).txt");
  });

  it("continues after a failed upload and only invalidates successes", async () => {
    const { result, uploadFile } = setup();
    uploadFile.mockRejectedValueOnce(new Error("boom"));
    uploadFile.mockResolvedValueOnce({ path: "docs/ok.txt", bytes: 1, renamed: false });

    await act(async () => {
      await result.current.uploadFiles("docs", [makeFile("bad.txt"), makeFile("ok.txt")]);
    });

    expect(toast.error).toHaveBeenCalledWith("上传失败：boom");
    expect(invalidateProjectFileQueries).toHaveBeenCalledTimes(1);
    expect(invalidateProjectFileQueries).toHaveBeenCalledWith("p1", "docs/ok.txt");
    expect(toast.success).toHaveBeenCalledWith("已上传 1 个文件");
    await waitFor(() => expect(result.current.expandedPaths.has("docs")).toBe(true));
  });

  it("does nothing for an empty file list", async () => {
    const { result, uploadFile } = setup();
    await act(async () => {
      await result.current.uploadFiles("docs", []);
    });
    expect(uploadFile).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
