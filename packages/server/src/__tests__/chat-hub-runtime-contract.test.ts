import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProject, type Logger, type ProjectRuntime } from "@spherse/core";
import { ChatSessionHub } from "../chat-session-hub.js";

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

describe("chat hub ↔ real SessionManager contract", () => {
  let tmpDir: string;
  let runtime: ProjectRuntime & {
    projectManager: { projectStore: any };
    sessionRuntime: any;
  };
  let agentId: string;
  let sessionId: string;
  let store: any;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spherse-hub-contract-"));
    runtime = (await createProject(tmpDir, {
      projectName: "Contract",
      logger: silentLogger,
      modelCatalog: stubCatalog,
      defaultModel: "openai/gpt-4o",
    })) as never;
    const projectStore = runtime.projectManager.projectStore;
    const agent = await projectStore.createAgent("test-agent", TEST_AGENT_PROFILE);
    agentId = agent.getProfile().id;
    sessionId = await runtime.sessionRuntime.createSession(agentId);
    store = projectStore.agents.get(agentId).sessions;
  });

  afterAll(async () => {
    runtime.timerService.stop();
    await runtime.shutdown();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("echo, wire enrichment, and replay stay consistent with the persisted log", async () => {
    const hub = new ChatSessionHub(silentLogger as never);
    const events: any[] = [];
    const attachment = hub.attach(
      "p1",
      runtime.sessionRuntime,
      agentId,
      sessionId,
      (event) => events.push(event),
    );
    await attachment.ready;
    expect(events[0]).toEqual({ type: "session_ready", lastSeq: -1, replay: true });
    events.length = 0;

    const runner = runtime.sessionRuntime.sessions.get(sessionId);
    const liveAgent = runner.agentRef;
    let dispatch: ((event: unknown) => unknown) | undefined;
    liveAgent.subscribe = vi.fn((handler: (event: unknown) => unknown) => {
      dispatch = handler;
      return () => {};
    });
    liveAgent.prompt = vi.fn().mockResolvedValue(undefined);

    const run = attachment.sendMessage("hi", [], "c1");
    await vi.waitFor(() =>
      expect(events).toContainEqual(
        expect.objectContaining({ type: "user_message", seq: 0, clientId: "c1" }),
      ),
    );
    const echo = events.find((event) => event.type === "user_message");
    expect(echo.message).toMatchObject({ role: "user" });
    expect(store.readEvents(sessionId).map((event: any) => [event.type, event.seq])).toEqual([
      ["user/message", 0],
      ["turn/start", 1],
    ]);
    await dispatch?.({ type: "agent_end", messages: [] });
    await run;
    events.length = 0;

    const assistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: "hello" }],
      api: "anthropic",
      provider: "anthropic",
      model: "claude",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
    };
    const secondRun = attachment.sendMessage("again", [], "c2");
    await vi.waitFor(() =>
      expect(events).toContainEqual(
        expect.objectContaining({ type: "user_message", seq: 3, clientId: "c2" }),
      ),
    );

    await dispatch?.({ type: "message_start", message: { ...assistantMessage } });
    await dispatch?.({ type: "message_end", message: assistantMessage });
    await dispatch?.({ type: "agent_end", messages: [assistantMessage] });
    await secondRun;

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "message_end",
        messageId: expect.any(String),
        seq: 5,
      }),
    );
    expect(events).toContainEqual(expect.objectContaining({ type: "agent_end", seq: 6 }));
    expect(store.readEvents(sessionId).map((event: any) => [event.type, event.seq])).toEqual([
      ["user/message", 0],
      ["turn/start", 1],
      ["turn/end", 2],
      ["user/message", 3],
      ["turn/start", 4],
      ["assistant/message", 5],
      ["turn/end", 6],
    ]);
    const liveRunner = runtime.sessionRuntime.sessions.get(sessionId);
    expect(liveRunner.currentEvents[5].data.message).toBe(assistantMessage);
    events.length = 0;

    const replayEvents: any[] = [];
    const replayAttachment = hub.attach(
      "p1",
      runtime.sessionRuntime,
      agentId,
      sessionId,
      (event) => replayEvents.push(event),
      { since: 4 },
    );
    await replayAttachment.ready;

    expect(replayEvents[0]).toEqual({ type: "session_ready", lastSeq: 6, replay: true });
    const expected = store.readEvents(sessionId).filter((event: any) => event.seq > 4);
    const replayBatches = replayEvents.filter((event) => event.type === "replay_events");
    expect(replayBatches.flatMap((batch: any) => batch.events)).toEqual(expected);
    expect(replayEvents.at(-1)).toEqual({ type: "run_status", active: false });

    replayAttachment.close();
    attachment.close();
  });
});
