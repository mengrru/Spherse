import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createToolsForProject } from "../../tools/index.js";
import { ToolContext } from "../../tools/tool-context.js";
import { ProjectStore } from "../../store/project.js";
import { FileWriteMutex } from "../../utils/file-write-mutex.js";
import { createSilentLogger } from "../../logger.js";
import { createTempProject, cleanupDir, writeFile, ensureDir } from "../helpers.js";

describe("createToolsForProject AI access policy forwarding", () => {
  let projectRoot: string;
  let projectStore: ProjectStore;

  beforeEach(async () => {
    projectRoot = await createTempProject();
    projectStore = new ProjectStore(projectRoot, createSilentLogger());
    await projectStore.create("TestProject", "gemini-2.5-pro");
  });

  afterEach(async () => {
    projectStore.close();
    await cleanupDir(projectRoot);
  });

  function makeTools() {
    const ctx = new ToolContext(projectStore, new FileWriteMutex());
    return createToolsForProject(ctx);
  }

  it("forwards policy to read_file and denies blocked paths", async () => {
    await writeFile(projectRoot, "secrets/key.md", "secret");
    await projectStore.config.updateAiAccessSettings(["secrets/key.md"]);
    const tools = makeTools();

    const result = await tools.read_file.execute("tc", { path: "secrets/key.md" }, undefined as any);
    expect(result.content[0].text).toContain("Access denied");
  });

  it("forwards policy to list_files and omits denied entries", async () => {
    await ensureDir(projectRoot, "secrets");
    await writeFile(projectRoot, "public.md", "public");
    await projectStore.config.updateAiAccessSettings(["secrets"]);
    const tools = makeTools();

    const result = await tools.list_files.execute("tc", { path: "" }, undefined as any);
    expect(result.content[0].text).not.toContain("secrets");
    expect(result.content[0].text).toContain("public.md");
  });

  it("forwards policy to search_content and skips denied paths", async () => {
    await writeFile(projectRoot, "secrets/key.md", "needle secret");
    await writeFile(projectRoot, "public.md", "needle public");
    await projectStore.config.updateAiAccessSettings(["secrets"]);
    const tools = makeTools();

    const result = await tools.search_content.execute("tc", { query: "needle" }, undefined as any);
    expect(result.content[0].text).toContain("public.md");
    expect(result.content[0].text).not.toContain("secrets");
  });

  it("uses dynamic policy: second call after denylist change denies newly blocked path", async () => {
    await writeFile(projectRoot, "secrets/key.md", "secret");
    const tools = makeTools();

    const first = await tools.read_file.execute("tc", { path: "secrets/key.md" }, undefined as any);
    expect(first.content[0].text).toBe("secret");

    await projectStore.config.updateAiAccessSettings(["secrets/key.md"]);

    const second = await tools.read_file.execute("tc", { path: "secrets/key.md" }, undefined as any);
    expect(second.content[0].text).toContain("Access denied");
  });
});
