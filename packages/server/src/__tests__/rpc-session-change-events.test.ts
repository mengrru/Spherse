import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProject, type Logger, type ProjectRuntime, type SessionChangePayload } from "@spherse/core";
import { sessionMethods } from "@spherse/rpc/methods";
import { callMethod, createRpcHarness, type RpcHarness } from "@spherse/rpc/testing";

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => silentLogger,
};

describe("session change event contract: real runtime through rpc", () => {
  let tmpDir: string;
  let runtime: ProjectRuntime;
  let harness: RpcHarness;
  let agentId: string;
  let sessionId: string;
  const events: SessionChangePayload[] = [];

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spherse-session-events-"));
    runtime = await createProject(tmpDir, { projectName: "Contract", logger: silentLogger });
    agentId = (await runtime.projectManager.createAgent(undefined, "---\nname: Contract Agent\n---\nbody")).id;
    runtime.projectManager.onSessionChange((payload) => events.push(payload));

    harness = createRpcHarness({
      methods: sessionMethods,
      projectCtx: {
        runtime,
        projectManager: runtime.projectManager,
        sessionRuntime: runtime.sessionRuntime,
        triggerManager: runtime.triggerManager,
      } as never,
    });
  });

  afterAll(async () => {
    runtime.timerService.stop();
    await runtime.shutdown();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("sessions.create broadcasts session_updated created", async () => {
    const frame = await callMethod(harness, "sessions.create", {
      projectId: "p1",
      agentId,
      title: "Trip Plan",
    });
    expect(frame).toMatchObject({ type: "result", ok: true });
    sessionId = (frame.data as { sessionId: string }).sessionId;

    expect(events).toContainEqual({ agentId, sessionId, action: "created" });
  });

  it("sessions.rename broadcasts session_updated updated", async () => {
    const frame = await callMethod(harness, "sessions.rename", {
      projectId: "p1",
      agentId,
      sessionId,
      title: "Renamed",
    });
    expect(frame).toMatchObject({ type: "result", ok: true, data: { id: sessionId, title: "Renamed" } });

    expect(events).toContainEqual({ agentId, sessionId, action: "updated" });
  });

  it("sessions.delete broadcasts session_updated deleted", async () => {
    const frame = await callMethod(harness, "sessions.delete", { projectId: "p1", agentId, sessionId });
    expect(frame).toMatchObject({ type: "result", ok: true, data: { ok: true } });

    expect(events).toContainEqual({ agentId, sessionId, action: "deleted" });
  });
});
