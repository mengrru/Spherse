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
      setTemperature: vi.fn(),
    },
    scheduler: {},
    shutdown: vi.fn(),
  };
}

describe("ProjectRegistry temperature", () => {
  beforeEach(() => {
    createProjectMock.mockReset();
  });

  it("passes constructor temperature to createProject on register", async () => {
    createProjectMock.mockResolvedValue(createRuntime());
    const registry = new ProjectRegistry(createLogger(), {
      defaultModel: "m",
      temperature: 0.6,
    });

    await registry.register("/proj/p1");

    expect(createProjectMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ temperature: 0.6, defaultModel: "m" }),
    );
  });

  it("propagates setTemperature to existing project session runtime", async () => {
    const runtime = createRuntime();
    createProjectMock.mockResolvedValue(runtime);
    const registry = new ProjectRegistry(createLogger());

    await registry.register("/proj/p1");
    registry.setTemperature(0.8);

    expect(runtime.sessionRuntime.setTemperature).toHaveBeenCalledWith(0.8);
  });

  it("propagates undefined temperature (reset to provider default)", async () => {
    const runtime = createRuntime();
    createProjectMock.mockResolvedValue(runtime);
    const registry = new ProjectRegistry(createLogger(), { temperature: 0.5 });

    await registry.register("/proj/p1");
    registry.setTemperature(undefined);

    expect(runtime.sessionRuntime.setTemperature).toHaveBeenCalledWith(undefined);
  });

  it("applies temperature to projects registered after setTemperature", async () => {
    createProjectMock.mockResolvedValue(createRuntime());
    const registry = new ProjectRegistry(createLogger());

    registry.setTemperature(0.9);
    await registry.register("/proj/p1");

    expect(createProjectMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ temperature: 0.9 }),
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
