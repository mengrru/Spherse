import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createProject, type Logger, type ProjectRuntime, type SessionManager } from "@spherse/core";
import { debugMethods } from "@spherse/rpc/methods";
import { callMethod, createFakeProjectCtx, createRpcHarness, type RpcHarness } from "@spherse/rpc/testing";

interface ResultFrame {
  type: string;
  id: number;
  ok: boolean;
  data?: unknown;
  error?: { code: number; message: string; data?: unknown };
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

let tmpDir: string;
let runtime: ProjectRuntime;
let harness: RpcHarness;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "spherse-rpc-debug-contract-"));
  runtime = (await createProject(tmpDir, {
    projectName: "Contract",
    logger: silentLogger,
    modelCatalog: stubCatalog,
    defaultModel: "openai/gpt-4o",
  })) as ProjectRuntime;
  harness = createRpcHarness({
    methods: debugMethods,
    projectCtx: createFakeProjectCtx({
      sessionRuntime: {
        getTurnContext: (sessionId: string) => runtime.sessionRuntime.getTurnContext(sessionId),
      } as unknown as SessionManager,
    }),
  });
});

afterAll(async () => {
  runtime.timerService.stop();
  await runtime.shutdown();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function createSessionWithAgent(): Promise<string> {
  const projectStore = runtime.projectManager.projectStore;
  const agent = await projectStore.createAgent(
    `test-agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    TEST_AGENT_PROFILE,
  );
  return runtime.sessionRuntime.createSession(agent.getProfile().id);
}

describe("debug.turnContext against the real SessionManager", () => {
  it("returns a contract-valid uncompacted snapshot from the real runtime", async () => {
    const sessionId = await createSessionWithAgent();
    const frame = (await callMethod(harness, "debug.turnContext", {
      projectId: "p1",
      sessionId,
    })) as ResultFrame;
    expect(frame).toMatchObject({ type: "result", ok: true });
    const snapshot = frame.data as { sessionId: string; compaction: unknown; compactionCount: number };
    expect(snapshot.sessionId).toBe(sessionId);
    expect(snapshot.compaction).toBeNull();
    expect(snapshot.compactionCount).toBe(0);
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

    const frame = (await callMethod(harness, "debug.turnContext", {
      projectId: "p1",
      sessionId,
    })) as ResultFrame;
    expect(frame).toMatchObject({ type: "result", ok: true });
    const snapshot = frame.data as {
      sessionId: string;
      compaction: Record<string, unknown>;
      compactionCount: number;
    };
    expect(snapshot.sessionId).toBe(sessionId);
    expect(snapshot.compactionCount).toBe(2);
    expect(snapshot.compaction).toEqual({
      seq: 1,
      anchorSeq: 3,
      digestSource: "mechanical",
      excludedCount: 2,
      digestLength: 14,
      appliedAtMs: expect.any(Number),
    });
  });
});
