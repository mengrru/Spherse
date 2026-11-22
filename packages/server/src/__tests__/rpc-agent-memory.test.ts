import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProject, MemoryStore, type ProjectRuntime } from "@spherse/core";
import { agentMethods } from "@spherse/rpc/methods";
import { callMethod, createRpcHarness, type RpcHarness } from "@spherse/rpc/testing";
import { createSilentLoggerForTests } from "./test-logger.js";

describe("agent memory contract: real runtime through rpc methods", () => {
  let tmpDir: string;
  let runtime: ProjectRuntime;
  let harness: RpcHarness;
  let agentId: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spherse-memory-contract-"));
    runtime = await createProject(tmpDir, {
      projectName: "MemoryContract",
      logger: createSilentLoggerForTests(),
    });

    harness = createRpcHarness({
      methods: agentMethods,
      projectCtx: {
        projectManager: runtime.projectManager,
        runtime,
        sessionRuntime: runtime.sessionRuntime,
        triggerManager: runtime.triggerManager,
      },
    });

    const profile = await runtime.projectManager.createAgent(
      "mem-agent",
      "---\nname: Mem Agent\n---\n\nBody.",
    );
    agentId = profile.id;
  });

  afterAll(async () => {
    runtime.timerService.stop();
    await runtime.shutdown();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("agents.getMemoryConfig returns disabled with empty core by default", async () => {
    const frame = await callMethod(harness, "agents.getMemoryConfig", { projectId: "p1", id: agentId });
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect(frame.data).toEqual({ enabled: false, core: "", coreLimit: 4000 });
  });

  it("agents.updateMemoryConfig enables memory and saves core, persisting to profile and memory dir", async () => {
    const frame = await callMethod(harness, "agents.updateMemoryConfig", {
      projectId: "p1",
      id: agentId,
      enabled: true,
      core: "user prefers concise answers",
    });
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect(frame.data).toEqual({ enabled: true, core: "user prefers concise answers", coreLimit: 4000 });

    const profile = runtime.projectManager.getAgentProfile(agentId);
    expect(profile?.memory).toEqual({ enabled: true });
    const agentDir = path.dirname(profile!.filePath);
    expect(fs.readFileSync(path.join(agentDir, "memory", "core.md"), "utf-8")).toBe(
      "user prefers concise answers",
    );
  });

  it("agents.updateMemoryConfig over-limit core returns invalid params", async () => {
    const frame = await callMethod(harness, "agents.updateMemoryConfig", {
      projectId: "p1",
      id: agentId,
      core: "x".repeat(4001),
    });
    expect(frame).toMatchObject({ type: "result", ok: false, error: { code: -32602 } });
  });

  it("entries CRUD through the rpc methods", async () => {
    const profile = runtime.projectManager.getAgentProfile(agentId)!;
    const seeding = new MemoryStore(path.dirname(profile.filePath));
    const created = seeding.save("用户喜欢绿茶", ["偏好"]);
    seeding.close();

    const list = await callMethod(harness, "agents.listMemoryEntries", { projectId: "p1", id: agentId });
    expect(list).toMatchObject({ type: "result", ok: true });
    const listData = list.data as { entries: Array<{ content: string; tags: string[] }> };
    expect(listData.entries).toHaveLength(1);
    expect(listData.entries[0]).toMatchObject({ content: "用户喜欢绿茶", tags: ["偏好"] });

    const search = await callMethod(harness, "agents.listMemoryEntries", {
      projectId: "p1",
      id: agentId,
      q: "绿茶",
    });
    expect(search).toMatchObject({ type: "result", ok: true });
    expect((search.data as { entries: unknown[] }).entries).toHaveLength(1);

    const updated = await callMethod(harness, "agents.updateMemoryEntry", {
      projectId: "p1",
      id: agentId,
      entryId: created.id,
      content: "用户改喝红茶了",
      tags: ["偏好"],
    });
    expect(updated).toMatchObject({ type: "result", ok: true });
    expect(updated.data).toMatchObject({ id: created.id, content: "用户改喝红茶了" });

    const missing = await callMethod(harness, "agents.updateMemoryEntry", {
      projectId: "p1",
      id: agentId,
      entryId: "no-such-id",
      content: "x",
    });
    expect(missing).toMatchObject({ type: "result", ok: false, error: { code: 100 } });

    const removed = await callMethod(harness, "agents.deleteMemoryEntry", {
      projectId: "p1",
      id: agentId,
      entryId: created.id,
    });
    expect(removed).toMatchObject({ type: "result", ok: true });
    expect(removed.data).toEqual({ ok: true });

    const afterDelete = await callMethod(harness, "agents.listMemoryEntries", {
      projectId: "p1",
      id: agentId,
    });
    expect((afterDelete.data as { entries: unknown[] }).entries).toHaveLength(0);
  });

  it("agents.getMemoryConfig for unknown agent maps to app error 100", async () => {
    const frame = await callMethod(harness, "agents.getMemoryConfig", { projectId: "p1", id: "nope" });
    expect(frame).toMatchObject({ type: "result", ok: false, error: { code: 100 } });
  });
});
