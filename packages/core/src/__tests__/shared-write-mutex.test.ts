import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createProject } from "../factory.js";
import { ProjectManager } from "../project-manager.js";
import { ProjectStore } from "../store/project.js";
import { SessionManager } from "../session/session-manager.js";
import { RunConfigHolder, createRuntimeDeps } from "../session/runtime.js";
import { builtinToolCapabilities } from "../capabilities/builtin.js";
import { createStoreRegistry } from "../kernel/ports.js";
import { FileWriteMutex } from "../utils/file-write-mutex.js";
import { createSilentLogger } from "../logger.js";

async function createTempProject(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "wb-mutex-test-"));
}

describe("shared FileWriteMutex wiring", () => {
  it("createProject wires one mutex across ProjectManager, SessionManager and stores", async () => {
    const root = await createTempProject();
    try {
      const runtime = await createProject(root);
      await runtime.projectManager.createAgent(undefined, "---\nname: tester\n---\nbody");

      const sessionDeps = runtime.sessionRuntime.getRuntimeDeps();
      const projectStore = runtime.projectManager.projectStore;
      const agentStore = projectStore.agents.values().next().value as unknown as {
        skills: { fileWriteMutex: FileWriteMutex };
      };

      expect(sessionDeps.fileWriteMutex).toBeInstanceOf(FileWriteMutex);
      expect((projectStore.skill as unknown as { fileWriteMutex: FileWriteMutex }).fileWriteMutex).toBe(
        sessionDeps.fileWriteMutex,
      );
      expect(agentStore.skills.fileWriteMutex).toBe(sessionDeps.fileWriteMutex);

      await runtime.shutdown();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("manual construction threads one explicit mutex through all holders", async () => {
    const mutex = new FileWriteMutex();
    const logger = createSilentLogger();
    const store = new ProjectStore("/tmp/never-opened", logger, mutex);
    new ProjectManager(store, logger, mutex);
    const sm = new SessionManager(
      createRuntimeDeps({
        projectStore: store,
        logger,
        fileWriteMutex: mutex,
        capabilities: builtinToolCapabilities(),
        stores: createStoreRegistry(logger),
        runConfig: new RunConfigHolder(),
      }),
    );

    expect(sm.getRuntimeDeps().fileWriteMutex).toBe(mutex);

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wb-mutex-manual-"));
    try {
      const opened = new ProjectStore(dir, logger, mutex);
      await opened.create("T");
      expect((opened.skill as unknown as { fileWriteMutex: FileWriteMutex }).fileWriteMutex).toBe(
        mutex,
      );
      opened.close();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
