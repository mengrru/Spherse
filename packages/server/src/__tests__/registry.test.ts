import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@spherse/core", () => ({
  createProject: vi.fn(),
}));

import { createProject } from "@spherse/core";
import { ProjectRegistry } from "../registry.js";

const createProjectMock = vi.mocked(createProject);

function createLogger() {
  const log = {
    child: vi.fn(() => log),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
  return log;
}

function createRuntime(projectId = "p1", root = "/proj/p1") {
  return {
    projectId,
    projectManager: {
      getRootPath: () => root,
      regenerateProjectId: vi.fn(),
    },
    sessionRuntime: {
      setDefaultModel: vi.fn(),
      setSampling: vi.fn(),
    },
    scheduler: {},
    shutdown: vi.fn(),
  };
}

describe("ProjectRegistry sampling", () => {
  beforeEach(() => {
    createProjectMock.mockReset();
  });

  it("passes constructor sampling to createProject on register", async () => {
    createProjectMock.mockResolvedValue(createRuntime());
    const registry = new ProjectRegistry(createLogger(), {
      defaultModel: "m",
      sampling: { temperature: 0.6, topP: 0.9 },
    });

    await registry.register("/proj/p1");

    expect(createProjectMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        sampling: { temperature: 0.6, topP: 0.9 },
        defaultModel: "m",
      }),
    );
  });

  it("propagates setSampling to existing project session runtime", async () => {
    const runtime = createRuntime();
    createProjectMock.mockResolvedValue(runtime);
    const registry = new ProjectRegistry(createLogger());

    await registry.register("/proj/p1");
    registry.setSampling({ temperature: 0.8 });

    expect(runtime.sessionRuntime.setSampling).toHaveBeenCalledWith({ temperature: 0.8 });
  });

  it("propagates undefined sampling (reset)", async () => {
    const runtime = createRuntime();
    createProjectMock.mockResolvedValue(runtime);
    const registry = new ProjectRegistry(createLogger(), { sampling: { temperature: 0.5 } });

    await registry.register("/proj/p1");
    registry.setSampling(undefined);

    expect(runtime.sessionRuntime.setSampling).toHaveBeenCalledWith(undefined);
  });

  it("applies sampling to projects registered after setSampling", async () => {
    createProjectMock.mockResolvedValue(createRuntime());
    const registry = new ProjectRegistry(createLogger());

    registry.setSampling({ temperature: 0.9, topP: 0.1 });
    await registry.register("/proj/p1");

    expect(createProjectMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ sampling: { temperature: 0.9, topP: 0.1 } }),
    );
  });
});

describe("ProjectRegistry defaultModel (options bag)", () => {
  beforeEach(() => {
    createProjectMock.mockReset();
  });

  it("still accepts defaultModel via options bag", async () => {
    createProjectMock.mockResolvedValue(createRuntime());
    const registry = new ProjectRegistry(createLogger(), { defaultModel: "gemini-x" });

    await registry.register("/proj/p1");

    expect(createProjectMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ defaultModel: "gemini-x" }),
    );
  });
});

describe("ProjectRegistry lastOpened", () => {
  beforeEach(() => {
    createProjectMock.mockReset();
  });

  it("stores lastOpened provided at registration time", async () => {
    createProjectMock.mockResolvedValue(createRuntime("p1", "/proj/p1"));
    const registry = new ProjectRegistry(createLogger());

    await registry.register("/proj/p1", { lastOpened: "2026-01-01T00:00:00.000Z" });

    const info = registry.getInfo("p1");
    expect(info?.lastOpened).toBe("2026-01-01T00:00:00.000Z");
  });

  it("listInfo sorts by lastOpened descending", async () => {
    createProjectMock.mockResolvedValueOnce(createRuntime("old", "/proj/old"));
    createProjectMock.mockResolvedValueOnce(createRuntime("new", "/proj/new"));
    createProjectMock.mockResolvedValueOnce(createRuntime("mid", "/proj/mid"));
    const registry = new ProjectRegistry(createLogger());

    await registry.register("/proj/old", { lastOpened: "2026-01-01T00:00:00.000Z" });
    await registry.register("/proj/new", { lastOpened: "2026-03-01T00:00:00.000Z" });
    await registry.register("/proj/mid", { lastOpened: "2026-02-01T00:00:00.000Z" });

    const ids = registry.listInfo().map((i) => i.id);
    expect(ids).toEqual(["new", "mid", "old"]);
  });

  it("projects without lastOpened sort last", async () => {
    createProjectMock.mockResolvedValueOnce(createRuntime("with-ts", "/proj/with-ts"));
    createProjectMock.mockResolvedValueOnce(createRuntime("no-ts", "/proj/no-ts"));
    const registry = new ProjectRegistry(createLogger());

    await registry.register("/proj/with-ts", { lastOpened: "2026-01-01T00:00:00.000Z" });
    await registry.register("/proj/no-ts");

    const ids = registry.listInfo().map((i) => i.id);
    expect(ids).toEqual(["with-ts", "no-ts"]);
  });

  it("setLastOpened updates the timestamp and re-sorts", async () => {
    createProjectMock.mockResolvedValueOnce(createRuntime("a", "/proj/a"));
    createProjectMock.mockResolvedValueOnce(createRuntime("b", "/proj/b"));
    const registry = new ProjectRegistry(createLogger());

    await registry.register("/proj/a", { lastOpened: "2026-03-01T00:00:00.000Z" });
    await registry.register("/proj/b", { lastOpened: "2026-01-01T00:00:00.000Z" });

    expect(registry.listInfo().map((i) => i.id)).toEqual(["a", "b"]);

    registry.setLastOpened("b", "2026-04-01T00:00:00.000Z");

    expect(registry.getInfo("b")?.lastOpened).toBe("2026-04-01T00:00:00.000Z");
    expect(registry.listInfo().map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("setLastOpened is a no-op for unknown projectId", async () => {
    const registry = new ProjectRegistry(createLogger());
    registry.setLastOpened("nonexistent", "2026-01-01T00:00:00.000Z");
    expect(registry.listInfo()).toEqual([]);
  });

  it("register updates lastOpened for an already-registered project", async () => {
    createProjectMock.mockResolvedValue(createRuntime("p1", "/proj/p1"));
    const registry = new ProjectRegistry(createLogger());

    await registry.register("/proj/p1", { lastOpened: "2026-01-01T00:00:00.000Z" });
    await registry.register("/proj/p1", { lastOpened: "2026-06-01T00:00:00.000Z" });

    expect(registry.getInfo("p1")?.lastOpened).toBe("2026-06-01T00:00:00.000Z");
  });

  it("remove cleans up lastOpened data", async () => {
    const runtime = createRuntime("p1", "/proj/p1");
    createProjectMock.mockResolvedValue(runtime);
    const registry = new ProjectRegistry(createLogger());

    await registry.register("/proj/p1", { lastOpened: "2026-01-01T00:00:00.000Z" });
    await registry.remove("p1");

    expect(registry.getInfo("p1")).toBeUndefined();
    expect(registry.listInfo()).toEqual([]);
  });
});
