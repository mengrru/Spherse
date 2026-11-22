import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProject, type AgentChangePayload, type ProjectRuntime } from "@spherse/core";
import { agentMethods } from "@spherse/rpc/methods";
import { callMethod, createRpcHarness, type RpcHarness } from "@spherse/rpc/testing";
import { createSilentLoggerForTests } from "./test-logger.js";

describe("agent mcp facade contract: real ProjectRuntime through rpc methods", () => {
  let tmpDir: string;
  let runtime: ProjectRuntime;
  let harness: RpcHarness;
  let agentId: string;
  let agentDir: string;
  let changes: AgentChangePayload[];

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spherse-mcp-contract-"));
    runtime = await createProject(tmpDir, {
      projectName: "Contract",
      logger: createSilentLoggerForTests(),
    });
    const created = await runtime.projectManager.createAgent(
      "contract-agent",
      "---\nname: Contract Agent\n---\nbody",
    );
    agentId = created.id;
    agentDir = path.join(tmpDir, ".spherse/agents", created.slug);
    runtime.timerService.stop();

    changes = [];
    runtime.projectManager.projectStore.on("agent_updated", (payload: AgentChangePayload) => {
      changes.push(payload);
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
  });

  afterAll(async () => {
    await runtime.shutdown();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("agents.updateMcp persists through the runtime facade and broadcasts agent_updated", async () => {
    const frame = await callMethod(harness, "agents.updateMcp", {
      projectId: "p1",
      id: agentId,
      servers: [{ id: "s1", name: "fs", enabled: true, transport: "stdio", command: "npx" }],
    });
    expect(frame).toMatchObject({ type: "result", ok: true });
    const data = frame.data as { servers: Array<{ id: string }> };
    expect(data.servers).toHaveLength(1);

    const stored = JSON.parse(
      fs.readFileSync(path.join(agentDir, "mcp.json"), "utf-8"),
    ) as { servers: Array<{ id: string }> };
    expect(stored.servers[0].id).toBe("s1");

    expect(changes).toContainEqual({ agentId, action: "updated" });
  });

  it("agents.getMcp reads back the saved config", async () => {
    const frame = await callMethod(harness, "agents.getMcp", { projectId: "p1", id: agentId });
    expect(frame).toMatchObject({ type: "result", ok: true });
    const data = frame.data as { servers: Array<{ id: string; transport: string }> };
    expect(data.servers[0].id).toBe("s1");
    expect(data.servers[0].transport).toBe("stdio");
  });

  it("agents.updateMcp rejects the removed sse transport with invalid params", async () => {
    const frame = await callMethod(harness, "agents.updateMcp", {
      projectId: "p1",
      id: agentId,
      servers: [{ id: "s2", name: "old", enabled: true, transport: "sse", url: "https://x/sse" }],
    });
    expect(frame).toMatchObject({ type: "result", ok: false, error: { code: -32602 } });
  });

  it("agents.updateMcp for a missing agent maps to app error 100", async () => {
    const frame = await callMethod(harness, "agents.updateMcp", {
      projectId: "p1",
      id: "nope",
      servers: [],
    });
    expect(frame).toMatchObject({ type: "result", ok: false, error: { code: 100 } });
  });
});
