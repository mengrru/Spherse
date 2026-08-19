import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { MemoryStore, filterEntries } from "../../capabilities/memory/store.js";
import { memoryCapability } from "../../capabilities/memory/index.js";
import type { ToolHost } from "../../kernel/ports.js";
import { createStoreRegistry } from "../../kernel/ports.js";
import { ProjectStore } from "../../store/project.js";
import { createSilentLogger } from "../../logger.js";
import { llmAccessPolicy } from "../../access/access-policy.js";
import { MEMORY_PATH_RULE } from "../../capabilities/memory/store.js";

const TEST_AGENT_PROFILE = `---
name: Mem Agent
tools:
  - memory_save
  - memory_recall
---

Memory-enabled agent.`;

describe("MemoryStore", () => {
  let dir: string;
  let store: MemoryStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-memory-"));
    store = new MemoryStore(dir, "agent-1");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("starts empty when file missing", async () => {
    expect(await store.list()).toEqual([]);
  });

  it("appends entries and recalls by content or tag", async () => {
    await store.save("The kingdom lies east", ["geography"]);
    await store.save("Hero fears heights", ["character"]);

    expect((await store.recall("kingdom")).map((e) => e.content)).toEqual(["The kingdom lies east"]);
    expect((await store.recall("character")).map((e) => e.content)).toEqual(["Hero fears heights"]);
    expect(await store.recall("nothing")).toEqual([]);
    expect((await store.list()).length).toBe(2);
  });

  it("filterEntries is pure and case-insensitive", () => {
    const entries = [
      { id: "1", agentId: "a", content: "Alpha Fact", createdAt: 1 },
      { id: "2", agentId: "a", content: "beta fact", tags: ["lore"], createdAt: 2 },
    ];
    expect(filterEntries(entries, "ALPHA").map((e) => e.id)).toEqual(["1"]);
    expect(filterEntries(entries, "lore").map((e) => e.id)).toEqual(["2"]);
    expect(filterEntries(entries, "")).toHaveLength(2);
    expect(entries).toHaveLength(2);
  });

  it("persists to disk as JSONL", async () => {
    await store.save("persisted", []);
    const text = fs.readFileSync(path.join(dir, "memory.jsonl"), "utf-8");
    expect(text.trim().split("\n")).toHaveLength(1);
    expect(text).toContain("persisted");
  });
});

describe("memory capability", () => {
  let tmpDir: string;
  let projectStore: ProjectStore;
  let host: ToolHost;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-memcap-"));
    projectStore = new ProjectStore(tmpDir, createSilentLogger());
    await projectStore.create("Test");
    const agent = await projectStore.createAgent("mem-agent", TEST_AGENT_PROFILE);
    host = {
      agentId: agent.getProfile().id,
      sessionId: "s1",
      projectRoot: tmpDir,
      projectStore,
      fileWriteMutex: { run: (_p: string, fn: () => Promise<void>) => fn() } as never,
      logger: createSilentLogger(),
      stores: createStoreRegistry(),
      pathRules: [MEMORY_PATH_RULE],
      toolCatalog: { names: [] },
    };
  });
  afterEach(async () => {
    projectStore.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("contributes memory tools that persist per-agent", async () => {
    const capability = memoryCapability();
    const tools = capability.tools!(host);
    expect(tools.map((t) => t.name).sort()).toEqual(["memory_recall", "memory_save"]);

    const save = tools.find((t) => t.name === "memory_save")!;
    await save.execute("tc1", { content: "remembered fact" });

    const agentDir = projectStore.getAgent(host.agentId)!.getAgentDir();
    expect(fs.existsSync(path.join(agentDir, "memory.jsonl"))).toBe(true);
  });

  it("injects a memory context block scoped to the agent's entries", async () => {
    const capability = memoryCapability();
    const tools = capability.tools!(host);
    const save = tools.find((t) => t.name === "memory_save")!;
    await save.execute("tc1", { content: "world fact one" });

    const blocks = await capability.contextBlocks!(host);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("memory");
    expect(blocks[0].render()).toContain("world fact one");
  });

  it("returns no block when the agent has no memories", async () => {
    const blocks = await memoryCapability().contextBlocks!(host);
    expect(blocks).toEqual([]);
  });

  it("isolation: another agent scope sees different stores", async () => {
    const capability = memoryCapability();
    const otherHost: ToolHost = { ...host, agentId: "nonexistent" };
    const tools = capability.tools!(otherHost);
    const result = await tools.find((t) => t.name === "memory_save")!.execute("tc", { content: "x" });
    expect(result.content[0]).toMatchObject({ type: "text" });
  });

  it("path rule grants llm read/write for the memory file", () => {
    const policy = llmAccessPolicy(tmpDir, [], [MEMORY_PATH_RULE]);
    const agentDir = projectStore.getAgent(host.agentId)!.getAgentDir();
    const rel = path.relative(tmpDir, path.join(agentDir, "memory.jsonl"));
    expect(policy.canRead(rel)).toBe(true);
    expect(policy.canWrite(rel)).toBe(true);
  });
});
