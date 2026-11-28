import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NodeFsPort } from "../store/node-fs-port.js";
import { createSilentLogger } from "../logger.js";
import { loadExternalCapabilities, PLUGINS_REL_DIR } from "../plugins/loader.js";

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

function makeProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plugins-loader-"));
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

const GOOD_PLUGIN_MAIN = `export default {
  id: "good-plugin",
  init: async () => {},
  tools: () => [{ name: "plugin_tool" }],
};
`;

describe("loadExternalCapabilities", () => {
  it("returns empty when the plugins directory does not exist", async () => {
    const projectRoot = makeProject();
    fs.rmSync(path.join(projectRoot, ".spherse", "plugins"), { recursive: true });
    const fsPort = new NodeFsPort(projectRoot);
    const result = await loadExternalCapabilities(projectRoot, fsPort, createSilentLogger());
    expect(result.capabilities).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("loads a well-formed plugin and wraps init context", async () => {
    const projectRoot = makeProject();
    writePlugin(projectRoot, "good", {
      "manifest.json": JSON.stringify({ name: "good", version: "1.0.0", main: "index.mjs" }),
      "index.mjs": GOOD_PLUGIN_MAIN,
    });
    const fsPort = new NodeFsPort(projectRoot);
    const result = await loadExternalCapabilities(projectRoot, fsPort, createSilentLogger());
    expect(result.skipped).toEqual([]);
    expect(result.capabilities).toHaveLength(1);
    expect(result.capabilities[0]!.id).toBe("good-plugin");
    const tools = result.capabilities[0]!.tools!({} as never) as Array<{ name: string }>;
    expect(tools.map((t) => t.name)).toContain("plugin_tool");
    await expect(result.capabilities[0]!.init!({} as never)).resolves.toBeUndefined();
  });

  it("skips plugins with an invalid manifest", async () => {
    const projectRoot = makeProject();
    writePlugin(projectRoot, "bad-manifest", {
      "manifest.json": JSON.stringify({ version: "1.0.0" }),
      "index.mjs": GOOD_PLUGIN_MAIN,
    });
    writePlugin(projectRoot, "bad-json", {
      "manifest.json": "{ not json",
      "index.mjs": GOOD_PLUGIN_MAIN,
    });
    const fsPort = new NodeFsPort(projectRoot);
    const result = await loadExternalCapabilities(projectRoot, fsPort, createSilentLogger());
    expect(result.capabilities).toEqual([]);
    expect(result.skipped.map((s) => s.dir).sort()).toEqual(["bad-json", "bad-manifest"]);
    expect(result.skipped.every((s) => s.stage === "manifest")).toBe(true);
  });

  it("skips plugins whose main escapes the plugin directory", async () => {
    const projectRoot = makeProject();
    fs.writeFileSync(path.join(projectRoot, "outside.mjs"), GOOD_PLUGIN_MAIN);
    writePlugin(projectRoot, "escape", {
      "manifest.json": JSON.stringify({ name: "escape", version: "1.0.0", main: "../../outside.mjs" }),
      "index.mjs": GOOD_PLUGIN_MAIN,
    });
    const fsPort = new NodeFsPort(projectRoot);
    const result = await loadExternalCapabilities(projectRoot, fsPort, createSilentLogger());
    expect(result.capabilities).toEqual([]);
    expect(result.skipped[0]!.stage).toBe("path-escape");
  });

  it("skips plugins whose main cannot be imported", async () => {
    const projectRoot = makeProject();
    writePlugin(projectRoot, "missing-main", {
      "manifest.json": JSON.stringify({ name: "missing", version: "1.0.0", main: "index.mjs" }),
    });
    const fsPort = new NodeFsPort(projectRoot);
    const result = await loadExternalCapabilities(projectRoot, fsPort, createSilentLogger());
    expect(result.capabilities).toEqual([]);
    expect(result.skipped[0]!.stage).toBe("import");
  });

  it("skips plugins whose default export does not match the Capability shape", async () => {
    const projectRoot = makeProject();
    writePlugin(projectRoot, "no-id", {
      "manifest.json": JSON.stringify({ name: "noid", version: "1.0.0", main: "index.mjs" }),
      "index.mjs": `export default { init: async () => {} };\n`,
    });
    writePlugin(projectRoot, "bad-turn-hooks", {
      "manifest.json": JSON.stringify({ name: "badhooks", version: "1.0.0", main: "index.mjs" }),
      "index.mjs": `export default { id: "bad-hooks", turnHooks: 123 };\n`,
    });
    writePlugin(projectRoot, "bad-decorators", {
      "manifest.json": JSON.stringify({ name: "baddecorators", version: "1.0.0", main: "index.mjs" }),
      "index.mjs": `export default { id: "bad-decorators", streamDecorators: "nope" };\n`,
    });
    const fsPort = new NodeFsPort(projectRoot);
    const result = await loadExternalCapabilities(projectRoot, fsPort, createSilentLogger());
    expect(result.capabilities).toEqual([]);
    expect(result.skipped).toHaveLength(3);
    expect(result.skipped.every((s) => s.stage === "shape")).toBe(true);
  });

  it("skips duplicate capability ids across plugins", async () => {
    const projectRoot = makeProject();
    writePlugin(projectRoot, "first", {
      "manifest.json": JSON.stringify({ name: "first", version: "1.0.0", main: "index.mjs" }),
      "index.mjs": `export default { id: "dup-plugin", init: async () => {} };\n`,
    });
    writePlugin(projectRoot, "second", {
      "manifest.json": JSON.stringify({ name: "second", version: "1.0.0", main: "index.mjs" }),
      "index.mjs": `export default { id: "dup-plugin", init: async () => {} };\n`,
    });
    const fsPort = new NodeFsPort(projectRoot);
    const result = await loadExternalCapabilities(projectRoot, fsPort, createSilentLogger());
    expect(result.capabilities).toHaveLength(1);
    expect(result.capabilities[0]!.id).toBe("dup-plugin");
    expect(result.skipped[0]!.stage).toBe("id-conflict");
  });

  it("ignores files that are not directories", async () => {
    const projectRoot = makeProject();
    fs.writeFileSync(path.join(projectRoot, ".spherse", "plugins", "stray.txt"), "x");
    const fsPort = new NodeFsPort(projectRoot);
    const result = await loadExternalCapabilities(projectRoot, fsPort, createSilentLogger(), PLUGINS_REL_DIR);
    expect(result.capabilities).toEqual([]);
    expect(result.skipped).toEqual([]);
  });
});
