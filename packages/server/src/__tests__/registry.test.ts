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
