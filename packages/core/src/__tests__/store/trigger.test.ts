import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { TriggerStore } from "../../store/trigger.js";
import { NodeFsPort } from "../../store/node-fs-port.js";
import type { TriggerEntry } from "../../types.js";

describe("TriggerStore", () => {
  let store: TriggerStore;
  let tmpDir: string;
  let agentDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-trigger-"));
    agentDir = path.join(tmpDir, "test-agent");
    fs.mkdirSync(agentDir, { recursive: true });
    store = new TriggerStore(new NodeFsPort(tmpDir), "test-agent");
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

  it("returns empty list when no triggers exist", async () => {
    expect(await store.list()).toEqual([]);
  });

  it("creates and lists triggers", async () => {
    const entry = makeEntry({ name: "Daily Review" });
    await store.create(entry);
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Daily Review");
  });

  it("gets trigger by id", async () => {
    const entry = makeEntry();
    await store.create(entry);
    const found = await store.get(entry.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(entry.id);
  });

  it("returns null for unknown trigger id", async () => {
    expect(await store.get("nonexistent")).toBeNull();
  });

  it("updates a trigger", async () => {
    const entry = makeEntry();
    await store.create(entry);
    const updated = await store.update(entry.id, { enabled: false, name: "Updated" });
    expect(updated!.enabled).toBe(false);
    expect(updated!.name).toBe("Updated");
  });

  it("returns null when updating nonexistent trigger", async () => {
    expect(await store.update("nonexistent", { enabled: false })).toBeNull();
  });

  it("deletes a trigger", async () => {
    const entry = makeEntry();
    await store.create(entry);
    await store.delete(entry.id);
    expect(await store.list()).toEqual([]);
  });

  it("supports multiple triggers", async () => {
    await store.create(makeEntry());
    await store.create(makeEntry());
    expect(await store.list()).toHaveLength(2);
  });

  it("appends and retrieves logs", async () => {
    await store.appendLog({ triggerId: "trig-1", sessionId: "sess-1", triggeredAt: 1000, completedAt: 2000, status: "success" });
    await store.appendLog({ triggerId: "trig-1", sessionId: "sess-2", triggeredAt: 3000, status: "failed", error: "timeout" });
    const logs = await store.getRecentLogs();
    expect(logs).toHaveLength(2);
    expect(logs[0].status).toBe("success");
    expect(logs[1].status).toBe("failed");
  });

  it("respects log limit", async () => {
    for (let i = 0; i < 60; i++) {
      await store.appendLog({ triggerId: "trig-1", sessionId: `sess-${i}`, triggeredAt: i, status: "success" });
    }
    expect(await store.getRecentLogs(50)).toHaveLength(50);
  });

  it("returns empty logs when file does not exist", async () => {
    expect(await store.getRecentLogs()).toEqual([]);
  });

  it("deletes all triggers and logs", async () => {
    await store.create(makeEntry());
    await store.appendLog({ triggerId: "trig-1", sessionId: "sess-1", triggeredAt: 1000, status: "success" });
    await store.deleteAll();
    expect(await store.list()).toEqual([]);
    expect(await store.getRecentLogs()).toEqual([]);
  });

  it("persists files under the triggers/ subdirectory", async () => {
    await store.create(makeEntry());
    await store.appendLog({ triggerId: "trig-1", sessionId: "sess-1", triggeredAt: 1000, status: "success" });
    expect(fs.existsSync(path.join(agentDir, "triggers", "index.yml"))).toBe(true);
    expect(fs.existsSync(path.join(agentDir, "triggers", "logs.jsonl"))).toBe(true);
  });

  it("removes the triggers/ directory on deleteAll", async () => {
    await store.create(makeEntry());
    await store.appendLog({ triggerId: "trig-1", sessionId: "sess-1", triggeredAt: 1000, status: "success" });
    const dir = path.join(agentDir, "triggers");
    expect(fs.existsSync(dir)).toBe(true);
    await store.deleteAll();
    expect(fs.existsSync(dir)).toBe(false);
  });

});
