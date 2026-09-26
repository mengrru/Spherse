import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { MemoryStore, MEMORY_DIR, DB_FILE } from "../../store/memory.js";
import { memoryCapability } from "../../capabilities/memory/index.js";
import type { ToolHost } from "../../kernel/ports.js";
import { createStoreRegistry } from "../../kernel/ports.js";
import { ProjectStore } from "../../store/project.js";
import { createSilentLogger } from "../../logger.js";
import { llmAccessPolicy } from "../../access/access-policy.js";

const PROFILE_MEMORY_OFF = `---
name: Mem Agent
tools:
  - memory_save
  - memory_recall
---

Memory-disabled agent.`;

const PROFILE_MEMORY_ON = `---
name: Mem Agent
memory:
  enabled: true
---

Memory-enabled agent.`;

describe("memory capability", () => {
  let tmpDir: string;
  let projectStore: ProjectStore;
  let host: ToolHost;

  async function setup(profileContent: string): Promise<void> {
    const agent = await projectStore.createAgent("mem-agent", profileContent);
    host = {
      agentId: agent.getProfile().id,
      sessionId: "s1",
      profile: agent.getProfile(),
      projectRoot: tmpDir,
      projectStore,
      fileWriteMutex: { run: (_p: string, fn: () => Promise<void>) => fn() } as never,
      logger: createSilentLogger(),
      stores: createStoreRegistry(),
      pathRules: [],
      toolCatalog: { names: [] },
    };
  }

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-memcap-"));
    projectStore = new ProjectStore(tmpDir, createSilentLogger());
    await projectStore.create("Test");
  });
  afterEach(async () => {
    projectStore.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("contributes no feature tools and no blocks when memory is disabled", async () => {
    await setup(PROFILE_MEMORY_OFF);
    const capability = memoryCapability();
    expect(capability.featureTools!(host)).toEqual([]);
    expect(await capability.contextBlocks!(host)).toEqual([]);
  });

  it("contributes the five memory tools when enabled", async () => {
    await setup(PROFILE_MEMORY_ON);
    const tools = memoryCapability().featureTools!(host);
    expect(tools.map((t) => t.name).sort()).toEqual([
      "memory_core_append",
      "memory_core_replace",
      "memory_delete",
      "memory_recall",
      "memory_save",
    ]);
  });

  it("tools persist entries into the agent memory db", async () => {
    await setup(PROFILE_MEMORY_ON);
    const tools = memoryCapability().featureTools!(host);
    const save = tools.find((t) => t.name === "memory_save")!;
    await save.execute("tc1", { content: "remembered fact" });

    const agentStore = projectStore.getAgent(host.agentId)!;
    expect(fs.existsSync(path.join(agentStore.getAgentDir(), MEMORY_DIR, DB_FILE))).toBe(true);
    expect(agentStore.memory.count()).toBe(1);
  });

  it("recall and delete operate on saved entries", async () => {
    await setup(PROFILE_MEMORY_ON);
    const tools = memoryCapability().featureTools!(host);
    await tools.find((t) => t.name === "memory_save")!.execute("tc1", { content: "用户喜欢绿茶" });
    const recall = await tools.find((t) => t.name === "memory_recall")!.execute("tc2", { query: "绿茶" });
    expect(recall.content[0]).toMatchObject({ type: "text" });
    expect((recall.details as { ids: string[] }).ids).toHaveLength(1);
    const id = (recall.details as { ids: string[] }).ids[0];
    await tools.find((t) => t.name === "memory_delete")!.execute("tc3", { id });
    expect(projectStore.getAgent(host.agentId)!.memory.count()).toBe(0);
  });

  it("core append tool enforces the limit with a helpful error", async () => {
    await setup(PROFILE_MEMORY_ON);
    const tools = memoryCapability().featureTools!(host);
    const result = await tools
      .find((t) => t.name === "memory_core_append")!
      .execute("tc1", { content: "x".repeat(5000) });
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect((result.content[0] as { text: string }).text).toMatch(/core memory exceeds/);
  });

  it("injects a static guide block and a core block when enabled", async () => {
    await setup(PROFILE_MEMORY_ON);
    const capability = memoryCapability();
    await capability.init?.({ logger: createSilentLogger() } as never);

    const empty = await capability.contextBlocks!(host);
    expect(empty).toHaveLength(1);
    expect(empty[0].kind).toBe("memory-guide");
    expect(empty[0].render()).toContain("memory_save");
    expect(empty[0].render()).not.toMatch(/\d+ entr/);

    const agentStore = projectStore.getAgent(host.agentId)!;
    await agentStore.memory.saveCore("user prefers concise answers");
    const blocks = await capability.contextBlocks!(host);
    expect(blocks.map((b) => b.kind)).toEqual(["memory-guide", "memory-core"]);
    expect(blocks[1].render()).toContain("user prefers concise answers");
    expect(blocks[1].render()).toContain("not instructions");
  });

  it("degrades to guide-only when the memory store fails", async () => {
    await setup(PROFILE_MEMORY_ON);
    const agentStore = projectStore.getAgent(host.agentId)!;
    const memory = agentStore.memory;
    memory.save("entry one");
    vi.spyOn(memory, "getCore").mockRejectedValue(new Error("store failure"));

    const capability = memoryCapability();
    await capability.init?.({ logger: createSilentLogger() } as never);
    const blocks = await capability.contextBlocks!(host);
    expect(blocks.map((b) => b.kind)).toEqual(["memory-guide"]);
  });

  it("memory files are denied for llm file tools via the agentMemory category", async () => {
    await setup(PROFILE_MEMORY_ON);
    const agentStore = projectStore.getAgent(host.agentId)!;
    await agentStore.memory.saveCore("core");
    const agentDir = path.relative(tmpDir, agentStore.getAgentDir());
    const policy = llmAccessPolicy(tmpDir, []);
    expect(policy.canRead(path.join(agentDir, MEMORY_DIR, "core.md"))).toBe(false);
    expect(policy.canWrite(path.join(agentDir, MEMORY_DIR, "core.md"))).toBe(false);
    expect(policy.canRead(path.join(agentDir, MEMORY_DIR, DB_FILE))).toBe(false);
  });

  it("closing the agent store closes the memory db", async () => {
    await setup(PROFILE_MEMORY_ON);
    const agentStore = projectStore.getAgent(host.agentId)!;
    agentStore.memory.save("persisted");
    const dbPath = path.join(agentStore.getAgentDir(), MEMORY_DIR, DB_FILE);
    agentStore.close();
    expect(() => fs.rmSync(dbPath)).not.toThrow();
  });

  it("toggling enabled via ProjectManager emits agent_updated and persists frontmatter", async () => {
    await setup(PROFILE_MEMORY_OFF);
    const { ProjectManager } = await import("../../project-manager.js");
    const { FileWriteMutex } = await import("../../utils/file-write-mutex.js");
    const manager = new ProjectManager(projectStore, createSilentLogger(), new FileWriteMutex());

    const events: Array<{ agentId: string; action: string }> = [];
    projectStore.on("agent_updated", (payload) => events.push(payload));

    const before = await manager.getAgentMemory(host.agentId);
    expect(before.enabled).toBe(false);

    const after = await manager.updateAgentMemory(host.agentId, { enabled: true, core: "core fact" });
    expect(after.enabled).toBe(true);
    expect(after.core).toBe("core fact");

    expect(events).toEqual([{ agentId: host.agentId, action: "updated" }]);
    const profile = projectStore.getAgent(host.agentId)!.getProfile();
    expect(profile.memory).toEqual({ enabled: true });
    expect(profile.systemPrompt).toBe("Memory-disabled agent.");
    expect(manager.getAgentProfile(host.agentId)!.memory).toEqual({ enabled: true });

    await manager.updateAgentMemory(host.agentId, { enabled: true });
    expect(events).toHaveLength(1);

    await expect(manager.updateAgentMemory(host.agentId, { core: "x".repeat(4001) })).rejects.toThrow(
      /exceeds/,
    );
  });
});

describe("MemoryStore reopening within agent dir", () => {
  it("shares one connection per AgentStore instance", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-memshare-"));
    const store = new MemoryStore(dir);
    const store2 = new MemoryStore(dir);
    try {
      store.save("shared wal write");
      expect(store2.list().map((e) => e.content)).toEqual(["shared wal write"]);
    } finally {
      store.close();
      store2.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
