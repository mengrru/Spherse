import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { createSilentLogger } from "../../logger.js";
import { TriggerManager } from "../../trigger/trigger-manager.js";
import { createProject } from "../../factory.js";
import type { TriggerEntry } from "../../types.js";

const FIRST_AGENT_PROFILE = `---
name: First Agent
model: gemini-2.5-pro
tools:
  - read_file
---

First agent for testing.`;

const SECOND_AGENT_PROFILE = `---
name: Second Agent
model: gemini-2.5-pro
tools:
  - read_file
---

Second agent for testing.`;

describe("TriggerManager", () => {
  let runtime: Awaited<ReturnType<typeof createProject>>;
  let triggerManager: TriggerManager;
  let tmpDir: string;
  let agentId: string;
  let otherAgentId: string;
  let sessionRuntime: any;
  let projectStore: any;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-trigger-mgr-"));

    runtime = await createProject(tmpDir, {
      projectName: "Test",
      logger: createSilentLogger(),
    });

    sessionRuntime = runtime.sessionRuntime;
    projectStore = (runtime.projectManager as any).projectStore;

    const firstAgent = await projectStore.createAgent("first-agent", FIRST_AGENT_PROFILE);
    agentId = firstAgent.getProfile().id;

    const secondAgent = await projectStore.createAgent("second-agent", SECOND_AGENT_PROFILE);
    otherAgentId = secondAgent.getProfile().id;

    runtime.timerService.stop();
    triggerManager = runtime.triggerManager;
  });

  afterEach(() => {
    triggerManager.stopAll();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeTimeEntry(overrides?: Partial<TriggerEntry>): TriggerEntry {
    return {
      id: crypto.randomUUID(),
      enabled: true,
      type: "time",
      cron: "0 9 * * *",
      mode: "new_session",
      message: "{{date}} {{weekday}}",
      notify: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides,
    };
  }

  function makeEventEntry(overrides?: Partial<TriggerEntry>): TriggerEntry {
    return {
      id: crypto.randomUUID(),
      enabled: true,
      type: "event",
      eventName: "test-event",
      mode: "new_session",
      message: "Event fired: {{payload}}",
      notify: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides,
    };
  }

  it("creates and lists triggers", () => {
    const entry = makeTimeEntry();
    triggerManager.create(agentId, entry);
    expect(triggerManager.list(agentId)).toHaveLength(1);
  });

  it("deletes a trigger", () => {
    const entry = makeTimeEntry();
    triggerManager.create(agentId, entry);
    triggerManager.delete(agentId, entry.id);
    expect(triggerManager.list(agentId)).toHaveLength(0);
  });

  it("updates and emits event", () => {
    const entry = makeTimeEntry();
    triggerManager.create(agentId, entry);
    const emitted = vi.fn();
    triggerManager.on("trigger_updated", emitted);
    triggerManager.update(agentId, entry.id, { enabled: false });
    expect(triggerManager.list(agentId)[0].enabled).toBe(false);
    expect(emitted).toHaveBeenCalled();
  });

  it("returns null for next trigger when disabled", () => {
    const entry = makeTimeEntry({ enabled: false });
    triggerManager.create(agentId, entry);
    expect(triggerManager.getNextTrigger(agentId, entry.id)).toBeNull();
  });

  it("returns null for next trigger on event type", () => {
    const entry = makeEventEntry();
    triggerManager.create(agentId, entry);
    expect(triggerManager.getNextTrigger(agentId, entry.id)).toBeNull();
  });

  it("computes next trigger from cron for time type", () => {
    const entry = makeTimeEntry({ cron: "*/30 * * * *" });
    triggerManager.create(agentId, entry);
    const next = triggerManager.getNextTrigger(agentId, entry.id);
    expect(next).not.toBeNull();
    expect(next!.getTime()).toBeGreaterThan(Date.now());
  });

  it("returns null for bad cron", () => {
    const entry = makeTimeEntry({ cron: "invalid" });
    triggerManager.create(agentId, entry);
    expect(triggerManager.getNextTrigger(agentId, entry.id)).toBeNull();
  });

  it("reads triggers from disk (no register needed)", () => {
    const entry = makeTimeEntry({ name: "Disk Trigger" });
    triggerManager.create(agentId, entry);

    const newManager = new TriggerManager({
      sessionRuntime,
      projectStore,
      logger: createSilentLogger(),
    });
    const found = newManager.get(agentId, entry.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe("Disk Trigger");
  });

  it("writes and reads logs", () => {
    triggerManager.create(agentId, makeTimeEntry());
    const logs = triggerManager.getRecentLogs(agentId);
    expect(Array.isArray(logs)).toBe(true);
  });

  it("does not allow one agent to access another agent's trigger by id", () => {
    const otherEntry = makeTimeEntry({ name: "Other Agent Trigger" });
    triggerManager.create(otherAgentId, otherEntry);

    expect(triggerManager.get(agentId, otherEntry.id)).toBeNull();
    expect(triggerManager.update(agentId, otherEntry.id, { enabled: false })).toBeNull();
    expect(triggerManager.runNow(agentId, otherEntry.id)).toBeNull();

    expect(triggerManager.get(otherAgentId, otherEntry.id)).not.toBeNull();
    expect(triggerManager.list(otherAgentId)).toHaveLength(1);
  });

  it("onUserEvent fires matching event triggers", async () => {
    const sendMessageSpy = vi.spyOn(sessionRuntime, "sendMessage").mockResolvedValue(undefined);
    const createSessionSpy = vi.spyOn(sessionRuntime, "createSession").mockResolvedValue("fake-session");
    vi.spyOn(sessionRuntime, "restoreSession").mockResolvedValue("fake-session");

    const entry = makeEventEntry({ eventName: "user-login", message: "Hello {{payload}}" });
    triggerManager.create(agentId, entry);

    triggerManager.onUserEvent("user-login", "Alice");
    await new Promise((r) => setTimeout(r, 0));

    expect(createSessionSpy).toHaveBeenCalledWith(agentId, "triggered");
    expect(sendMessageSpy).toHaveBeenCalledWith(
      "fake-session",
      "Hello Alice",
      [],
      expect.any(Function),
      { source: "triggered", triggerName: "user-login", agentId },
    );

    sendMessageSpy.mockRestore();
    createSessionSpy.mockRestore();
  });

  it("onUserEvent does not fire non-matching event triggers", () => {
    const sendMessageSpy = vi.spyOn(sessionRuntime, "sendMessage").mockResolvedValue(undefined);

    const entry = makeEventEntry({ eventName: "user-login" });
    triggerManager.create(agentId, entry);

    triggerManager.onUserEvent("different-event", "test");

    expect(sendMessageSpy).not.toHaveBeenCalled();
    sendMessageSpy.mockRestore();
  });

  it("onUserEvent rejects sp: reserved prefix", () => {
    const sendMessageSpy = vi.spyOn(sessionRuntime, "sendMessage").mockResolvedValue(undefined);

    const entry = makeEventEntry({ eventName: "user-login" });
    triggerManager.create(agentId, entry);

    triggerManager.onUserEvent("sp:time-tick", "test");

    expect(sendMessageSpy).not.toHaveBeenCalled();
    sendMessageSpy.mockRestore();
  });

  it("onUserEvent fires event trigger with empty payload when none provided", async () => {
    const sendMessageSpy = vi.spyOn(sessionRuntime, "sendMessage").mockResolvedValue(undefined);
    vi.spyOn(sessionRuntime, "createSession").mockResolvedValue("fake-session");

    const entry = makeEventEntry({ message: "Payload: [{{payload}}]" });
    triggerManager.create(agentId, entry);

    triggerManager.onUserEvent("test-event", "");
    await new Promise((r) => setTimeout(r, 0));

    expect(sendMessageSpy).toHaveBeenCalledWith(
      "fake-session",
      "Payload: []",
      [],
      expect.any(Function),
      { source: "triggered", triggerName: "test-event", agentId },
    );
    sendMessageSpy.mockRestore();
  });

  it("onTimeTick fires time triggers with due cron", async () => {
    const sendMessageSpy = vi.spyOn(sessionRuntime, "sendMessage").mockResolvedValue(undefined);
    vi.spyOn(sessionRuntime, "createSession").mockResolvedValue("fake-session");

    const future = new Date(Date.now() + 2 * 60 * 1000);
    const cronStr = `${future.getMinutes()} ${future.getHours()} * * *`;
    const entry = makeTimeEntry({ cron: cronStr });
    triggerManager.create(agentId, entry);

    try {
      triggerManager.onTimeTick();
      vi.setSystemTime(Date.now() + 5 * 60 * 1000);
      triggerManager.onTimeTick();
      await new Promise((r) => setTimeout(r, 0));
      expect(sendMessageSpy).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      sendMessageSpy.mockRestore();
    }
  });

  it("onTimeTick fires the occurrence scheduled shortly after a cron change", async () => {
    const sendMessageSpy = vi.spyOn(sessionRuntime, "sendMessage").mockResolvedValue(undefined);
    vi.spyOn(sessionRuntime, "createSession").mockResolvedValue("fake-session");

    const start = Date.now();
    const farCron = "0 0 1 1 2099";
    const near = new Date(start + 2 * 60 * 1000);
    const nearCron = `${near.getMinutes()} ${near.getHours()} * * *`;
    const entry = makeTimeEntry({ cron: farCron });
    triggerManager.create(agentId, entry);

    try {
      triggerManager.onTimeTick();
      vi.setSystemTime(start + 30_000);
      triggerManager.update(agentId, entry.id, { cron: nearCron });
      vi.setSystemTime(start + 5 * 60 * 1000);
      triggerManager.onTimeTick();
      await new Promise((r) => setTimeout(r, 0));
      expect(sendMessageSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      sendMessageSpy.mockRestore();
    }
  });

  it("does not fire a cached occurrence that elapsed while the trigger was disabled", async () => {
    const sendMessageSpy = vi.spyOn(sessionRuntime, "sendMessage").mockResolvedValue(undefined);
    vi.spyOn(sessionRuntime, "createSession").mockResolvedValue("fake-session");

    const start = Date.now();
    const near = new Date(start + 2 * 60 * 1000);
    const cronStr = `${near.getMinutes()} ${near.getHours()} * * *`;
    const entry = makeTimeEntry({ cron: cronStr });
    triggerManager.create(agentId, entry);

    try {
      triggerManager.onTimeTick();
      vi.setSystemTime(start + 30_000);
      triggerManager.update(agentId, entry.id, { enabled: false });
      vi.setSystemTime(start + 3 * 60 * 1000);
      triggerManager.update(agentId, entry.id, { enabled: true });
      triggerManager.onTimeTick();
      await new Promise((r) => setTimeout(r, 0));
      expect(sendMessageSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      sendMessageSpy.mockRestore();
    }
  });

  it("onTimeTick does not fire event type triggers", () => {
    const sendMessageSpy = vi.spyOn(sessionRuntime, "sendMessage").mockResolvedValue(undefined);

    const entry = makeEventEntry();
    triggerManager.create(agentId, entry);

    triggerManager.onTimeTick();
    expect(sendMessageSpy).not.toHaveBeenCalled();
    sendMessageSpy.mockRestore();
  });

  it("runNow manually fires a trigger", async () => {
    const sendMessageSpy = vi.spyOn(sessionRuntime, "sendMessage").mockResolvedValue(undefined);
    vi.spyOn(sessionRuntime, "createSession").mockResolvedValue("fake-session");

    const entry = makeTimeEntry({ cron: "0 9 1 1 2099" });
    triggerManager.create(agentId, entry);

    triggerManager.runNow(agentId, entry.id);
    await new Promise((r) => setTimeout(r, 0));
    expect(sendMessageSpy).toHaveBeenCalled();
    sendMessageSpy.mockRestore();
  });

  it("emits trigger_triggered lifecycle event", () => {
    vi.spyOn(sessionRuntime, "sendMessage").mockResolvedValue(undefined);
    vi.spyOn(sessionRuntime, "createSession").mockResolvedValue("fake-session");

    const entry = makeEventEntry();
    triggerManager.create(agentId, entry);

    const handler = vi.fn();
    triggerManager.on("trigger_triggered", handler);

    triggerManager.onUserEvent("test-event", "data");
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ agentId, triggerId: entry.id }),
    );

    vi.restoreAllMocks();
  });

  it("deleteAllForAgent removes all triggers for an agent", () => {
    triggerManager.create(agentId, makeTimeEntry());
    triggerManager.create(agentId, makeEventEntry());
    triggerManager.create(otherAgentId, makeTimeEntry());

    triggerManager.deleteAllForAgent(agentId);
    expect(triggerManager.list(agentId)).toHaveLength(0);
    expect(triggerManager.list(otherAgentId)).toHaveLength(1);
  });

  it("existing_session restores the configured target session", async () => {
    const targetId = await sessionRuntime.createSession(agentId);
    const restoreSessionSpy = vi.spyOn(sessionRuntime, "restoreSession").mockResolvedValue(targetId);
    const sendMessageSpy = vi.spyOn(sessionRuntime, "sendMessage").mockResolvedValue(undefined);
    const createSessionSpy = vi.spyOn(sessionRuntime, "createSession").mockResolvedValue("nope");

    const entry = makeEventEntry({ mode: "existing_session", targetSessionId: targetId });
    triggerManager.create(agentId, entry);

    triggerManager.onUserEvent("test-event", "data");
    await new Promise((r) => setTimeout(r, 0));

    expect(restoreSessionSpy).toHaveBeenCalledWith(agentId, targetId);
    expect(createSessionSpy).not.toHaveBeenCalled();

    restoreSessionSpy.mockRestore();
    createSessionSpy.mockRestore();
    sendMessageSpy.mockRestore();
  });

  it("existing_session fails when the target session is not active", async () => {
    const targetId = await sessionRuntime.createSession(agentId);
    runtime.deleteSession(agentId, targetId);

    const entry = makeEventEntry({ mode: "existing_session", targetSessionId: targetId });
    triggerManager.create(agentId, entry);

    const sendMessageSpy = vi.spyOn(sessionRuntime, "sendMessage").mockResolvedValue(undefined);

    triggerManager.onUserEvent("test-event", "data");
    await new Promise((r) => setTimeout(r, 0));

    expect(sendMessageSpy).not.toHaveBeenCalled();
    const logs = triggerManager.getRecentLogs(agentId, 1);
    expect(logs[0]).toMatchObject({ status: "failed", triggerId: entry.id });

    sendMessageSpy.mockRestore();
  });

  it("reusable_session creates and binds a session on first fire", async () => {
    const createSessionSpy = vi.spyOn(sessionRuntime, "createSession").mockResolvedValue("new-sess");
    const sendMessageSpy = vi.spyOn(sessionRuntime, "sendMessage").mockResolvedValue(undefined);

    const entry = makeEventEntry({ mode: "reusable_session" });
    triggerManager.create(agentId, entry);

    triggerManager.onUserEvent("test-event", "data");
    await new Promise((r) => setTimeout(r, 0));

    expect(createSessionSpy).toHaveBeenCalledWith(agentId, "triggered");
    expect(triggerManager.get(agentId, entry.id)?.boundSessionId).toBe("new-sess");

    createSessionSpy.mockRestore();
    sendMessageSpy.mockRestore();
  });

  it("reusable_session binding does not emit trigger_updated", async () => {
    vi.spyOn(sessionRuntime, "createSession").mockResolvedValue("new-sess");
    vi.spyOn(sessionRuntime, "sendMessage").mockResolvedValue(undefined);

    const entry = makeEventEntry({ mode: "reusable_session" });
    triggerManager.create(agentId, entry);

    const updated = vi.fn();
    triggerManager.on("trigger_updated", updated);

    triggerManager.onUserEvent("test-event", "data");
    await new Promise((r) => setTimeout(r, 0));

    expect(triggerManager.get(agentId, entry.id)?.boundSessionId).toBe("new-sess");
    expect(updated).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it("reusable_session reuses the bound session on subsequent fire", async () => {
    const createSessionSpy = vi.spyOn(sessionRuntime, "createSession").mockResolvedValue("should-not-happen");
    const restoreSessionSpy = vi.spyOn(sessionRuntime, "restoreSession").mockResolvedValue("bound-sess");
    const sendMessageSpy = vi.spyOn(sessionRuntime, "sendMessage").mockResolvedValue(undefined);
    vi.spyOn(sessionRuntime, "sessionExists").mockReturnValue(true);

    const entry = makeEventEntry({ mode: "reusable_session", boundSessionId: "bound-sess" });
    triggerManager.create(agentId, entry);

    triggerManager.onUserEvent("test-event", "data");
    await new Promise((r) => setTimeout(r, 0));

    expect(restoreSessionSpy).toHaveBeenCalledWith(agentId, "bound-sess");
    expect(createSessionSpy).not.toHaveBeenCalled();
    expect(triggerManager.get(agentId, entry.id)?.boundSessionId).toBe("bound-sess");

    createSessionSpy.mockRestore();
    restoreSessionSpy.mockRestore();
    sendMessageSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("reusable_session recreates when the bound session no longer exists", async () => {
    const createSessionSpy = vi.spyOn(sessionRuntime, "createSession").mockResolvedValue("fresh-sess");
    const restoreSessionSpy = vi.spyOn(sessionRuntime, "restoreSession").mockResolvedValue("fresh-sess");
    vi.spyOn(sessionRuntime, "sendMessage").mockResolvedValue(undefined);
    vi.spyOn(sessionRuntime, "sessionExists").mockReturnValue(false);

    const entry = makeEventEntry({ mode: "reusable_session", boundSessionId: "gone-sess" });
    triggerManager.create(agentId, entry);

    triggerManager.onUserEvent("test-event", "data");
    await new Promise((r) => setTimeout(r, 0));

    expect(createSessionSpy).toHaveBeenCalledWith(agentId, "triggered");
    expect(triggerManager.get(agentId, entry.id)?.boundSessionId).toBe("fresh-sess");

    createSessionSpy.mockRestore();
    restoreSessionSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("does not double-bind when a reusable_session trigger fires while one is in progress", async () => {
    let resolveCreate: (id: string) => void = () => {};
    const createSessionSpy = vi.spyOn(sessionRuntime, "createSession").mockImplementation(
      () =>
        new Promise<string>((r) => {
          resolveCreate = r;
        }),
    );
    vi.spyOn(sessionRuntime, "sendMessage").mockResolvedValue(undefined);

    const entry = makeEventEntry({ mode: "reusable_session" });
    triggerManager.create(agentId, entry);

    triggerManager.onUserEvent("test-event", "1");
    triggerManager.onUserEvent("test-event", "2");

    expect(createSessionSpy).toHaveBeenCalledTimes(1);

    resolveCreate("new-sess");
    await new Promise((r) => setTimeout(r, 0));

    expect(triggerManager.get(agentId, entry.id)?.boundSessionId).toBe("new-sess");

    createSessionSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("reusable_session rebinds lazily after the bound session is deleted", async () => {
    const sessionId = await sessionRuntime.createSession(agentId);
    const entry = makeEventEntry({ mode: "reusable_session", boundSessionId: sessionId });
    triggerManager.create(agentId, entry);

    runtime.deleteSession(agentId, sessionId);

    expect(triggerManager.get(agentId, entry.id)?.boundSessionId).toBe(sessionId);
    expect(sessionRuntime.sessionExists(agentId, sessionId)).toBe(false);

    const createSessionSpy = vi.spyOn(sessionRuntime, "createSession").mockResolvedValue("fresh-sess");
    const sendMessageSpy = vi.spyOn(sessionRuntime, "sendMessage").mockResolvedValue(undefined);

    triggerManager.onUserEvent("test-event", "data");
    await new Promise((r) => setTimeout(r, 0));

    expect(createSessionSpy).toHaveBeenCalledWith(agentId, "triggered");
    expect(triggerManager.get(agentId, entry.id)?.boundSessionId).toBe("fresh-sess");

    createSessionSpy.mockRestore();
    sendMessageSpy.mockRestore();
  });
});
