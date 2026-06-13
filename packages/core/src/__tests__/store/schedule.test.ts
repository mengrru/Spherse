import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { ScheduleStore } from "../../store/schedule.js";
import type { ScheduleEntry } from "../../types.js";

function createAgentDir(agentsDir: string, agentId: string, name: string): string {
  const dir = path.join(agentsDir, `${name}-${agentId.slice(0, 6)}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "profile.md"),
    `---\nid: ${agentId}\nname: ${name}\ncreatedAt: ${Date.now()}\n---\nTest`,
  );
  return dir;
}

describe("ScheduleStore", () => {
  let store: ScheduleStore;
  let tmpDir: string;
  let agentsDir: string;
  const agentId = "test-agent-001";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-schedule-"));
    agentsDir = path.join(tmpDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    createAgentDir(agentsDir, agentId, "TestAgent");
    store = new ScheduleStore(agentsDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeEntry(overrides?: Partial<ScheduleEntry>): ScheduleEntry {
    return {
      id: crypto.randomUUID(),
      enabled: true,
      cron: "0 9 * * *",
      mode: "new_session",
      message: "Daily check {{date}}",
      notify: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides,
    };
  }

  it("returns empty list when no schedules exist", () => {
    expect(store.list(agentId)).toEqual([]);
  });

  it("creates and lists schedules", () => {
    const entry = makeEntry({ name: "Daily Review" });
    store.create(agentId, entry);
    const list = store.list(agentId);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Daily Review");
  });

  it("gets schedule by id", () => {
    const entry = makeEntry();
    store.create(agentId, entry);
    const found = store.get(agentId, entry.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(entry.id);
  });

  it("returns null for unknown schedule id", () => {
    expect(store.get(agentId, "nonexistent")).toBeNull();
  });

  it("updates a schedule", () => {
    const entry = makeEntry();
    store.create(agentId, entry);
    const updated = store.update(agentId, entry.id, { enabled: false, name: "Updated" });
    expect(updated!.enabled).toBe(false);
    expect(updated!.name).toBe("Updated");
  });

  it("returns null when updating nonexistent schedule", () => {
    expect(store.update(agentId, "nonexistent", { enabled: false })).toBeNull();
  });

  it("deletes a schedule", () => {
    const entry = makeEntry();
    store.create(agentId, entry);
    store.delete(agentId, entry.id);
    expect(store.list(agentId)).toEqual([]);
  });

  it("supports multiple schedules per agent", () => {
    store.create(agentId, makeEntry());
    store.create(agentId, makeEntry());
    expect(store.list(agentId)).toHaveLength(2);
  });

  it("appends and retrieves logs", () => {
    store.appendLog(agentId, { scheduleId: "sched-1", sessionId: "sess-1", triggeredAt: 1000, completedAt: 2000, status: "success" });
    store.appendLog(agentId, { scheduleId: "sched-1", sessionId: "sess-2", triggeredAt: 3000, status: "failed", error: "timeout" });
    const logs = store.getRecentLogs(agentId);
    expect(logs).toHaveLength(2);
    expect(logs[0].status).toBe("success");
    expect(logs[1].status).toBe("failed");
  });

  it("respects log limit", () => {
    for (let i = 0; i < 60; i++) {
      store.appendLog(agentId, { scheduleId: "sched-1", sessionId: `sess-${i}`, triggeredAt: i, status: "success" });
    }
    expect(store.getRecentLogs(agentId, 50)).toHaveLength(50);
  });

  it("returns empty logs when file does not exist", () => {
    expect(store.getRecentLogs(agentId)).toEqual([]);
  });

  it("does not resolve agent directories through symlinks", () => {
    fs.rmSync(agentsDir, { recursive: true, force: true });
    fs.mkdirSync(agentsDir, { recursive: true });
    const externalDir = path.join(tmpDir, "external-agent");
    fs.mkdirSync(externalDir, { recursive: true });
    fs.writeFileSync(
      path.join(externalDir, "profile.md"),
      `---\nid: ${agentId}\nname: Escaped\ncreatedAt: ${Date.now()}\n---\nTest`,
    );
    fs.symlinkSync(externalDir, path.join(agentsDir, "symlink-agent"), "dir");

    expect(() => store.create(agentId, makeEntry())).toThrow(/agent directory not found/);
    expect(fs.existsSync(path.join(externalDir, "schedules.yml"))).toBe(false);
  });
});
