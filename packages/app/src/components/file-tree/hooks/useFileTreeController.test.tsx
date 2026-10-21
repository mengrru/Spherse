import { act, renderHook, waitFor } from "@testing-library/react";
import { I18nProvider } from "@spherse/i18n/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../../lib/api";
import { invalidateProjectFileQueries } from "../../../queries/content";
import { invalidateProjectSkillQueries } from "../../../queries/skills";
import { useFileTreeController } from "./useFileTreeController";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

vi.mock("../../../queries/content", () => ({
  invalidateProjectFileQueries: vi.fn(async () => {}),
}));

vi.mock("../../../queries/skills", () => ({
  invalidateProjectSkillQueries: vi.fn(async () => {}),
}));

function makeFile(name: string): File {
  return new File(["content"], name, { type: "text/plain" });
}

function setup(onRenamed?: (from: string, to: string) => void) {
  const uploadFile = vi.fn<(dir: string, file: File) => Promise<{ path: string; bytes: number; renamed: boolean }>>();
  const renameContent = vi.fn<(from: string, to: string) => Promise<{ ok: boolean }>>();
  const client = { uploadFile, renameContent } as unknown as ApiClient;
  const utils = renderHook(
    () => useFileTreeController(client, undefined, "p1", onRenamed),
    {
      wrapper: ({ children }) => <I18nProvider locale="zh-CN">{children}</I18nProvider>,
    },
  );
  return { uploadFile, renameContent, ...utils };
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

  it("shows a hint and does nothing else for an empty file list", async () => {
    const { result, uploadFile } = setup();
    await act(async () => {
      await result.current.uploadFiles("docs", []);
    });
    expect(uploadFile).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith("仅支持拖入文件，文件夹将被忽略");
  });
});

describe("useFileTreeController rename", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renames via the API, remaps expandedPaths, invalidates queries, and notifies onRenamed", async () => {
    const onRenamed = vi.fn();
    const { result, renameContent } = setup(onRenamed);
    renameContent.mockResolvedValue({ ok: true });

    act(() => {
      result.current.requestRename({ name: "old", path: "docs/old", type: "directory" });
    });
    expect(result.current.renaming?.path).toBe("docs/old");
    act(() => {
      result.current.toggleDir("docs/old/sub");
    });

    await act(async () => {
      await result.current.submitRename("new");
    });

    expect(renameContent).toHaveBeenCalledWith("docs/old", "docs/new");
    expect(invalidateProjectFileQueries).toHaveBeenCalledWith("p1", "docs/old");
    expect(invalidateProjectFileQueries).toHaveBeenCalledWith("p1", "docs/new");
    expect(onRenamed).toHaveBeenCalledWith("docs/old", "docs/new");
    expect(result.current.renaming).toBeNull();
    expect(result.current.expandedPaths.has("docs/new/sub")).toBe(true);
  });

  it("exits editing without an API call when the name is unchanged", async () => {
    const { result, renameContent } = setup();
    act(() => {
      result.current.requestRename({ name: "a.md", path: "docs/a.md", type: "file" });
    });
    await act(async () => {
      await result.current.submitRename("a.md");
    });
    expect(renameContent).not.toHaveBeenCalled();
    expect(result.current.renaming).toBeNull();
  });

  it("keeps editing and toasts on failure", async () => {
    const { result, renameContent } = setup();
    renameContent.mockRejectedValueOnce(new Error("boom"));
    act(() => {
      result.current.requestRename({ name: "a.md", path: "docs/a.md", type: "file" });
    });
    await act(async () => {
      await result.current.submitRename("b.md");
    });
    expect(renameContent).toHaveBeenCalledWith("docs/a.md", "docs/b.md");
    expect(toast.error).toHaveBeenCalledWith("重命名失败：boom");
    expect(result.current.renaming?.path).toBe("docs/a.md");
  });

  it("invalidates skill queries when renaming under .spherse/skills", async () => {
    const { result, renameContent } = setup();
    renameContent.mockResolvedValue({ ok: true });
    act(() => {
      result.current.requestRename({ name: "old", path: ".spherse/skills/old", type: "directory" });
    });
    await act(async () => {
      await result.current.submitRename("new");
    });
    expect(invalidateProjectSkillQueries).toHaveBeenCalledWith("p1");
  });
});
