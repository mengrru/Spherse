import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ProjectStore } from "../store/project.js";
import { ProjectManager } from "../project-manager.js";
import { FileWriteMutex } from "../utils/file-write-mutex.js";
import { createSilentLogger } from "../logger.js";
import type { SessionChangePayload } from "../store/session.js";

const PROFILE = `---
name: Agent A
model: gemini-2.5-pro
---

You are agent A.`;

describe("ProjectManager.onSessionChange", () => {
  let tmpDir: string;
  let pm: ProjectManager;
  let store: ProjectStore;
  let agentId: string;
  let listener: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-pm-session-events-"));
    store = new ProjectStore(tmpDir, createSilentLogger());
    await store.create("Test");
    pm = new ProjectManager(store, createSilentLogger(), new FileWriteMutex());
    agentId = (await store.createAgent(undefined, PROFILE)).getProfile().id;
    listener = vi.fn();
    pm.onSessionChange(listener);
  });

  afterEach(async () => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("emits created when a session is created", () => {
    const sessionId = store.getAgent(agentId)!.sessions.createSession("s1");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      agentId,
      sessionId,
      action: "created",
    } satisfies SessionChangePayload);
  });

  it("emits updated when a session is renamed", () => {
    const sessionId = store.getAgent(agentId)!.sessions.createSession("s1");
    listener.mockClear();

    pm.renameSession(agentId, sessionId, "renamed");

    expect(listener).toHaveBeenCalledWith({
      agentId,
      sessionId,
      action: "updated",
    } satisfies SessionChangePayload);
  });

  it("emits deleted when a session is deleted", () => {
    const sessionId = store.getAgent(agentId)!.sessions.createSession("s1");
    listener.mockClear();

    pm.deleteSession(agentId, sessionId);

    expect(listener).toHaveBeenCalledWith({
      agentId,
      sessionId,
      action: "deleted",
    } satisfies SessionChangePayload);
  });

  it("does not emit when store-level rename/archive hits a missing session", () => {
    const sessions = store.getAgent(agentId)!.sessions;
    sessions.updateSessionTitle("nope", "title");
    sessions.archiveSession("nope");

    expect(listener).not.toHaveBeenCalled();
  });

  it("stops delivering after offSessionChange", () => {
    pm.offSessionChange(listener);
    store.getAgent(agentId)!.sessions.createSession("s1");

    expect(listener).not.toHaveBeenCalled();
  });

  it("delivers events for agents created after subscription", async () => {
    const second = (await store.createAgent(undefined, PROFILE.replace("agent A", "agent B"))).getProfile();
    const sessionId = store.getAgent(second.id)!.sessions.createSession();

    expect(listener).toHaveBeenCalledWith({
      agentId: second.id,
      sessionId,
      action: "created",
    } satisfies SessionChangePayload);
  });
});
