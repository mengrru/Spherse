import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ProjectStore } from "../store/project.js";
import { ProjectManager } from "../project-manager.js";
import { FileWriteMutex } from "../utils/file-write-mutex.js";
import { createSilentLogger } from "../logger.js";

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

describe("ProjectManager.listProjectSessions", () => {
  let tmpDir: string;
  let pm: ProjectManager;
  let store: ProjectStore;
  let agentA: string;
  let agentB: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-pm-sessions-"));
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

  function seed(agentId: string, count: number): string[] {
    const agentStore = store.getAgent(agentId)!;
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const id = agentStore.sessions.createSession(`s-${agentId}-${i}`);
      ids.push(id);
    }
    return ids;
  }

  it("returns an empty catalog for a project without sessions", () => {
    const result = pm.listProjectSessions(10);
    expect(result.sessions).toEqual([]);
    expect(result.byAgent).toEqual({});
  });

  it("merges sessions across agents ordered by updatedAt DESC then id DESC", async () => {
    const aIds = seed(agentA, 2);
    const bIds = seed(agentB, 2);
    const aSessions = aIds.map((id) => pm.getSession(agentA, id)!);
    const bSessions = bIds.map((id) => pm.getSession(agentB, id)!);

    const result = pm.listProjectSessions(10);

    expect(result.sessions).toHaveLength(4);
    const ids = result.sessions.map((session) => session.id);
    const all = [...aSessions, ...bSessions].sort((x, y) =>
      y.updatedAt - x.updatedAt || (y.id < x.id ? -1 : y.id > x.id ? 1 : 0),
    );
    expect(ids).toEqual(all.map((session) => session.id));
    ids.forEach((id, index) => {
      if (index === 0) return;
      const prev = result.sessions[index - 1];
      const current = result.sessions[index];
      expect(
        prev.updatedAt > current.updatedAt ||
          (prev.updatedAt === current.updatedAt && prev.id > current.id),
      ).toBe(true);
    });
  });

  it("caps each agent at perPage and reports hasMore with loaded counts", () => {
    seed(agentA, 3);
    seed(agentB, 1);

    const result = pm.listProjectSessions(2);

    expect(result.sessions).toHaveLength(3);
    expect(result.byAgent[agentA]).toEqual({ hasMore: true, loaded: 2 });
    expect(result.byAgent[agentB]).toEqual({ hasMore: false, loaded: 1 });
  });

  it("omits agents without sessions from byAgent", () => {
    seed(agentA, 1);

    const result = pm.listProjectSessions(10);

    expect(result.byAgent[agentA]).toEqual({ hasMore: false, loaded: 1 });
    expect(Object.keys(result.byAgent)).toEqual([agentA]);
  });

  it("clamps perPage below one to one", () => {
    seed(agentA, 2);

    const result = pm.listProjectSessions(0);

    expect(result.byAgent[agentA]).toEqual({ hasMore: true, loaded: 1 });
  });

  it("does not leak sessions of deleted or unknown agents", () => {
    const result = pm.listProjectSessions(10);
    const unknown = pm.listSessions("no-such-agent");
    expect(unknown).toEqual([]);
    expect(result.byAgent["no-such-agent"]).toBeUndefined();
  });
});
