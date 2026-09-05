import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Logger } from "@spherse/core";
import { ProjectRegistry } from "../registry.js";
import { ChatSessionHub } from "../chat/chat-session-hub.js";

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
name: Trigger Agent
tools:
  - read_file
---

Trigger routing contract agent.`;

const stubCatalog = {
  getChatStreamFn: vi.fn(() => vi.fn()),
  resolveModelById: vi.fn((modelId: string) => {
    const slashIdx = modelId.indexOf("/");
    return slashIdx >= 0
      ? { id: modelId.slice(slashIdx + 1), provider: modelId.slice(0, slashIdx) }
      : { id: modelId, provider: modelId };
  }),
} as never;

describe("trigger sessionPort routing through the chat hub (real boundary)", () => {
  let tmpDir: string;
  let hub: ChatSessionHub;
  let registry: ProjectRegistry;
  let ctx: Awaited<ReturnType<ProjectRegistry["register"]>>;
  let agentId: string;
  let sessionId: string;
  let store: any;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spherse-trigger-routing-"));
    hub = new ChatSessionHub(silentLogger as never);
    registry = new ProjectRegistry(silentLogger, {
      modelCatalog: stubCatalog,
      defaultModel: "openai/gpt-4o",
      chatHub: hub,
    });
    ctx = await registry.register(tmpDir);
    const projectStore = (ctx.projectManager as any).projectStore;
    const agent = await projectStore.createAgent("trigger-agent", TEST_AGENT_PROFILE);
    agentId = agent.getProfile().id;
    sessionId = await ctx.sessionRuntime.createSession(agentId);
    store = projectStore.agents.get(agentId).sessions;
  });

  afterAll(async () => {
    await registry.removeAll();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function stubAgentTurn(dispatchAgentEnd: boolean) {
    await ctx.sessionRuntime.restoreSession(agentId, sessionId);
    const runner = (ctx.sessionRuntime as any).sessions.get(sessionId);
    const liveAgent = runner.agentRef;
    let dispatch: ((event: unknown) => unknown) | undefined;
    liveAgent.subscribe = vi.fn((handler: (event: unknown) => unknown) => {
      dispatch = handler;
      return () => {};
    });
    liveAgent.prompt = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          if (dispatchAgentEnd) {
            void Promise.resolve().then(async () => {
              await dispatch?.({ type: "agent_end", messages: [] });
              resolve();
            });
          }
        }),
    );
    return { liveAgent };
  }

  function makeEntry(overrides?: Record<string, unknown>) {
    return {
      id: `tr-${Math.random().toString(36).slice(2, 8)}`,
      enabled: true,
      type: "event",
      eventName: "routing-evt",
      mode: "existing_session",
      targetSessionId: sessionId,
      message: "Hello {{payload}}",
      notify: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides,
    } as never;
  }

  it("routes a trigger send through the hub: live echo with trigger meta reaches subscribers", async () => {
    await stubAgentTurn(true);
    const events: any[] = [];
    const attachment = hub.attach(
      ctx.projectId,
      ctx.sessionRuntime,
      agentId,
      sessionId,
      (event) => events.push(event),
    );
    await attachment.ready;
    events.length = 0;

    const entry = makeEntry({ name: "routing-trigger" });
    ctx.triggerManager.create(agentId, entry);
    const logs = (ctx.triggerManager as any).getTriggerStore(agentId);
    ctx.triggerManager.onUserEvent("routing-evt", "world");

    await vi.waitFor(() => {
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "user_message",
          source: "triggered",
          triggerName: "routing-trigger",
        }),
      );
    });
    const statuses = events.filter((e) => e.type === "run_status").map((e) => e.active);
    await vi.waitFor(() => {
      const storeLog = (logs as any).getRecentLogs(50) as any[];
      expect(storeLog.some((l) => l.triggerId === entry.id && l.status === "success")).toBe(true);
    });
    expect(statuses[0]).toBe(true);
    await vi.waitFor(() => {
      expect(
        events.filter((e) => e.type === "run_status").map((e) => e.active),
      ).toEqual([true, false]);
    });
    const persisted = store.readEvents(sessionId).find((e: any) => e.type === "user/message");
    expect(persisted.data.source).toBe("triggered");
    expect(persisted.data.triggerName).toBe("routing-trigger");
    attachment.close();
  });

  it("fails the trigger when the hub rejects a concurrent run (ConflictError equivalence)", async () => {
    await stubAgentTurn(false);
    const events: any[] = [];
    const attachment = hub.attach(
      ctx.projectId,
      ctx.sessionRuntime,
      agentId,
      sessionId,
      (event) => events.push(event),
    );
    await attachment.ready;
    events.length = 0;

    const first = makeEntry({ eventName: "conflict-evt", name: "first" });
    const second = makeEntry({ eventName: "conflict-evt", name: "second" });
    ctx.triggerManager.create(agentId, first);
    ctx.triggerManager.create(agentId, second);
    ctx.triggerManager.onUserEvent("conflict-evt", "");

    await vi.waitFor(() => {
      expect(events.some((e) => e.type === "run_status" && e.active)).toBe(true);
    });

    const logStore = (ctx.triggerManager as any).getTriggerStore(agentId);
    await vi.waitFor(() => {
      const all = logStore.getRecentLogs(50) as any[];
      expect(all.some((l) => (l.triggerId === first.id || l.triggerId === second.id) && l.status === "failed" && /already running/.test(String(l.error)))).toBe(true);
      expect(all.some((l) => (l.triggerId === first.id || l.triggerId === second.id) && l.status === "success")).toBe(false);
    });
    expect(events.filter((e) => e.type === "run_status" && e.active)).toHaveLength(1);
    attachment.close();
  });
});
