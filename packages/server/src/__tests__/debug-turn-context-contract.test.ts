import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { createProject, type Logger, type ProjectRuntime } from "@spherse/core";
import { parseContract, schemas } from "@spherse/contracts";
import { registerDebugRoutes } from "../routes/debug.js";

declare module "fastify" {
  interface FastifyRequest {
    projectCtx?: { sessionRuntime: unknown };
  }
}

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => silentLogger,
};

const TEST_AGENT_PROFILE = `---
name: Test Agent
tools:
  - read_file
---

Test agent for contracts.`;

const stubCatalog = {
  getChatStreamFn: vi.fn(() => vi.fn()),
  resolveModelById: vi.fn((modelId: string) => {
    const slashIdx = modelId.indexOf("/");
    return slashIdx >= 0
      ? { id: modelId.slice(slashIdx + 1), provider: modelId.slice(0, slashIdx) }
      : { id: modelId, provider: modelId };
  }),
} as never;

describe("debug turn-context ↔ real SessionManager contract", () => {
  let tmpDir: string;
  let runtime: ProjectRuntime & {
    projectManager: { projectStore: any };
    sessionRuntime: any;
  };
  let app: FastifyInstance;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spherse-debug-contract-"));
    runtime = (await createProject(tmpDir, {
      projectName: "Contract",
      logger: silentLogger,
      modelCatalog: stubCatalog,
      defaultModel: "openai/gpt-4o",
    })) as never;
    app = Fastify();
    app.addHook("preHandler", async (req: FastifyRequest) => {
      req.projectCtx = { sessionRuntime: runtime.sessionRuntime };
    });
    registerDebugRoutes(app, {} as never);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    runtime.timerService.stop();
    await runtime.shutdown();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function createSessionWithAgent(): Promise<string> {
    const projectStore = runtime.projectManager.projectStore;
    const agent = await projectStore.createAgent(`test-agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, TEST_AGENT_PROFILE);
    return runtime.sessionRuntime.createSession(agent.getProfile().id);
  }

  it("returns a contract-valid uncompacted snapshot from the real runtime", async () => {
    const sessionId = await createSessionWithAgent();
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/p1/debug/sessions/${sessionId}/turn-context`,
    });
    expect(res.statusCode).toBe(200);
    const parsed = parseContract(schemas.turnContextSnapshot, res.json());
    expect(parsed.compaction).toBeNull();
    expect(parsed.compactionCount).toBe(0);
  });

  it("exposes only the latest compaction metadata from the real event log", async () => {
    const sessionId = await createSessionWithAgent();
    const runner = runtime.sessionRuntime.sessions.get(sessionId);
    runner.eventLog.append("compaction/applied", {
      anchorSeq: 1,
      digestContent: "first digest",
      excludedSeqs: [2],
      digestSource: "llm",
    });
    runner.eventLog.append("compaction/applied", {
      anchorSeq: 3,
      digestContent: "second digest!",
      excludedSeqs: [4, 5],
      digestSource: "mechanical",
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/p1/debug/sessions/${sessionId}/turn-context`,
    });
    expect(res.statusCode).toBe(200);
    const parsed = parseContract(schemas.turnContextSnapshot, res.json());
    expect(parsed.compactionCount).toBe(2);
    expect(parsed.compaction).toEqual({
      seq: 1,
      anchorSeq: 3,
      digestSource: "mechanical",
      excludedCount: 2,
      digestLength: 14,
      appliedAtMs: expect.any(Number),
    });
  });
});
