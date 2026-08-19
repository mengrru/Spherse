import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { compactionCapability } from "../../capabilities/compaction/index.js";
import { composeTurnHooks } from "../../kernel/turn-hooks.js";
import { createLog } from "../../kernel/message-log.js";
import { ProjectStore } from "../../store/project.js";
import { createSilentLogger } from "../../logger.js";
import type { Message } from "@earendil-works/pi-ai";

const TEST_AGENT_PROFILE = `---
name: Compaction Agent
tools: []
---

Agent for compaction tests.`;

function msg(role: string, text: string): Message {
  return {
    role,
    content: role === "assistant" ? [{ type: "text", text }] : text,
    timestamp: Date.now(),
  } as Message;
}

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

  function seededLog() {
    const entries = [];
    for (let i = 0; i < 25; i++) {
      const u = msg("user", `turn ${i} with some text`);
      const a = msg("assistant", `reply ${i} with some text`);
      entries.push(
        { dbId: agent.sessions.appendMessage(sessionId, u), message: u },
        { dbId: agent.sessions.appendMessage(sessionId, a), message: a },
      );
    }
    return createLog(entries);
  }

  it("afterTurn compacts and records when the threshold is exceeded", async () => {
    const capability = compactionCapability({ projectStore, logger: createSilentLogger() });
    const hooks = capability.turnHooks!(agentId, sessionId);
    const fakeAgent = { state: { model: { contextWindow: 10 }, systemPrompt: "" } } as never;

    const next = await hooks.afterTurn!(fakeAgent, seededLog());

    expect(next.entries.length).toBeLessThan(50);
    const latest = agent.sessions.getLatestCompaction(sessionId);
    expect(latest).not.toBeNull();
    expect(next.entries[0].dbId).toBe(latest!.anchorMessageId);
  });

  it("contributes to a composed hook chain like any other capability", async () => {
    const order: string[] = [];
    const other = { afterTurn: async () => (order.push("other"), createLog([])) };
    const compaction = compactionCapability({ projectStore, logger: createSilentLogger() });

    const composed = composeTurnHooks([compaction.turnHooks!(agentId, sessionId), other as never]);
    const fakeAgent = { state: { model: { contextWindow: 10 }, systemPrompt: "" } } as never;

    await composed.afterTurn!(fakeAgent, seededLog());
    expect(order).toEqual(["other"]);
  });

  it("pluggability: no compaction capability means maybeCompactLog is never invoked", async () => {
    const before = agent.sessions.getSessionMessagesWithIds(sessionId).length;
    const hooks = composeTurnHooks([]);
    const fakeAgent = { state: { model: { contextWindow: 10 }, systemPrompt: "" } } as never;

    const next = await hooks.afterTurn!(fakeAgent, seededLog());

    expect(next.entries).toHaveLength(50);
    expect(agent.sessions.getLatestCompaction(sessionId)).toBeNull();
    expect(agent.sessions.getSessionMessagesWithIds(sessionId).length).toBe(before + 50);
  });
});
