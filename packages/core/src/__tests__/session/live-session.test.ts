import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { createSilentLogger } from "../../logger.js";

const { getChatStreamFnMock, resolveModelByIdMock } = vi.hoisted(() => ({
  getChatStreamFnMock: vi.fn(() => vi.fn()),
  resolveModelByIdMock: vi.fn((modelId: string) => {
    const slashIdx = modelId.indexOf("/");
    return slashIdx >= 0
      ? { id: modelId.slice(slashIdx + 1), provider: modelId.slice(0, slashIdx) }
      : { id: modelId, provider: modelId };
  }),
}));

vi.mock("../../model-providers/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../model-providers/index.js")>();
  return {
    ...actual,
    getChatStreamFn: getChatStreamFnMock,
    resolveModelById: resolveModelByIdMock,
  };
});

import { createProject } from "../../factory.js";
import { LiveSession } from "../../session/live-session.js";
import type { SessionContext } from "../../session/types.js";

const TEST_AGENT_PROFILE = `---
name: Test Agent
tools:
  - read_file
---

Test agent for sessions.`;

interface RuntimeInternals {
  projectManager: { projectStore: { agents: Map<string, unknown> } };
  scheduler: { stopAll: () => void };
}

function getAgentStore(runtime: RuntimeInternals, agentId: string): any {
  return runtime.projectManager.projectStore.agents.get(agentId);
}

function agentOf(live: LiveSession): any {
  return (live as any).agent;
}

function liveIdsOf(live: LiveSession): number[] {
  return (live as any).liveMessageDbIds as number[];
}

describe("LiveSession context engineering", () => {
  let tmpDir: string;
  let runtime: RuntimeInternals & Awaited<ReturnType<typeof createProject>>;
  let ctx: SessionContext;
  let agentId: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-live-ctx-"));
    getChatStreamFnMock.mockClear();
    resolveModelByIdMock.mockClear();
    runtime = (await createProject(tmpDir, {
      projectName: "Test",
      logger: createSilentLogger(),
    })) as RuntimeInternals & Awaited<ReturnType<typeof createProject>>;
    const projectStore = runtime.projectManager.projectStore as any;
    const testAgent = await projectStore.createAgent("test-agent", TEST_AGENT_PROFILE);
    agentId = testAgent.getProfile().id;
    runtime.scheduler.stopAll();
    ctx = {
      projectStore,
      projectRoot: projectStore.getRootPath(),
      fileWriteMutex: (runtime as any).sessionRuntime.ctx.fileWriteMutex,
      logger: createSilentLogger(),
    };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("buildAgent produces XML system prompt with agent-profile", async () => {
    const agentStore = getAgentStore(runtime, agentId);
    agentStore._profile = { ...agentStore._profile, systemPrompt: "You are a test assistant." };

    const sessionId = agentStore.sessions.createSession();
    const live = await LiveSession.create(ctx, agentId, sessionId);
    const agent = agentOf(live);

    expect(agent.state.systemPrompt).toContain("<agent-profile>");
    expect(agent.state.systemPrompt).toContain("You are a test assistant.");
    expect(agent.state.systemPrompt).not.toContain("## Available Skills");
  });

  it("buildAgent includes project-instructions when AGENTS.md exists", async () => {
    await fs.promises.writeFile(
      path.join(tmpDir, "AGENTS.md"),
      "# Custom Project\n\nCustom instructions here.",
      "utf-8",
    );

    const agentStore = getAgentStore(runtime, agentId);
    const sessionId = agentStore.sessions.createSession();
    const live = await LiveSession.create(ctx, agentId, sessionId);
    const agent = agentOf(live);

    expect(agent.state.systemPrompt).toContain("<project-instructions>");
    expect(agent.state.systemPrompt).toContain("Custom Project");
  });

  it("buildAgent includes session-context with name, slug and session id", async () => {
    const agentStore = getAgentStore(runtime, agentId);
    const profile = agentStore.getProfile();

    const sessionId = agentStore.sessions.createSession();
    const live = await LiveSession.create(ctx, agentId, sessionId);
    const agent = agentOf(live);

    expect(agent.state.systemPrompt).toContain("<session-context>");
    expect(agent.state.systemPrompt).toContain(`agent-name: ${profile.name}`);
    expect(agent.state.systemPrompt).toContain(`agent-slug: ${profile.slug}`);
    expect(agent.state.systemPrompt).toContain(`session-id: ${sessionId}`);
    expect(agent.state.systemPrompt).not.toContain("agent-alias:");
  });

  it("buildAgent includes agent-alias in session-context when present", async () => {
    const agentStore = getAgentStore(runtime, agentId);
    agentStore._profile = { ...agentStore._profile, alias: "小明" };
    const profile = agentStore.getProfile();

    const sessionId = agentStore.sessions.createSession();
    const live = await LiveSession.create(ctx, agentId, sessionId);
    const agent = agentOf(live);

    expect(agent.state.systemPrompt).toContain(`agent-name: ${profile.name}`);
    expect(agent.state.systemPrompt).toContain("agent-alias: 小明");
    expect(agent.state.systemPrompt).toContain(`session-id: ${sessionId}`);
  });

  it("does not wire transformContext into the Agent", async () => {
    const agentStore = getAgentStore(runtime, agentId);
    const sessionId = agentStore.sessions.createSession();
    const live = await LiveSession.create(ctx, agentId, sessionId);

    expect(agentOf(live).transformContext).toBeUndefined();
  });

  it("liveMessageDbIds starts empty on create", async () => {
    const agentStore = getAgentStore(runtime, agentId);
    const sessionId = agentStore.sessions.createSession();
    const live = await LiveSession.create(ctx, agentId, sessionId);

    expect(liveIdsOf(live)).toEqual([]);
  });

  it("restoreSession without compaction restores all messages", async () => {
    const agentStore = getAgentStore(runtime, agentId);
    const sessionId = agentStore.sessions.createSession();

    const msg = { role: "user", content: "hello world", timestamp: Date.now() };
    agentStore.sessions.appendMessage(sessionId, msg);

    const live = await LiveSession.restore(ctx, agentId, sessionId);
    const agent = agentOf(live);
    expect(agent.state.messages.length).toBe(1);
    expect(agent.state.messages[0].role).toBe("user");
    expect(agent.state.messages[0].content).toContain("hello world");
  });

  it("restoreSession with compaction restores digest + tail", async () => {
    const agentStore = getAgentStore(runtime, agentId);
    const sessionId = agentStore.sessions.createSession();

    const digestPlain = "[user]: earlier question\n[assistant]: earlier answer";
    const anchorMsg = { role: "user", content: "anchor placeholder", timestamp: Date.now() };
    const tailMsg1 = { role: "user", content: "tail question", timestamp: Date.now() };
    const tailMsg2 = { role: "assistant", content: [{ type: "text", text: "tail answer" }], timestamp: Date.now() };

    agentStore.sessions.appendMessage(sessionId, anchorMsg);
    const anchorId = agentStore.sessions.appendMessage(sessionId, anchorMsg);
    const tailId1 = agentStore.sessions.appendMessage(sessionId, tailMsg1);
    const tailId2 = agentStore.sessions.appendMessage(sessionId, tailMsg2);

    agentStore.sessions.recordCompaction(sessionId, {
      anchorMessageId: anchorId,
      digestContent: digestPlain,
      tokenEstimate: 100,
    });

    const live = await LiveSession.restore(ctx, agentId, sessionId);
    const agent = agentOf(live);
    expect(agent.state.messages.length).toBe(3);
    expect(agent.state.messages[0].role).toBe("user");
    expect(agent.state.messages[0].content).toContain("<compaction-digest");
    expect(agent.state.messages[0].content).toContain("[user]: earlier question");
    expect(agent.state.messages[0].content).toContain("[assistant]: earlier answer");
    expect(agent.state.messages[1].role).toBe("user");
    expect(agent.state.messages[1].content).toContain("tail question");
    expect(agent.state.messages[2].role).toBe("assistant");

    const ids = liveIdsOf(live);
    expect(ids[0]).toBe(anchorId);
    expect(ids).toContain(tailId1);
    expect(ids).toContain(tailId2);
  });

  it("maybeCompact records real anchorMessageId as digest placeholder", async () => {
    const agentStore = getAgentStore(runtime, agentId);
    const sessionId = agentStore.sessions.createSession();
    const live = await LiveSession.create(ctx, agentId, sessionId);
    const agent = agentOf(live);

    const msgs: any[] = [];
    const ids: number[] = [];
    for (let i = 0; i < 25; i++) {
      const u = { role: "user", content: `turn ${i} with some text`, timestamp: Date.now() + i };
      msgs.push(u);
      ids.push(agentStore.sessions.appendMessage(sessionId, u));
      const a = {
        role: "assistant",
        content: [{ type: "text", text: `reply ${i} with some text` }],
        timestamp: Date.now() + i,
      };
      msgs.push(a);
      ids.push(agentStore.sessions.appendMessage(sessionId, a));
    }
    agent.state.messages = msgs;
    liveIdsOf(live).push(...ids);
    agent.state.model.contextWindow = 10;

    await (live as any).maybeCompact();

    const latest = agentStore.sessions.getLatestCompaction(sessionId);
    expect(latest).not.toBeNull();
    const newIds = liveIdsOf(live);
    expect(newIds[0]).toBe(latest!.anchorMessageId);
    expect(newIds[0]).toBeGreaterThan(0);
    expect(newIds.length).toBe(agent.state.messages.length);
  });

  it("repeated compaction does not over-include messages on restore", async () => {
    const agentStore = getAgentStore(runtime, agentId);
    const sessionId = agentStore.sessions.createSession();
    const live = await LiveSession.create(ctx, agentId, sessionId);
    const agent = agentOf(live);

    const msgs: any[] = [];
    const ids: number[] = [];
    for (let i = 0; i < 25; i++) {
      const u = { role: "user", content: `turn ${i} text`, timestamp: Date.now() + i };
      msgs.push(u);
      ids.push(agentStore.sessions.appendMessage(sessionId, u));
      const a = {
        role: "assistant",
        content: [{ type: "text", text: `reply ${i} text` }],
        timestamp: Date.now() + i,
      };
      msgs.push(a);
      ids.push(agentStore.sessions.appendMessage(sessionId, a));
    }
    agent.state.messages = msgs;
    liveIdsOf(live).push(...ids);
    agent.state.model.contextWindow = 10;

    await (live as any).maybeCompact();
    await (live as any).maybeCompact();

    const totalPersisted = agentStore.sessions.getSessionMessages(sessionId).length;
    expect(totalPersisted).toBe(50);

    const restored = await LiveSession.restore(ctx, agentId, sessionId);
    const restoredAgent = agentOf(restored);
    expect(restoredAgent.state.messages.length).toBeLessThan(totalPersisted);
    const restoredIds = liveIdsOf(restored);
    expect(restoredIds[0]).toBeGreaterThan(0);
  });
});
