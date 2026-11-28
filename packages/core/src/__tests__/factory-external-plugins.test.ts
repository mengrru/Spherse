import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assembleProject } from "../factory.js";

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

function makeProject(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `factory-plugins-${name}-`));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, ".spherse", "plugins"), { recursive: true });
  return dir;
}

function writePlugin(projectRoot: string, name: string, files: Record<string, string>): void {
  const pluginDir = path.join(projectRoot, ".spherse", "plugins", name);
  fs.mkdirSync(pluginDir, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(pluginDir, file), content);
  }
}

describe("assembleProject external capability plugins", () => {
  it("loads an external plugin and mounts its tools", async () => {
    const projectRoot = makeProject("good");
    writePlugin(projectRoot, "good", {
      "manifest.json": JSON.stringify({ name: "good", version: "1.0.0", main: "index.mjs" }),
      "index.mjs": `export default {
        id: "external-good",
        init: async () => {},
        tools: () => [{ name: "external_tool" }],
      };\n`,
    });
    const runtime = await assembleProject(projectRoot, { projectName: "plugins-good" });
    try {
      expect(runtime.pluginLoadReport?.loaded).toContain("external-good");
      expect(runtime.pluginLoadReport?.skipped).toEqual([]);
      const capabilities = (runtime as unknown as { capabilities: ReadonlyArray<{ id: string; tools?: (host: unknown) => Array<{ name: string }> }> }).capabilities;
      const external = capabilities.find((c) => c.id === "external-good");
      expect(external).toBeDefined();
      const tools = external!.tools!({ projectRoot } as never);
      expect(tools.map((t) => t.name)).toContain("external_tool");
    } finally {
      await runtime.shutdown();
    }
  });

  it("assembles successfully with diagnostics when a plugin fails static precheck", async () => {
    const projectRoot = makeProject("badshape");
    writePlugin(projectRoot, "bad", {
      "manifest.json": JSON.stringify({ name: "bad", version: "1.0.0", main: "index.mjs" }),
      "index.mjs": `export default { id: "external-bad", turnHooks: 123 };\n`,
    });
    const runtime = await assembleProject(projectRoot, { projectName: "plugins-badshape" });
    try {
      expect(runtime.pluginLoadReport?.loaded).toEqual([]);
      expect(runtime.pluginLoadReport?.skipped[0]!.dir).toBe("bad");
      expect(runtime.pluginLoadReport?.skipped[0]!.stage).toBe("shape");
      const capabilities = (runtime as unknown as { capabilities: ReadonlyArray<{ id: string }> }).capabilities;
      expect(capabilities.find((c) => c.id === "external-bad")).toBeUndefined();
    } finally {
      await runtime.shutdown();
    }
  });

  it("rejects assembly with plugin context when an external plugin init fails", async () => {
    const projectRoot = makeProject("badinit");
    writePlugin(projectRoot, "badinit", {
      "manifest.json": JSON.stringify({ name: "badinit", version: "1.0.0", main: "index.mjs" }),
      "index.mjs": `export default {
        id: "external-badinit",
        init: async () => { throw new Error("boom"); },
      };\n`,
    });
    await expect(assembleProject(projectRoot, { projectName: "plugins-badinit" })).rejects.toThrow(
      'plugin "badinit" (capability "external-badinit") init failed',
    );
  });

  it("rejects assembly with the original cause preserved when an external plugin init fails", async () => {
    const projectRoot = makeProject("cause");
    writePlugin(projectRoot, "cause", {
      "manifest.json": JSON.stringify({ name: "cause", version: "1.0.0", main: "index.mjs" }),
      "index.mjs": `export default {
        id: "external-cause",
        init: async () => { throw new Error("boom"); },
      };\n`,
    });
    try {
      await assembleProject(projectRoot, { projectName: "plugins-cause" });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toContain('plugin "cause"');
      expect(((err as Error).cause as Error).message).toBe("boom");
    }
  });

  it("appends externals after an array-form user capability list and drops conflicting ids", async () => {
    const projectRoot = makeProject("userarray");
    writePlugin(projectRoot, "ok", {
      "manifest.json": JSON.stringify({ name: "ok", version: "1.0.0", main: "index.mjs" }),
      "index.mjs": `export default { id: "external-array", init: async () => {}, tools: () => [{ name: "array_tool" }] };\n`,
    });
    writePlugin(projectRoot, "shadow", {
      "manifest.json": JSON.stringify({ name: "shadow", version: "1.0.0", main: "index.mjs" }),
      "index.mjs": `export default { id: "user-cap", init: async () => {} };\n`,
    });
    const userCap: { id: string; init?: (ctx: unknown) => Promise<void> } = { id: "user-cap" };
    const runtime = await assembleProject(projectRoot, {
      projectName: "plugins-userarray",
      capabilities: [userCap as never],
    });
    try {
      const capabilities = (runtime as unknown as { capabilities: ReadonlyArray<{ id: string }> }).capabilities;
      expect(capabilities.map((c) => c.id)).toContain("external-array");
      expect(capabilities.filter((c) => c.id === "user-cap")).toHaveLength(1);
      expect(runtime.pluginLoadReport?.loaded).toEqual(["external-array"]);
    } finally {
      await runtime.shutdown();
    }
  });

  it("appends externals after a function-form user override resolves", async () => {
    const projectRoot = makeProject("userfn");
    writePlugin(projectRoot, "fn", {
      "manifest.json": JSON.stringify({ name: "fn", version: "1.0.0", main: "index.mjs" }),
      "index.mjs": `export default { id: "external-fn", init: async () => {} };\n`,
    });
    const runtime = await assembleProject(projectRoot, {
      projectName: "plugins-userfn",
      capabilities: (builtin) => builtin.slice(0, 3),
    });
    try {
      const capabilities = (runtime as unknown as { capabilities: ReadonlyArray<{ id: string }> }).capabilities;
      expect(capabilities.length).toBe(4);
      expect(capabilities[3]!.id).toBe("external-fn");
    } finally {
      await runtime.shutdown();
    }
  });

  it("drops external plugins whose id conflicts with a builtin capability", async () => {
    const projectRoot = makeProject("conflict");
    writePlugin(projectRoot, "conflict", {
      "manifest.json": JSON.stringify({ name: "conflict", version: "1.0.0", main: "index.mjs" }),
      "index.mjs": `export default {
        id: "fs",
        init: async () => {},
        tools: () => [{ name: "shadow_tool" }],
      };\n`,
    });
    const runtime = await assembleProject(projectRoot, { projectName: "plugins-conflict" });
    try {
      expect(runtime.pluginLoadReport?.loaded).toEqual([]);
      const capabilities = (runtime as unknown as { capabilities: ReadonlyArray<{ id: string; tools?: (host: unknown) => Array<{ name: string }> }> }).capabilities;
      const fsCapabilities = capabilities.filter((c) => c.id === "fs");
      expect(fsCapabilities).toHaveLength(1);
      expect(runtime.pluginLoadReport?.skipped[0]!.stage).toBe("id-conflict");
      expect(runtime.pluginLoadReport?.skipped[0]!.dir).toBe("fs");
    } finally {
      await runtime.shutdown();
    }
  });
});
