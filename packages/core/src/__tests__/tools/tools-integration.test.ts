import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createAiFileAccessPolicy } from "../../access/ai-file-access.js";
import { createToolsForProject } from "../../tools/index.js";
import { FileWriteMutex } from "../../utils/file-write-mutex.js";
import { createTempProject, cleanupDir, writeFile, ensureDir } from "../helpers.js";

describe("createToolsForProject AI access policy forwarding", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await createTempProject();
  });

  afterEach(async () => {
    await cleanupDir(projectRoot);
  });

  it("forwards policy to read_file and denies blocked paths", async () => {
    await writeFile(projectRoot, "secrets/key.md", "secret");
    const policy = () => createAiFileAccessPolicy(projectRoot, ["secrets/key.md"]);
    const tools = createToolsForProject(projectRoot, new FileWriteMutex(), undefined, undefined, policy);

    const result = await tools.read_file.execute("tc", { path: "secrets/key.md" }, undefined as any);
    expect(result.content[0].text).toContain("Access denied by AI read settings: secrets/key.md");
  });

  it("forwards policy to list_files and omits denied entries", async () => {
    await ensureDir(projectRoot, "secrets");
    await writeFile(projectRoot, "public.md", "public");
    const policy = () => createAiFileAccessPolicy(projectRoot, ["secrets"]);
    const tools = createToolsForProject(projectRoot, new FileWriteMutex(), undefined, undefined, policy);

    const result = await tools.list_files.execute("tc", { path: "" }, undefined as any);
    expect(result.content[0].text).not.toContain("secrets");
    expect(result.content[0].text).toContain("public.md");
  });

  it("forwards policy to search_content and skips denied paths", async () => {
    await writeFile(projectRoot, "secrets/key.md", "needle secret");
    await writeFile(projectRoot, "public.md", "needle public");
    const policy = () => createAiFileAccessPolicy(projectRoot, ["secrets"]);
    const tools = createToolsForProject(projectRoot, new FileWriteMutex(), undefined, undefined, policy);

    const result = await tools.search_content.execute("tc", { query: "needle" }, undefined as any);
    expect(result.content[0].text).toContain("public.md");
    expect(result.content[0].text).not.toContain("secrets");
  });

  it("uses dynamic policy: second call after denylist change denies newly blocked path", async () => {
    await writeFile(projectRoot, "secrets/key.md", "secret");
    const mutableDenied: string[] = [];
    const policy = () => createAiFileAccessPolicy(projectRoot, mutableDenied);
    const tools = createToolsForProject(projectRoot, new FileWriteMutex(), undefined, undefined, policy);

    const first = await tools.read_file.execute("tc", { path: "secrets/key.md" }, undefined as any);
    expect(first.content[0].text).toBe("secret");

    mutableDenied.push("secrets/key.md");

    const second = await tools.read_file.execute("tc", { path: "secrets/key.md" }, undefined as any);
    expect(second.content[0].text).toContain("Access denied by AI read settings: secrets/key.md");
  });
});
