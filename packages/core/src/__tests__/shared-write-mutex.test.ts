import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createProject } from "../factory.js";
import { ProjectManager } from "../project-manager.js";
import { ProjectStore } from "../store/project.js";
import { SessionManager } from "../session/session-manager.js";
import { createRuntimeDeps, RunConfigHolder } from "../session/runtime.js";
import { createStoreRegistry } from "../kernel/ports.js";
import { createSilentLogger } from "../logger.js";
import { FileWriteMutex } from "../utils/file-write-mutex.js";

async function createTempProject(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "wb-mutex-test-"));
}

describe("shared FileWriteMutex wiring", () => {
  it("createProject wires one mutex across ProjectManager, SessionManager and stores", async () => {
    const root = await createTempProject();
    try {
      const runtime = await createProject(root);
      await runtime.projectManager.createAgent(
        undefined,
        "---\nname: tester\n---\nprofile body",
      );

      const pmMutex = runtime.projectManager.getFileWriteMutex();
      const smCtx = runtime.sessionRuntime.getRuntimeDeps().fileWriteMutex;
      const projectStore = (runtime.projectManager as unknown as { projectStore: ProjectStore })
        .projectStore;
      const agentStore = projectStore.agents.values().next().value as unknown as {
        skills: { fileWriteMutex: FileWriteMutex };
      };

      expect(smCtx).toBe(pmMutex);
      expect((projectStore.skill as unknown as { fileWriteMutex: FileWriteMutex }).fileWriteMutex).toBe(
        pmMutex,
      );
      expect(agentStore.skills.fileWriteMutex).toBe(pmMutex);

      await runtime.shutdown();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("manual construction threads an explicit mutex through all holders", () => {
    const mutex = new FileWriteMutex();
    const store = new ProjectStore("/tmp/never-opened", undefined, mutex);
    const pm = new ProjectManager(store, undefined, mutex);
    const sm = new SessionManager(
      createRuntimeDeps({
        projectStore: store,
        logger: createSilentLogger(),
        fileWriteMutex: mutex,
        capabilities: [],
        stores: createStoreRegistry(),
        runConfig: new RunConfigHolder(),
      }),
    );

    expect(pm.getFileWriteMutex()).toBe(mutex);
    expect(sm.getRuntimeDeps().fileWriteMutex).toBe(mutex);
  });

  it("defaults remain independent when no mutex is provided", () => {
    const store = new ProjectStore("/tmp/never-opened");
    const pm = new ProjectManager(store);
    expect(pm.getFileWriteMutex()).toBeDefined();
    expect(pm.getFileWriteMutex()).not.toBe(
      (new ProjectManager(store) as unknown as { fileWriteMutex: FileWriteMutex }).fileWriteMutex,
    );
  });
});
