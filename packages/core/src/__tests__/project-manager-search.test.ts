import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ProjectStore } from "../store/project.js";
import { ProjectManager } from "../project-manager.js";
import { FileWriteMutex } from "../utils/file-write-mutex.js";
import { createSilentLogger } from "../logger.js";
import type { SessionEvent } from "../session/events.js";

const PROFILE_A = `---
name: Agent A
model: gemini-2.5-pro
---

You are agent A.`;

const PROFILE_B = `---
name: Agent B
model: gemini-2.5-pro
---

You are agent B.`;

describe("ProjectManager.searchProjectMessages", () => {
  let tmpDir: string;
  let store: ProjectStore;
  let pm: ProjectManager;
  let agentA: string;
  let agentB: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-pm-search-"));
    store = new ProjectStore(tmpDir, createSilentLogger());
    await store.create("Test");
    pm = new ProjectManager(store, createSilentLogger(), new FileWriteMutex());
    agentA = (await store.createAgent(undefined, PROFILE_A)).getProfile().id;
    agentB = (await store.createAgent(undefined, PROFILE_B)).getProfile().id;
  });

  afterEach(async () => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function seedMessage(agentId: string, time: number, text: string): void {
    const agentStore = store.getAgent(agentId)!;
    const sessionId = agentStore.sessions.createSession(`s-${time}`);
    const event = {
      type: "user/message",
      seq: 0,
      time,
      data: { message: { role: "user", content: text, timestamp: time } },
    } as SessionEvent;
    agentStore.sessions.appendEvents(sessionId, [event], 1);
  }

  it("merges hits across agents sorted by time desc and attaches agentId", () => {
    seedMessage(agentA, 100, "needle from A");
    seedMessage(agentB, 200, "needle from B");
    seedMessage(agentA, 300, "unrelated");

    const hits = pm.searchProjectMessages("needle", 50);
    expect(hits.map((hit) => [hit.agentId, hit.snippet])).toEqual([
      [agentB, "needle from B"],
      [agentA, "needle from A"],
    ]);
  });

  it("returns empty for blank query and slices to limit", () => {
    seedMessage(agentA, 100, "needle one");
    seedMessage(agentB, 200, "needle two");
    expect(pm.searchProjectMessages("   ", 50)).toEqual([]);
    expect(pm.searchProjectMessages("needle", 1)).toHaveLength(1);
  });
});
