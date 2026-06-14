import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { createSilentLogger } from "../logger.js";
import { Scheduler } from "../scheduler.js";
import { createProject } from "../factory.js";
import type { ScheduleEntry } from "../types.js";

const SECOND_AGENT_PROFILE = `---
name: Second Agent
model: gemini-2.5-pro
tools:
  - read_file
---

Second agent for testing.`;

describe("Scheduler", () => {
  let scheduler: Scheduler;
  let tmpDir: string;
  let agentId: string;
  let otherAgentId: string;
  let sessionRuntime: any;
  let projectStore: any;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-scheduler-"));

    const runtime = await createProject(tmpDir, {
      projectName: "Test",
      logger: createSilentLogger(),
    });

    sessionRuntime = runtime.sessionRuntime;
    projectStore = (runtime.projectManager as any).projectStore;

    const presetAgents = [...projectStore.agents.keys()];
    agentId = presetAgents[0];

    const secondAgent = await projectStore.createAgent("second-agent", SECOND_AGENT_PROFILE);
    otherAgentId = secondAgent.getProfile().id;

    runtime.scheduler.stopAll();
    scheduler = new Scheduler(sessionRuntime, projectStore, createSilentLogger());
    await scheduler.loadFromAgents();
  });

  afterEach(() => {
    scheduler.stopAll();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeEntry(overrides?: Partial<ScheduleEntry>): ScheduleEntry {
    return {
      id: crypto.randomUUID(),
      enabled: true,
      cron: "0 9 * * *",
      mode: "new_session",
      message: "{{date}} {{weekday}}",
      notify: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides,
    };
  }

  it("registers and lists schedules", () => {
    const entry = makeEntry();
    scheduler.register(agentId, entry);
    expect(scheduler.list(agentId)).toHaveLength(1);
  });

  it("unregisters a schedule", () => {
    const entry = makeEntry();
    scheduler.register(agentId, entry);
    scheduler.unregister(agentId, entry.id);
    expect(scheduler.list(agentId)).toHaveLength(0);
  });

  it("updates and emits event", () => {
    const entry = makeEntry();
    scheduler.register(agentId, entry);
    const emitted = vi.fn();
    scheduler.on("schedule_updated", emitted);
    scheduler.update(agentId, entry.id, { enabled: false });
    expect(scheduler.list(agentId)[0].enabled).toBe(false);
    expect(emitted).toHaveBeenCalled();
  });

  it("returns null for next trigger when disabled", () => {
    const entry = makeEntry({ enabled: false });
    scheduler.register(agentId, entry);
    expect(scheduler.getNextTrigger(agentId, entry.id)).toBeNull();
  });

  it("computes next trigger from cron", () => {
    const entry = makeEntry({ cron: "*/30 * * * *" });
    scheduler.register(agentId, entry);
    const next = scheduler.getNextTrigger(agentId, entry.id);
    expect(next).not.toBeNull();
    expect(next!.getTime()).toBeGreaterThan(Date.now());
  });

  it("returns null for bad cron", () => {
    const entry = makeEntry({ cron: "invalid" });
    scheduler.register(agentId, entry);
    expect(scheduler.getNextTrigger(agentId, entry.id)).toBeNull();
  });

  it("persists schedules between instances", () => {
    const entry = makeEntry({ name: "Persisted" });
    scheduler.register(agentId, entry, true);

    const scheduler2 = new Scheduler(sessionRuntime, projectStore, createSilentLogger());
    const found = scheduler2.get(agentId, entry.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe("Persisted");
  });

  it("writes and reads logs", () => {
    scheduler.register(agentId, makeEntry());
    const logs = scheduler.getRecentLogs(agentId);
    expect(Array.isArray(logs)).toBe(true);
  });

  it("does not allow one agent to access another agent's schedule by id", () => {
    const otherEntry = makeEntry({ name: "Other Agent Schedule" });
    scheduler.register(otherAgentId, otherEntry);

    expect(scheduler.get(agentId, otherEntry.id)).toBeNull();
    expect(scheduler.update(agentId, otherEntry.id, { enabled: false })).toBeNull();
    expect(scheduler.triggerNow(agentId, otherEntry.id)).toBeNull();

    expect(scheduler.get(otherAgentId, otherEntry.id)).not.toBeNull();
    expect(scheduler.list(otherAgentId)).toHaveLength(1);
  });
});
