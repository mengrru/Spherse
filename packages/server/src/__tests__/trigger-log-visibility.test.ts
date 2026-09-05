import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProject, type Logger, type ProjectRuntime } from "@spherse/core";
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

Trigger log-visibility contract agent.`;

const stubCatalog = {
  getChatStreamFn: vi.fn(() => vi.fn()),
  resolveModelById: vi.fn((modelId: string) => {
    const slashIdx = modelId.indexOf("/");
    return slashIdx >= 0
      ? { id: modelId.slice(slashIdx + 1), provider: modelId.slice(0, slashIdx) }
      : { id: modelId, provider: modelId };
  }),
} as never;

describe("direct trigger run is visible through the session event log (log-derived visibility)", () => {
  let tmpDir: string;
  let runtime: ProjectRuntime & {
    projectManager: { projectStore: any };
    sessionRuntime: any;
  };
  let agentId: string;
  let sessionId: string;
  let store: any;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spherse-trigger-log-vis-"));
    runtime = (await createProject(tmpDir, {
      projectName: "LogVis",
      logger: silentLogger,
      modelCatalog: stubCatalog,
      defaultModel: "openai/gpt-4o",
    })) as never;
    const projectStore = runtime.projectManager.projectStore;
    const agent = await projectStore.createAgent("trigger-agent", TEST_AGENT_PROFILE);
    agentId = agent.getProfile().id;
    sessionId = await runtime.sessionRuntime.createSession(agentId);
    store = projectStore.agents.get(agentId).sessions;
  });

  afterAll(async () => {
    runtime.timerService.stop();
    await runtime.shutdown();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("a subscriber attached to the session sees the trigger run: echo, turn boundaries, completed content", async () => {
    await runtime.sessionRuntime.restoreSession(agentId, sessionId);
    const runner = runtime.sessionRuntime.sessions.get(sessionId);
    const liveAgent = runner.agentRef;
    let dispatch: ((event: unknown) => unknown) | undefined;
    let resolvePrompt: (() => void) | undefined;
    liveAgent.subscribe = vi.fn((handler: (event: unknown) => unknown) => {
      dispatch = handler;
      return () => {};
    });
    liveAgent.prompt = vi.fn(
      () => new Promise<void>((resolve) => { resolvePrompt = resolve; }),
    );

    const hub = new ChatSessionHub(silentLogger as never);
    const events: any[] = [];
    const attachment = hub.attach("p1", runtime.sessionRuntime, agentId, sessionId, (event) =>
      events.push(event),
    );
    await attachment.ready;
    expect(events[0]).toEqual({ type: "session_ready", lastSeq: -1, replay: true });
    expect(events.at(-1)).toEqual({ type: "run_status", active: false });
    events.length = 0;

    const entry = {
      id: "tr-log-vis",
      name: "log-vis-trigger",
      enabled: true,
      type: "event",
      eventName: "vis-evt",
      mode: "existing_session",
      targetSessionId: sessionId,
      message: "Hello {{payload}}",
      notify: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as never;
    runtime.triggerManager.create(agentId, entry);
    runtime.triggerManager.onUserEvent("vis-evt", "world");

    await vi.waitFor(() => {
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "user_message",
          source: "triggered",
          triggerName: "log-vis-trigger",
        }),
      );
      expect(events).toContainEqual({ type: "run_status", active: true });
    });
    expect(events.findIndex((e) => e.type === "user_message")).toBeLessThan(
      events.findIndex((e) => e.type === "run_status" && e.active === true),
    );

    const assistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: "done" }],
    };
    await vi.waitFor(() => expect(dispatch).toBeDefined());
    await dispatch?.({ type: "message_start", message: { ...assistantMessage } });
    await dispatch?.({ type: "message_end", message: assistantMessage });
    await dispatch?.({ type: "agent_end", messages: [] });
    resolvePrompt?.();

    await vi.waitFor(() => {
      expect(events).toContainEqual({ type: "run_status", active: false });
    });
    const persisted = store.readEvents(sessionId).find((e: any) => e.type === "user/message");
    expect(persisted.data.source).toBe("triggered");
    expect(persisted.data.triggerName).toBe("log-vis-trigger");

    const logStore = (runtime.triggerManager as any).getTriggerStore(agentId);
    await vi.waitFor(() => {
      const logs = logStore.getRecentLogs(20) as any[];
      expect(logs.some((l) => l.triggerId === "tr-log-vis" && l.status === "success")).toBe(true);
    });
    attachment.close();
  });
});
