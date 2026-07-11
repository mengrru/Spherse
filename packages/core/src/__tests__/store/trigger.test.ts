import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { TriggerStore } from "../../store/trigger.js";
import type { TriggerEntry } from "../../types.js";

describe("TriggerStore", () => {
  let store: TriggerStore;
  let tmpDir: string;
  let agentDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-trigger-"));
    agentDir = path.join(tmpDir, "test-agent");
    fs.mkdirSync(agentDir, { recursive: true });
    store = new TriggerStore(agentDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeEntry(overrides?: Partial<TriggerEntry>): TriggerEntry {
    return {
      id: crypto.randomUUID(),
      enabled: true,
      type: "time",
      cron: "0 9 * * *",
      mode: "new_session",
      message: "Daily check {{date}}",
      notify: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides,
    };
  }

  it("returns empty list when no triggers exist", () => {
    expect(store.list()).toEqual([]);
  });

  it("creates and lists triggers", () => {
    const entry = makeEntry({ name: "Daily Review" });
    store.create(entry);
    const list = store.list();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Daily Review");
  });

  it("gets trigger by id", () => {
    const entry = makeEntry();
    store.create(entry);
    const found = store.get(entry.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(entry.id);
  });

  it("returns null for unknown trigger id", () => {
    expect(store.get("nonexistent")).toBeNull();
  });

  it("updates a trigger", () => {
    const entry = makeEntry();
    store.create(entry);
    const updated = store.update(entry.id, { enabled: false, name: "Updated" });
    expect(updated!.enabled).toBe(false);
    expect(updated!.name).toBe("Updated");
  });

  it("returns null when updating nonexistent trigger", () => {
    expect(store.update("nonexistent", { enabled: false })).toBeNull();
  });

  it("deletes a trigger", () => {
    const entry = makeEntry();
    store.create(entry);
    store.delete(entry.id);
    expect(store.list()).toEqual([]);
  });

  it("supports multiple triggers", () => {
    store.create(makeEntry());
    store.create(makeEntry());
    expect(store.list()).toHaveLength(2);
  });

  it("appends and retrieves logs", () => {
    store.appendLog({ triggerId: "trig-1", sessionId: "sess-1", triggeredAt: 1000, completedAt: 2000, status: "success" });
    store.appendLog({ triggerId: "trig-1", sessionId: "sess-2", triggeredAt: 3000, status: "failed", error: "timeout" });
    const logs = store.getRecentLogs();
    expect(logs).toHaveLength(2);
    expect(logs[0].status).toBe("success");
    expect(logs[1].status).toBe("failed");
  });

  it("respects log limit", () => {
    for (let i = 0; i < 60; i++) {
      store.appendLog({ triggerId: "trig-1", sessionId: `sess-${i}`, triggeredAt: i, status: "success" });
    }
    expect(store.getRecentLogs(50)).toHaveLength(50);
  });

  it("returns empty logs when file does not exist", () => {
    expect(store.getRecentLogs()).toEqual([]);
  });

  it("deletes all triggers and logs", () => {
    store.create(makeEntry());
    store.appendLog({ triggerId: "trig-1", sessionId: "sess-1", triggeredAt: 1000, status: "success" });
    store.deleteAll();
    expect(store.list()).toEqual([]);
    expect(store.getRecentLogs()).toEqual([]);
  });

  it("persists files under the triggers/ subdirectory", () => {
    store.create(makeEntry());
    store.appendLog({ triggerId: "trig-1", sessionId: "sess-1", triggeredAt: 1000, status: "success" });
    expect(fs.existsSync(path.join(agentDir, "triggers", "index.yml"))).toBe(true);
    expect(fs.existsSync(path.join(agentDir, "triggers", "logs.jsonl"))).toBe(true);
  });

  it("removes the triggers/ directory on deleteAll", () => {
    store.create(makeEntry());
    store.appendLog({ triggerId: "trig-1", sessionId: "sess-1", triggeredAt: 1000, status: "success" });
    const dir = path.join(agentDir, "triggers");
    expect(fs.existsSync(dir)).toBe(true);
    store.deleteAll();
    expect(fs.existsSync(dir)).toBe(false);
  });

});
