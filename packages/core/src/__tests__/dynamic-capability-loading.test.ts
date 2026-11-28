import { describe, it, expect, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assembleProject } from "../factory.js";
import { buildPromptAndTools, streamDecoratorsFor } from "../session/agent-assembly.js";
import { RunConfigHolder, createRuntimeDeps, type RuntimeDeps } from "../session/runtime.js";
import type { Capability } from "../kernel/capability.js";
import { createSilentLogger } from "../logger.js";
import { createStoreRegistry } from "../kernel/ports.js";
import { FileWriteMutex } from "../utils/file-write-mutex.js";
import { ProjectStore } from "../store/project.js";

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

function makeProject(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dynamic-caps-${name}-`));
  dirs.push(dir);
  return dir;
}

describe("createRuntimeDeps live source", () => {
  it("deps.capabilities and attachmentProcessors follow the source; turnHooks fold at call time", async () => {
    const lateBeforeTurn = vi.fn();
    const before: Capability[] = [{ id: "base", eventMiddlewares: [vi.fn() as never] }];
    const after: Capability[] = [
      ...before,
      {
        id: "late",
        attachmentProcessors: [vi.fn() as never],
        turnHooks: () => ({ beforeTurn: lateBeforeTurn as never }),
      },
    ];
    let source = before;
    const projectStore = { getRootPath: () => "/proj" } as unknown as ProjectStore;
    const deps = createRuntimeDeps({
      projectStore,
      logger: createSilentLogger(),
      fileWriteMutex: new FileWriteMutex(),
      capabilities: () => source,
      stores: createStoreRegistry(),
      runConfig: new RunConfigHolder(),
    });
    expect(deps.capabilities.map((c) => c.id)).toEqual(["base"]);
    expect(deps.attachmentProcessors).toHaveLength(0);
    const earlyHooks = deps.createTurnHooks?.("a", "s1");
    await earlyHooks?.beforeTurn?.({} as never);
    expect(lateBeforeTurn).not.toHaveBeenCalled();
    source = after;
    expect(deps.capabilities.map((c) => c.id)).toEqual(["base", "late"]);
    expect(deps.attachmentProcessors).toHaveLength(1);
    const lateHooks = deps.createTurnHooks?.("a", "s1");
    await lateHooks?.beforeTurn?.({} as never);
    expect(lateBeforeTurn).toHaveBeenCalledTimes(1);
    await earlyHooks?.beforeTurn?.({} as never);
    expect(lateBeforeTurn).toHaveBeenCalledTimes(1);
  });
});

describe("contributions through assembly", () => {
  it("assembleProject publishes capabilities only after serial init completes", async () => {
    const projectRoot = makeProject("publish");
    const runtime = await assembleProject(projectRoot, { projectName: "publish" });
    try {
      const ids = runtime.capabilities.map((c) => c.id);
      expect(ids).toContain("fs");
      expect(ids).toContain("interaction");
      expect(ids.length).toBeGreaterThan(10);
    } finally {
      await runtime.shutdown();
    }
  });
});

describe("ProjectRuntime dynamic capability loading", () => {
  it("loadCapability publishes after init: broadcast and tool folding see it immediately", async () => {
    const projectRoot = makeProject("load");
    const runtime = await assembleProject(projectRoot, { projectName: "load" });
    try {
      const onConfigChanged = vi.fn(async () => {});
      const dynamic: Capability = {
        id: "dynamic-cap",
        init: vi.fn(async () => {}),
        tools: () => [{ name: "dynamic_tool" } as never],
        onAgentConfigChanged: onConfigChanged,
      };
      expect(runtime.capabilities.map((c) => c.id)).not.toContain("dynamic-cap");
      await runtime.loadCapability(dynamic);
      expect(runtime.capabilities.map((c) => c.id)).toContain("dynamic-cap");
      const loaded = runtime.capabilities.find((c) => c.id === "dynamic-cap")!;
      const tools = loaded.tools!({} as never) as Array<{ name: string }>;
      expect(tools.map((t) => t.name)).toContain("dynamic_tool");
      await runtime.dispatchAgentConfigChanged("some-agent", "mcp");
      expect(onConfigChanged).toHaveBeenCalledWith("some-agent", "mcp");
    } finally {
      await runtime.shutdown();
    }
  });

  it("loadCapability init failure rejects and never publishes; later loads still work", async () => {
    const projectRoot = makeProject("fail");
    const runtime = await assembleProject(projectRoot, { projectName: "fail" });
    try {
      const boom: Capability = {
        id: "boom-cap",
        init: async () => {
          throw new Error("boom init");
        },
      };
      await expect(runtime.loadCapability(boom)).rejects.toThrow("boom init");
      expect(runtime.capabilities.map((c) => c.id)).not.toContain("boom-cap");
      const ok: Capability = { id: "after-boom", init: async () => {} };
      await runtime.loadCapability(ok);
      expect(runtime.capabilities.map((c) => c.id)).toContain("after-boom");
    } finally {
      await runtime.shutdown();
    }
  });

  it("loadCapability rejects duplicate ids", async () => {
    const projectRoot = makeProject("dup");
    const runtime = await assembleProject(projectRoot, { projectName: "dup" });
    try {
      const first: Capability = { id: "solo", init: async () => {} };
      await runtime.loadCapability(first);
      await expect(runtime.loadCapability({ id: "solo" })).rejects.toThrow("already loaded");
      const builtinShadow: Capability = { id: "fs", init: async () => {} };
      await expect(runtime.loadCapability(builtinShadow)).rejects.toThrow("already loaded");
    } finally {
      await runtime.shutdown();
    }
  });

  it("unloadCapability pulls immediately and runs shutdown; broadcast loses the target", async () => {
    const projectRoot = makeProject("unload");
    const runtime = await assembleProject(projectRoot, { projectName: "unload" });
    try {
      const shutdown = vi.fn(async () => {});
      const onConfigChanged = vi.fn(async () => {});
      const dynamic: Capability = {
        id: "to-unload",
        init: async () => {},
        onAgentConfigChanged: onConfigChanged,
        shutdown,
      };
      await runtime.loadCapability(dynamic);
      await runtime.dispatchAgentConfigChanged("agent", "mcp");
      expect(onConfigChanged).toHaveBeenCalledTimes(1);
      expect(await runtime.unloadCapability("to-unload")).toBe(true);
      expect(shutdown).toHaveBeenCalledTimes(1);
      expect(runtime.capabilities.map((c) => c.id)).not.toContain("to-unload");
      await runtime.dispatchAgentConfigChanged("agent", "mcp");
      expect(onConfigChanged).toHaveBeenCalledTimes(1);
      expect(await runtime.unloadCapability("to-unload")).toBe(false);
    } finally {
      await runtime.shutdown();
    }
  });

  it("runner-folded contributions from earlier loads persist after unload of a different id", async () => {
    const projectRoot = makeProject("mixed");
    const runtime = await assembleProject(projectRoot, { projectName: "mixed" });
    try {
      const survivor: Capability = { id: "survivor", init: async () => {} };
      const gone: Capability = { id: "gone", init: async () => {} };
      await runtime.loadCapability(survivor);
      await runtime.loadCapability(gone);
      await runtime.unloadCapability("gone");
      expect(runtime.capabilities.map((c) => c.id)).toContain("survivor");
      expect(runtime.capabilities.map((c) => c.id)).not.toContain("gone");
    } finally {
      await runtime.shutdown();
    }
  });
});

describe("effectiveness matrix through real folding paths", () => {
  it("tools fold at next buildPromptAndTools after loadCapability", async () => {
    const projectRoot = makeProject("folding");
    const runtime = await assembleProject(projectRoot, { projectName: "folding" });
    try {
      const deps = runtime.sessionRuntime.getRuntimeDeps();
      const dynamic: Capability = {
        id: "folding-cap",
        init: async () => {},
        tools: () => [{ name: "folding_tool" } as never],
      };
      const profile = { id: "agent-a", name: "A", slug: "a", tools: ["folding_tool"], context: [], systemPrompt: "" } as never;
      await runtime.loadCapability(dynamic);
      const result = await buildPromptAndTools(deps, profile, "s1", undefined, undefined);
      expect(result.tools.map((t) => t.name)).toContain("folding_tool");
      expect(result.toolCatalog.names).toContain("folding_tool");
      await runtime.unloadCapability("folding-cap");
      const after = await buildPromptAndTools(deps, profile, "s1", undefined, undefined);
      expect(after.tools.map((t) => t.name)).not.toContain("folding_tool");
    } finally {
      await runtime.shutdown();
    }
  });

  it("streamDecorators visible at next evaluation after load, gone after unload", async () => {
    const projectRoot = makeProject("decorators");
    const runtime = await assembleProject(projectRoot, { projectName: "decorators" });
    try {
      const decorator = (() => ((base: unknown) => base)) as never;
      const dynamic: Capability = {
        id: "decorator-cap",
        init: async () => {},
        streamDecorators: [decorator as never],
      };
      const view = { profile: { tools: [] } as never } as never;
      const deps: RuntimeDeps = runtime.sessionRuntime.getRuntimeDeps();
      const before = streamDecoratorsFor(deps.capabilities, view).length;
      await runtime.loadCapability(dynamic);
      expect(streamDecoratorsFor(deps.capabilities, view).length).toBe(before + 1);
      await runtime.unloadCapability("decorator-cap");
      expect(streamDecoratorsFor(deps.capabilities, view).length).toBe(before);
    } finally {
      await runtime.shutdown();
    }
  });

  it("unloading an assembly-time capability id is refused", async () => {
    const projectRoot = makeProject("refuse");
    const runtime = await assembleProject(projectRoot, { projectName: "refuse" });
    try {
      expect(await runtime.unloadCapability("trigger")).toBe(false);
      expect(runtime.capabilities.map((c) => c.id)).toContain("trigger");
    } finally {
      await runtime.shutdown();
    }
  });

  it("concurrent loads of the same id: exactly one succeeds", async () => {
    const projectRoot = makeProject("concurrent");
    const runtime = await assembleProject(projectRoot, { projectName: "concurrent" });
    try {
      const mk = (): Capability => ({ id: "race-cap", init: async () => {} });
      const results = await Promise.allSettled([runtime.loadCapability(mk()), runtime.loadCapability(mk())]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    } finally {
      await runtime.shutdown();
    }
  });
});
