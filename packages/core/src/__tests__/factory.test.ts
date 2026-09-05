import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createProject } from "../factory.js";
import { createSilentLogger } from "../logger.js";
import { createTempProject, cleanupDir, writeFile, readFile, pathExists } from "./helpers.js";

async function openAndClose(projectRoot: string): Promise<void> {
  const runtime = await createProject(projectRoot, { projectName: "FactoryTest", logger: createSilentLogger() });
  runtime.timerService.stop();
  await runtime.shutdown();
}

describe("assembleProject — open failure safety", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await createTempProject();
  });

  afterEach(async () => {
    await cleanupDir(projectRoot);
  });

  it("initializes a brand-new project", async () => {
    await openAndClose(projectRoot);
    expect(pathExists(projectRoot, ".spherse/project.yaml")).toBe(true);
    expect(pathExists(projectRoot, ".spherse/agents")).toBe(true);
    expect(pathExists(projectRoot, "AGENTS.md")).toBe(true);
    expect(pathExists(projectRoot, "CHANGELOG.md")).toBe(true);
  });

  it("rejects on corrupt project.yaml and leaves existing files untouched", async () => {
    await writeFile(projectRoot, ".spherse/project.yaml", "id: [unclosed");
    await writeFile(projectRoot, "AGENTS.md", "# user index");
    await writeFile(projectRoot, "CHANGELOG.md", "- history");

    await expect(openAndClose(projectRoot)).rejects.toThrow(/not valid YAML/);

    expect(await readFile(projectRoot, ".spherse/project.yaml")).toBe("id: [unclosed");
    expect(await readFile(projectRoot, "AGENTS.md")).toBe("# user index");
    expect(await readFile(projectRoot, "CHANGELOG.md")).toBe("- history");
  });

  it("rejects on empty project.yaml and does not rewrite it", async () => {
    await writeFile(projectRoot, ".spherse/project.yaml", "");

    await expect(openAndClose(projectRoot)).rejects.toThrow(/empty or invalid/);

    expect(await readFile(projectRoot, ".spherse/project.yaml")).toBe("");
    expect(pathExists(projectRoot, "AGENTS.md")).toBe(false);
  });

  it("preserves existing AGENTS.md and CHANGELOG.md when initializing a new project", async () => {
    await writeFile(projectRoot, "AGENTS.md", "# existing repo guide");
    await writeFile(projectRoot, "CHANGELOG.md", "# my changelog\n");

    await openAndClose(projectRoot);

    expect(await readFile(projectRoot, "AGENTS.md")).toBe("# existing repo guide");
    expect(await readFile(projectRoot, "CHANGELOG.md")).toBe("# my changelog\n");
  });
});
