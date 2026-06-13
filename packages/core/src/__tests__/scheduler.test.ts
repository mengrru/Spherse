import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { Scheduler } from "../scheduler.js";
import { createEngine } from "../factory.js";
import type { ScheduleEntry } from "../types.js";

function createAgentDir(agentsDir: string, agentId: string, name: string): void {
  const dir = path.join(agentsDir, `${name}-${agentId.slice(0, 6)}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "profile.md"),
    `---\nid: ${agentId}\nname: ${name}\nschedule: true\ncreatedAt: ${Date.now()}\n---\nTest prompt`,
  );
}

describe("Scheduler", () => {
  let scheduler: Scheduler;
  let tmpDir: string;
  let agentsDir: string;
  const agentId = "test-agent-sched";
  const otherAgentId = "other-agent-sched";

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-scheduler-"));
    agentsDir = path.join(tmpDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    createAgentDir(agentsDir, agentId, "SchedAgent");
    createAgentDir(agentsDir, otherAgentId, "OtherSchedAgent");

    const { engine } = await createEngine(tmpDir, { projectName: "Test" });
    scheduler = new Scheduler(engine, agentsDir);
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
    const engine = (scheduler as any).engine;
    const scheduler2 = new Scheduler(engine, agentsDir);
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

    scheduler.unregister(agentId, otherEntry.id);
    expect(scheduler.get(otherAgentId, otherEntry.id)).not.toBeNull();
    expect(scheduler.list(otherAgentId)).toHaveLength(1);
  });
});
