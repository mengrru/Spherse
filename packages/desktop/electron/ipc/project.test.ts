import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";

const { dialogMock, fsMock, unsafeMock, serverMock } = vi.hoisted(() => {
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
  return { dialogMock, fsMock, unsafeMock, serverMock };
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
  getOpenProjects: () => [],
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
  translate: (_locale: string, key: string) => key,
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
