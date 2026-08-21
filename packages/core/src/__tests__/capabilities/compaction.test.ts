import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { compactionCapability } from "../../capabilities/compaction/index.js";
import { composeTurnHooks } from "../../kernel/turn-hooks.js";
import { SessionEventLog } from "../../session/event-log.js";
import { deriveMessages } from "../../session/fold.js";
import { ProjectStore } from "../../store/project.js";
import { createSilentLogger } from "../../logger.js";

const TEST_AGENT_PROFILE = `---
name: Compaction Agent
tools: []
---

Agent for compaction tests.`;

describe("compaction capability", () => {
  let tmpDir: string;
  let projectStore: ProjectStore;
  let agentId: string;
  let sessionId: string;
  let agent: Awaited<ReturnType<ProjectStore["createAgent"]>>;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-compcap-"));
    projectStore = new ProjectStore(tmpDir, createSilentLogger());
    await projectStore.create("Test");
    const agentStore = await projectStore.createAgent("comp-agent", TEST_AGENT_PROFILE);
    agentId = agentStore.getProfile().id;
    sessionId = agentStore.sessions.createSession();
    agent = agentStore;
  });
  afterEach(async () => {
    projectStore.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function seededLog(): SessionEventLog {
    const log = SessionEventLog.open(agent.sessions, sessionId);
    for (let i = 0; i < 25; i++) {
      log.append("user/message", {
        message: { role: "user", content: `turn ${i} with some text`, timestamp: Date.now() },
      });
      log.append("assistant/message", {
        message: {
          role: "assistant",
          content: [{ type: "text", text: `reply ${i} with some text` }],
          stopReason: "stop",
          timestamp: Date.now(),
        },
      });
    }
    return log;
  }

  it("afterTurn appends compaction/applied when the threshold is exceeded", async () => {
    const capability = compactionCapability({ projectStore, logger: createSilentLogger() });
    const hooks = capability.turnHooks!(agentId, sessionId);
    const fakeAgent = { state: { model: { contextWindow: 10 }, systemPrompt: "" } } as never;

    const log = seededLog();
    await hooks.afterTurn!(fakeAgent, log);

    const compactionEvents = log.events.filter((e) => e.type === "compaction/applied");
    expect(compactionEvents).toHaveLength(1);
    expect(compactionEvents[0].data.anchorSeq).toBeGreaterThan(0);
    expect(deriveMessages(log.events).length).toBeLessThan(50);
  });

  it("contributes to a composed hook chain like any other capability", async () => {
    const order: string[] = [];
    const other = { afterTurn: async () => order.push("other") };
    const compaction = compactionCapability({ projectStore, logger: createSilentLogger() });

    const composed = composeTurnHooks([compaction.turnHooks!(agentId, sessionId), other as never]);
    const fakeAgent = { state: { model: { contextWindow: 10 }, systemPrompt: "" } } as never;

    await composed.afterTurn!(fakeAgent, seededLog());
    expect(order).toEqual(["other"]);
  });

  it("pluggability: no compaction capability means no compaction event", async () => {
    const hooks = composeTurnHooks([]);
    const fakeAgent = { state: { model: { contextWindow: 10 }, systemPrompt: "" } } as never;

    const log = seededLog();
    await hooks.afterTurn!(fakeAgent, log);

    expect(log.events).toHaveLength(50);
    expect(log.events.filter((e) => e.type === "compaction/applied")).toHaveLength(0);
  });
});
