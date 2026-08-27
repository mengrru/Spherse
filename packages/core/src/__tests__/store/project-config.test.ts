import fs from "node:fs/promises";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createSilentLogger } from "../../logger.js";
import { ProjectConfigStore } from "../../store/project-config.js";
import type { ProjectConfig } from "../../types.js";
import { createTempProject, cleanupDir, ensureDir, readFile, pathExists } from "../helpers.js";

describe("ProjectConfigStore", () => {
  let tmpRoot: string;
  let configPath: string;
  let store: ProjectConfigStore;

  beforeEach(async () => {
    tmpRoot = await createTempProject();
    await ensureDir(tmpRoot, ".spherse");
    configPath = path.join(tmpRoot, ".spherse", "project.yaml");
    store = new ProjectConfigStore(configPath, createSilentLogger());
  });

  afterEach(async () => {
    await cleanupDir(tmpRoot);
  });

  const VALID_CONFIG: ProjectConfig = {
    id: "test-id-01",
    name: "TestProject",
    created: Date.now(),
  };

  it("writes and reads config", async () => {
    await store.write(VALID_CONFIG);
    expect(pathExists(tmpRoot, ".spherse/project.yaml")).toBe(true);

    const store2 = new ProjectConfigStore(configPath, createSilentLogger());
    const config = await store2.read();
    expect(config.name).toBe("TestProject");
    expect(config.id).toBe("test-id-01");
  });

  it("get() throws before read/write", () => {
    expect(() => store.get()).toThrow("Project config not loaded");
  });

  it("get() returns config after read", async () => {
    await store.write(VALID_CONFIG);
    const store2 = new ProjectConfigStore(configPath, createSilentLogger());
    await store2.read();
    expect(store2.get().name).toBe("TestProject");
  });

  it("getProjectId returns config id", async () => {
    await store.write(VALID_CONFIG);
    expect(store.getProjectId()).toBe("test-id-01");
  });

  it("regenerateProjectId writes new id", async () => {
    await store.write(VALID_CONFIG);
    await store.regenerateProjectId("new-id-99");
    expect(store.getProjectId()).toBe("new-id-99");

    const raw = await readFile(tmpRoot, ".spherse/project.yaml");
    expect(raw).toContain("new-id-99");
  });

  it("generates id for legacy project without id", async () => {
    const legacyConfig = { ...VALID_CONFIG };
    delete (legacyConfig as any).id;
    await fs.writeFile(configPath,
      `name: LegacyProject\ncreated: 0\ndefaultModel: gemini-2.5-pro\n`,
      "utf-8",
    );

    const store2 = new ProjectConfigStore(configPath, createSilentLogger());
    const config = await store2.read();
    expect(config.id).toBeDefined();
    expect(config.id).toHaveLength(8);

    const raw = await readFile(tmpRoot, ".spherse/project.yaml");
    expect(raw).toContain(`id: ${config.id}`);
  });

  it("reads legacy project.yaml containing a defaultModel field without error", async () => {
    await fs.writeFile(
      configPath,
      `id: legacy-id-02\nname: LegacyProject\ncreated: 0\ndefaultModel: gemini-2.5-pro\n`,
      "utf-8",
    );

    const store2 = new ProjectConfigStore(configPath, createSilentLogger());
    const config = await store2.read();
    expect(config.name).toBe("LegacyProject");
    expect(config.id).toBe("legacy-id-02");
  });

  it("throws when reading non-existent file", async () => {
    await expect(store.read()).rejects.toThrow("project.yaml not found");
  });

  it("throws ProjectConfigNotFoundError when file is missing", async () => {
    await expect(store.read()).rejects.toMatchObject({ name: "ProjectConfigNotFoundError" });
  });

  it("throws ProjectConfigParseError on invalid YAML", async () => {
    await fs.writeFile(configPath, "id: [unclosed", "utf-8");
    await expect(store.read()).rejects.toMatchObject({ name: "ProjectConfigParseError" });
  });

  it("throws ProjectConfigParseError on empty file", async () => {
    await fs.writeFile(configPath, "", "utf-8");
    await expect(store.read()).rejects.toMatchObject({ name: "ProjectConfigParseError" });
  });

  it("throws ProjectConfigParseError on YAML array", async () => {
    await fs.writeFile(configPath, "- a\n- b\n", "utf-8");
    await expect(store.read()).rejects.toMatchObject({ name: "ProjectConfigParseError" });
  });

  describe("AI access settings", () => {
    beforeEach(async () => {
      await store.write(VALID_CONFIG);
    });

    it("has empty denied paths by default", () => {
      expect(store.getAiAccessSettings()).toEqual({ deniedPaths: [] });
    });

    it("updates and persists denied paths", async () => {
      const result = await store.updateAiAccessSettings(["lore/private", "notes/secret.md"]);
      expect(result.deniedPaths).toEqual(["lore/private", "notes/secret.md"]);
      expect(store.getAiAccessSettings().deniedPaths).toEqual(["lore/private", "notes/secret.md"]);

      const raw = await readFile(tmpRoot, ".spherse/project.yaml");
      expect(raw).toContain("deniedPaths:");
    });

    it("normalizes and deduplicates paths", async () => {
      const result = await store.updateAiAccessSettings([
        " lore/private ",
        "lore/private",
        "notes\\secret.md",
      ]);
      expect(result.deniedPaths).toEqual(["lore/private", "notes/secret.md"]);
    });

    it("rejects reserved paths", async () => {
      await expect(store.updateAiAccessSettings(["AGENTS.md"])).rejects.toThrow(
        "Invalid AI denied path: AGENTS.md",
      );
    });

    it("rejects path traversal", async () => {
      await expect(store.updateAiAccessSettings(["../secret.md"])).rejects.toThrow(
        "Invalid AI denied path: ../secret.md",
      );
    });
  });

  describe("Welcome page settings", () => {
    beforeEach(async () => {
      await store.write(VALID_CONFIG);
    });

    it("has null welcome page by default", () => {
      expect(store.getWelcomePageSettings()).toEqual({ path: null });
    });

    it("sets and persists welcome page", async () => {
      const result = await store.updateWelcomePageSettings("welcome.html");
      expect(result).toEqual({ path: "welcome.html" });
      expect(store.getWelcomePageSettings()).toEqual({ path: "welcome.html" });
    });

    it("clears welcome page with null", async () => {
      await store.updateWelcomePageSettings("welcome.html");
      const result = await store.updateWelcomePageSettings(null);
      expect(result).toEqual({ path: null });
    });

    it("rejects invalid paths", async () => {
      for (const invalidPath of ["", ".", "../evil.html", "/absolute.html", ".spherse/x.html"]) {
        await expect(store.updateWelcomePageSettings(invalidPath)).rejects.toThrow(
          `Invalid welcome page path: ${invalidPath}`,
        );
      }
    });

    it("rejects unsupported extensions", async () => {
      await expect(store.updateWelcomePageSettings("readme.md")).rejects.toThrow(
        "Invalid welcome page path: readme.md",
      );
    });
  });
});
