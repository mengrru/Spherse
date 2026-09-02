import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import Database from "better-sqlite3";
import { createProject, type ProjectRuntime, type Logger } from "@spherse/core";
import { registerSessionRoutes } from "../routes/sessions.js";
import { ChatSessionHub } from "../chat-session-hub.js";
import { registerCoreErrorHandler } from "../errors.js";
import type { ProjectRegistry } from "../registry.js";

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => silentLogger,
};

const { getChatStreamFnMock, resolveModelByIdMock } = vi.hoisted(() => ({
  getChatStreamFnMock: vi.fn(() => vi.fn()),
  resolveModelByIdMock: vi.fn((modelId: string) => {
    const slashIdx = modelId.indexOf("/");
    return slashIdx >= 0
      ? { id: modelId.slice(slashIdx + 1), provider: modelId.slice(0, slashIdx) }
      : { id: modelId, provider: modelId };
  }),
}));

const stubCatalog = {
  getChatStreamFn: getChatStreamFnMock,
  resolveModelById: resolveModelByIdMock,
} as never;

const TEST_AGENT_PROFILE = `---
name: Test Agent
tools:
  - read_file
---

Test agent for sessions.`;

declare module "fastify" {
  interface FastifyRequest {
    projectCtx?: {
      projectManager: import("@spherse/core").ProjectManager;
      sessionRuntime: import("@spherse/core").SessionManager;
    };
  }
}

describe("session events contract: real SessionManager through real route + hub", () => {
  let tmpDir: string;
  let runtime: ProjectRuntime;
  let app: FastifyInstance;
  let hub: ChatSessionHub;
  let agentId: string;
  let agentSlug: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spherse-events-contract-"));
    runtime = await createProject(tmpDir, {
      projectName: "Contract",
      logger: silentLogger,
      modelCatalog: stubCatalog,
      defaultModel: "openai/gpt-4o",
    });
    const projectStore = runtime.projectManager.projectStore;
    const testAgent = await projectStore.createAgent("test-agent", TEST_AGENT_PROFILE);
    agentId = testAgent.getProfile().id;
    agentSlug = testAgent.getProfile().slug;

    hub = new ChatSessionHub(silentLogger as never);
    app = Fastify();
    app.addHook("preHandler", async (req: FastifyRequest) => {
      req.projectCtx = {
        projectManager: runtime.projectManager,
        sessionRuntime: runtime.sessionRuntime,
      };
    });
    registerCoreErrorHandler(app);
    registerSessionRoutes(app, {} as ProjectRegistry, hub);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    runtime.timerService.stop();
    await runtime.shutdown();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function agentStore(): any {
    return runtime.projectManager.projectStore.getAgent(agentId) as any;
  }

  function seedSession(events: Array<{ type: string; data: unknown }>): string {
    const sessionId = agentStore().sessions.createSession();
    agentStore().sessions.appendEvents(
      sessionId,
      events.map((event, index) => ({
        type: event.type,
        seq: index,
        time: index + 1,
        data: event.data,
      })),
      1,
    );
    return sessionId;
  }

  it("projects message and turn events, skips markers, and honors since/limit/hasMore", async () => {
    const sessionId = seedSession([
      { type: "user/message", data: { message: { role: "user", content: "q1", timestamp: 1 }, intentId: "01JA" } },
      { type: "turn/start", data: {} },
      { type: "assistant/message", data: { message: { role: "assistant", content: [{ type: "text", text: "a1" }], stopReason: "stop", timestamp: 2 } } },
      { type: "turn/end", data: { reason: "completed" } },
      { type: "user/message", data: { message: { role: "user", content: "q2", timestamp: 3 } } },
      { type: "turn/start", data: {} },
      { type: "assistant/message", data: { message: { role: "assistant", content: [{ type: "text", text: "a2" }], stopReason: "stop", timestamp: 4 } } },
      { type: "turn/end", data: { reason: "completed" } },
      { type: "turn/withdrawn", data: { seq: 4 } },
    ]);

    const all = await app.inject({
      method: "GET",
      url: `/api/projects/p1/agents/${agentId}/sessions/${sessionId}/events`,
    });
    expect(all.statusCode).toBe(200);
    expect((all.json() as { events: unknown[] }).events.map((frame) => (frame as { type: string; seq?: number }).type)).toEqual([
      "message_settled",
      "message_settled",
      "message_settled",
      "message_settled",
      "turn_withdrawn",
    ]);
    expect((all.json() as { events: any[] }).events[0]).toMatchObject({ seq: 0, intentId: "01JA" });
    expect((all.json() as { events: any[] }).events[4]).toEqual({ type: "turn_withdrawn", seq: 4, upTo: 8 });

    const paged = await app.inject({
      method: "GET",
      url: `/api/projects/p1/agents/${agentId}/sessions/${sessionId}/events?since=0&limit=2`,
    });
    const pagedJson = paged.json() as { events: any[]; hasMore: boolean };
    expect(pagedJson.events.map((f) => f.seq)).toEqual([2, 4]);
    expect(pagedJson.hasMore).toBe(true);

    const tail = await app.inject({
      method: "GET",
      url: `/api/projects/p1/agents/${agentId}/sessions/${sessionId}/events?since=8`,
    });
    expect(tail.statusCode).toBe(200);
    const tailJson = tail.json() as { events: unknown[]; hasMore: boolean };
    expect(tailJson.events).toEqual([]);
    expect(tailJson.hasMore).toBe(false);
  });

  it("includes repair events appended by restore (channel-ready before read)", async () => {
    const sessionId = seedSession([
      { type: "user/message", data: { message: { role: "user", content: "q", timestamp: 1 } } },
      { type: "turn/start", data: {} },
      {
        type: "assistant/message",
        data: {
          message: {
            role: "assistant",
            content: [{ type: "toolCall", id: "t1", name: "read_file", arguments: {} }],
            stopReason: "stop",
            timestamp: 2,
          },
        },
      },
    ]);

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/p1/agents/${agentId}/sessions/${sessionId}/events`,
    });
    expect(res.statusCode).toBe(200);
    const frames = (res.json() as { events: any[] }).events;
    const repaired = frames.find(
      (frame) => frame.type === "message_settled" && frame.message?.role === "toolResult",
    );
    expect(repaired).toBeDefined();
    expect(repaired.message.toolCallId).toBe("t1");
    expect(repaired.message.isError).toBe(true);
  });

  it("returns 410 for a legacy unmigrated session without migrating it", async () => {
    const sessionId = agentStore().sessions.createSession();
    const db = new Database(path.join(tmpDir, ".spherse", "agents", agentSlug, "sessions.db"));
    db.prepare(
      "INSERT INTO messages (session_id, role, content, timestamp, prev_message_id, message_content_schema_version) VALUES (?, ?, ?, ?, NULL, 1)",
    ).run(sessionId, "user", JSON.stringify({ role: "user", content: "legacy", timestamp: 1 }), Date.now());
    db.close();

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/p1/agents/${agentId}/sessions/${sessionId}/events`,
    });
    expect(res.statusCode).toBe(410);
    expect(res.json()).toEqual({ reason: "legacy-unmigrated" });
    expect(agentStore().sessions.sessionNeedsMigration(sessionId)).toBe(true);
  });

  it("returns 404 for a missing session", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/p1/agents/${agentId}/sessions/no-such-session/events`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("clamps limit to 200 and reports hasMore", async () => {
    const sessionId = seedSession(
      Array.from({ length: 205 }, (_, i) => ({
        type: "user/message",
        data: { message: { role: "user", content: `q${i}`, timestamp: i + 1 } },
      })),
    );
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/p1/agents/${agentId}/sessions/${sessionId}/events?limit=500`,
    });
    const json = res.json() as { events: unknown[]; hasMore: boolean };
    expect(json.events).toHaveLength(200);
    expect(json.hasMore).toBe(true);
  });

  it("real write facade: sendMessage intentId → settled frames → withdraw broadcast, through real SessionManager", async () => {
    const finalAssistant = {
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
      stopReason: "stop",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      timestamp: Date.now(),
    };
    getChatStreamFnMock.mockImplementation(
      () =>
        (async () => ({
          async *[Symbol.asyncIterator]() {},
          result: async () => finalAssistant,
        })) as never,
    );

    const sessionId = agentStore().sessions.createSession();
    const events: any[] = [];
    const attachment = hub.attach(
      "p1",
      runtime.sessionRuntime,
      agentId,
      sessionId,
      (event) => events.push(event),
    );
    expect(await attachment.ready).toBe(true);

    await attachment.sendMessage("hello", [], "01JFACADE");

    const userSettled = events.find(
      (event) => event.type === "message_settled" && event.message?.role === "user",
    );
    expect(userSettled).toMatchObject({ seq: 0, intentId: "01JFACADE" });
    const assistantSettled = events.filter(
      (event) => event.type === "message_settled" && event.message?.role === "assistant",
    );
    expect(assistantSettled).toHaveLength(1);
    expect(assistantSettled[0].seq).toBe(2);
    const transientEnd = events.find(
      (event) => event.type === "message_end" && event.message?.role === "assistant",
    );
    expect(transientEnd.seq).toBe(2);
    expect(events.indexOf(transientEnd)).toBeLessThan(events.indexOf(assistantSettled[0]));

    await attachment.withdrawLastTurn();
    expect(events.at(-1)).toEqual({ type: "turn_withdrawn", seq: 0, upTo: 4 });

    const endpoint = await app.inject({
      method: "GET",
      url: `/api/projects/p1/agents/${agentId}/sessions/${sessionId}/events`,
    });
    const frames = (endpoint.json() as { events: any[] }).events;
    expect(frames.map((frame) => frame.type)).toEqual([
      "message_settled",
      "message_settled",
      "turn_withdrawn",
    ]);
    expect(frames[2]).toEqual({ type: "turn_withdrawn", seq: 0, upTo: 4 });

    attachment.close();
    getChatStreamFnMock.mockImplementation(() => vi.fn() as never);
  });
});
