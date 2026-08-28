import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";

const { dialogMock, fsMock, unsafeMock, serverMock, translateMock, settingsMock } = vi.hoisted(() => {
  const dialogMock = {
    showMessageBox: vi.fn(),
    showOpenDialog: vi.fn(),
  };
  const fsMock = {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    cpSync: vi.fn(),
  };
  const unsafeMock = {
    isInsideUnsafeZone: vi.fn(),
  };
  const serverMock = {
    registerProject: vi.fn(),
    unregisterProject: vi.fn(),
    getServerPort: vi.fn(),
    setProjectLastOpened: vi.fn(),
  };
  const translateMock = vi.fn(
    (_locale: string, key: string, params?: Record<string, string | number>) => {
      if (key === "project.unsafeLocation.namesSeparator") return "、";
      return params ? `${key}:${String(params.names)}` : key;
    },
  );
  const settingsMock = {
    openProjects: [] as Array<{ id: string; path: string; name: string; lastOpened: string }>,
  };
  return { dialogMock, fsMock, unsafeMock, serverMock, translateMock, settingsMock };
});

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    }),
  },
  dialog: dialogMock,
  shell: {
    openPath: vi.fn(async () => ""),
    openExternal: vi.fn(async () => undefined),
  },
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: fsMock.existsSync,
    mkdirSync: fsMock.mkdirSync,
    cpSync: fsMock.cpSync,
  };
});

vi.mock("../unsafe-location.js", () => unsafeMock);

vi.mock("../server.js", () => serverMock);

vi.mock("../settings.js", () => ({
  getOpenProjects: () => settingsMock.openProjects,
  addOpenProject: () => undefined,
  removeOpenProject: () => undefined,
  setLastActiveProject: () => undefined,
  getLastActiveProject: () => null,
  getLocale: () => "zh-CN",
  bumpLastOpenedById: () => null,
}));

vi.mock("../sample-projects.js", () => ({
  readSampleManifest: async () => [
    { id: "sample", displayName: "Demo", dirName: "demo" },
  ],
  resolveSampleSrcDir: () => "/src/demo",
}));

vi.mock("./open-file-path.js", () => ({
  isInsideAnyOpenProject: () => false,
}));

vi.mock("@spherse/i18n", () => ({
  translate: translateMock,
  normalizeLocale: (locale: string) => locale,
}));

import { confirmUnsafeLocation, registerProjectIpc } from "./project.js";

const win = { id: 1 } as unknown as BrowserWindow;

registerProjectIpc(() => win);

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`no handler registered for ${channel}`);
  return Promise.resolve(fn(undefined, ...args));
}

beforeEach(() => {
  handlers.clear();
  dialogMock.showMessageBox.mockReset();
  dialogMock.showOpenDialog.mockReset();
  fsMock.existsSync.mockReset();
  fsMock.mkdirSync.mockReset();
  fsMock.cpSync.mockReset();
  unsafeMock.isInsideUnsafeZone.mockReset();
  unsafeMock.isInsideUnsafeZone.mockReturnValue(false);
  serverMock.registerProject.mockReset();
  settingsMock.openProjects = [];
  translateMock.mockClear();
  delete process.env.SPHERSE_E2E_DIALOG_RESPONSE;
  (globalThis as { __spherseTestDialogs?: unknown }).__spherseTestDialogs = undefined;
  registerProjectIpc(() => win);
});

describe("confirmUnsafeLocation", () => {
  it("returns true without a dialog when the path is safe", async () => {
    unsafeMock.isInsideUnsafeZone.mockReturnValue(false);
    await expect(confirmUnsafeLocation("/safe/proj", win)).resolves.toBe(true);
    expect(dialogMock.showMessageBox).not.toHaveBeenCalled();
  });

  it("shows a warning dialog with cancel as default and maps decline to false", async () => {
    unsafeMock.isInsideUnsafeZone.mockReturnValue(true);
    dialogMock.showMessageBox.mockResolvedValue({ response: 1 });
    await expect(confirmUnsafeLocation("/unsafe/proj", win)).resolves.toBe(false);
    expect(dialogMock.showMessageBox).toHaveBeenCalledWith(win, expect.objectContaining({
      type: "warning",
      buttons: ["project.unsafeLocation.openAnyway", "common.cancel"],
      defaultId: 1,
      cancelId: 1,
    }));
  });

  it("maps confirm to true", async () => {
    unsafeMock.isInsideUnsafeZone.mockReturnValue(true);
    dialogMock.showMessageBox.mockResolvedValue({ response: 0 });
    await expect(confirmUnsafeLocation("/unsafe/proj", win)).resolves.toBe(true);
  });

  it("falls back to the parentless overload when the window is missing", async () => {
    unsafeMock.isInsideUnsafeZone.mockReturnValue(true);
    dialogMock.showMessageBox.mockResolvedValue({ response: 1 });
    await expect(confirmUnsafeLocation("/unsafe/proj", null)).resolves.toBe(false);
    expect(dialogMock.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({ type: "warning" }));
  });
});

describe("open-project guard", () => {
  it("registers the project when the path is safe", async () => {
    serverMock.registerProject.mockResolvedValue({ projectId: "pid-1" });
    await expect(invoke("open-project", "/safe/proj")).resolves.toEqual({ projectId: "pid-1" });
    expect(serverMock.registerProject).toHaveBeenCalledWith("/safe/proj", { lastOpened: expect.any(String) });
    expect(dialogMock.showMessageBox).not.toHaveBeenCalled();
  });

  it("returns null without registering when the user declines the unsafe location", async () => {
    unsafeMock.isInsideUnsafeZone.mockReturnValue(true);
    dialogMock.showMessageBox.mockResolvedValue({ response: 1 });
    await expect(invoke("open-project", "/unsafe/proj")).resolves.toBeNull();
    expect(serverMock.registerProject).not.toHaveBeenCalled();
  });

  it("registers the project when the user confirms the unsafe location", async () => {
    unsafeMock.isInsideUnsafeZone.mockReturnValue(true);
    dialogMock.showMessageBox.mockResolvedValue({ response: 0 });
    serverMock.registerProject.mockResolvedValue({ projectId: "pid-1" });
    await expect(invoke("open-project", "/unsafe/proj")).resolves.toEqual({ projectId: "pid-1" });
    expect(serverMock.registerProject).toHaveBeenCalledWith("/unsafe/proj", { lastOpened: expect.any(String) });
  });
});

describe("open-sample-project guard", () => {
  beforeEach(() => {
    dialogMock.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ["/parent"] });
    fsMock.existsSync.mockImplementation((p: unknown) => p === "/src/demo");
    serverMock.registerProject.mockResolvedValue({ projectId: "pid-1" });
  });

  it("copies and registers when the parent directory is safe", async () => {
    await expect(invoke("open-sample-project", { sampleId: "sample" })).resolves.toEqual({
      projectId: "pid-1",
      path: "/parent/Demo",
    });
    expect(fsMock.mkdirSync).toHaveBeenCalledWith("/parent/Demo", { recursive: true });
    expect(fsMock.cpSync).toHaveBeenCalledWith("/src/demo", "/parent/Demo", { recursive: true });
    expect(serverMock.registerProject).toHaveBeenCalledWith("/parent/Demo", { lastOpened: expect.any(String) });
  });

  it("returns null without copying when the user declines the unsafe location", async () => {
    unsafeMock.isInsideUnsafeZone.mockReturnValue(true);
    dialogMock.showMessageBox.mockResolvedValue({ response: 1 });
    await expect(invoke("open-sample-project", { sampleId: "sample" })).resolves.toBeNull();
    expect(fsMock.mkdirSync).not.toHaveBeenCalled();
    expect(fsMock.cpSync).not.toHaveBeenCalled();
    expect(serverMock.registerProject).not.toHaveBeenCalled();
  });
});

describe("restore-projects startup warning", () => {
  beforeEach(() => {
    settingsMock.openProjects = [
      { id: "a", path: "/unsafe/p1", name: "p1", lastOpened: "2026-01-02T00:00:00.000Z" },
      { id: "b", path: "/safe/p2", name: "p2", lastOpened: "2026-01-01T00:00:00.000Z" },
    ];
    serverMock.registerProject.mockImplementation(async (root: string) => ({
      projectId: `pid-${root}`,
    }));
    unsafeMock.isInsideUnsafeZone.mockImplementation((p: unknown) => p === "/unsafe/p1");
    dialogMock.showMessageBox.mockResolvedValue({ response: 0 });
  });

  it("shows a one-time warning listing unsafe restored projects", async () => {
    const result = await invoke("restore-projects");
    expect(result).toHaveLength(2);
    expect(dialogMock.showMessageBox).toHaveBeenCalledTimes(1);
    expect(dialogMock.showMessageBox).toHaveBeenCalledWith(
      win,
      expect.objectContaining({
        type: "warning",
        detail: "project.unsafeLocation.startupMessage:p1",
        buttons: ["project.unsafeLocation.acknowledge"],
      }),
    );
  });

  it("does not warn again on subsequent restores in the same session", async () => {
    await invoke("restore-projects");
    dialogMock.showMessageBox.mockClear();
    await invoke("restore-projects");
    expect(dialogMock.showMessageBox).not.toHaveBeenCalled();
  });

  it("skips the warning when no restored project is unsafe", async () => {
    unsafeMock.isInsideUnsafeZone.mockReturnValue(false);
    await invoke("restore-projects");
    expect(dialogMock.showMessageBox).not.toHaveBeenCalled();
  });

  it("does not warn when the dialog fails and retries on the next restore", async () => {
    dialogMock.showMessageBox.mockRejectedValueOnce(new Error("dialog failed"));
    await invoke("restore-projects");
    expect(dialogMock.showMessageBox).toHaveBeenCalledTimes(1);
    dialogMock.showMessageBox.mockResolvedValue({ response: 0 });
    await invoke("restore-projects");
    expect(dialogMock.showMessageBox).toHaveBeenCalledTimes(2);
  });

  it("warns only once when restores run concurrently before the dialog resolves", async () => {
    const first = invoke("restore-projects");
    const second = invoke("restore-projects");
    await Promise.all([first, second]);
    expect(dialogMock.showMessageBox).toHaveBeenCalledTimes(1);
  });

  it("joins multiple unsafe project names with the locale separator", async () => {
    settingsMock.openProjects = [
      { id: "a", path: "/unsafe/p1", name: "p1", lastOpened: "2026-01-02T00:00:00.000Z" },
      { id: "b", path: "/unsafe/p2", name: "p2", lastOpened: "2026-01-01T00:00:00.000Z" },
    ];
    unsafeMock.isInsideUnsafeZone.mockReturnValue(true);
    await invoke("restore-projects");
    expect(dialogMock.showMessageBox).toHaveBeenCalledWith(
      win,
      expect.objectContaining({
        detail: "project.unsafeLocation.startupMessage:p1、p2",
      }),
    );
  });

  it("falls back to the parentless dialog overload when the window is missing", async () => {
    registerProjectIpc(() => null);
    await invoke("restore-projects");
    expect(dialogMock.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({ type: "warning" }));
  });

  it("still warns later when the first restore had no unsafe projects", async () => {
    unsafeMock.isInsideUnsafeZone.mockReturnValue(false);
    await invoke("restore-projects");
    expect(dialogMock.showMessageBox).not.toHaveBeenCalled();
    unsafeMock.isInsideUnsafeZone.mockReturnValue(true);
    await invoke("restore-projects");
    expect(dialogMock.showMessageBox).toHaveBeenCalledTimes(1);
  });
});

describe("forced dialog seam (SPHERSE_E2E_DIALOG_RESPONSE)", () => {
  function recordedDialogs(): Array<{ kind: string; detail: string }> {
    const g = globalThis as { __spherseTestDialogs?: Array<{ kind: string; detail: string }> };
    return g.__spherseTestDialogs ?? [];
  }

  it("confirmUnsafeLocation records the entry and maps response 1 to decline without showing a dialog", async () => {
    unsafeMock.isInsideUnsafeZone.mockReturnValue(true);
    process.env.SPHERSE_E2E_DIALOG_RESPONSE = "1";
    await expect(confirmUnsafeLocation("/unsafe/proj", win)).resolves.toBe(false);
    expect(dialogMock.showMessageBox).not.toHaveBeenCalled();
    expect(recordedDialogs()).toEqual([
      { kind: "confirmUnsafeLocation", detail: "project.unsafeLocation.message" },
    ]);
  });

  it("confirmUnsafeLocation maps response 0 to confirm", async () => {
    unsafeMock.isInsideUnsafeZone.mockReturnValue(true);
    process.env.SPHERSE_E2E_DIALOG_RESPONSE = "0";
    await expect(confirmUnsafeLocation("/unsafe/proj", win)).resolves.toBe(true);
    expect(dialogMock.showMessageBox).not.toHaveBeenCalled();
  });

  it("startup warning records the joined names via the seam", async () => {
    settingsMock.openProjects = [
      { id: "a", path: "/unsafe/p1", name: "p1", lastOpened: "2026-01-01T00:00:00.000Z" },
    ];
    serverMock.registerProject.mockResolvedValue({ projectId: "pid-1" });
    unsafeMock.isInsideUnsafeZone.mockReturnValue(true);
    process.env.SPHERSE_E2E_DIALOG_RESPONSE = "0";
    await invoke("restore-projects");
    expect(dialogMock.showMessageBox).not.toHaveBeenCalled();
    expect(recordedDialogs()).toEqual([
      { kind: "startupUnsafeWarning", detail: "project.unsafeLocation.startupMessage:p1" },
    ]);
  });
});
