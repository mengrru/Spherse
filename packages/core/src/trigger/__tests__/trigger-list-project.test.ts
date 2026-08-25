import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
---

First agent for testing.`;

const SECOND_AGENT_PROFILE = `---
name: Second Agent
model: gemini-2.5-pro
---

Second agent for testing.`;

describe("TriggerManager.listProject", () => {
  let runtime: Awaited<ReturnType<typeof createProject>>;
  let triggerManager: TriggerManager;
  let tmpDir: string;
  let agentId: string;
  let otherAgentId: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-trigger-listproject-"));
    runtime = await createProject(tmpDir, {
      projectName: "Test",
      logger: createSilentLogger(),
    });
    const projectStore = (runtime.projectManager as any).projectStore;
    agentId = (await projectStore.createAgent("first-agent", FIRST_AGENT_PROFILE)).getProfile().id;
    otherAgentId = (await projectStore.createAgent("second-agent", SECOND_AGENT_PROFILE)).getProfile().id;
    runtime.timerService.stop();
    triggerManager = runtime.triggerManager;
  });

  afterEach(() => {
    triggerManager.stopAll();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function timeEntry(id: string): TriggerEntry {
    return {
      id,
      enabled: true,
      type: "time",
      cron: "0 9 * * *",
      mode: "new_session",
      message: "hello",
      notify: false,
      createdAt: 1,
      updatedAt: 1,
    };
  }

  function eventEntry(id: string): TriggerEntry {
    return {
      id,
      enabled: true,
      type: "event",
      eventName: "user-event",
      mode: "new_session",
      message: "hello",
      notify: false,
      createdAt: 1,
      updatedAt: 1,
    };
  }

  it("returns an empty list for a project without triggers", () => {
    expect(triggerManager.listProject()).toEqual([]);
  });

  it("merges triggers across agents with agentId attached", () => {
    triggerManager.create(agentId, timeEntry("t-a1"));
    triggerManager.create(otherAgentId, eventEntry("t-b1"));

    const result = triggerManager.listProject();

    expect(result).toHaveLength(2);
    const byId = Object.fromEntries(result.map((item) => [item.entry.id, item]));
    expect(byId["t-a1"].agentId).toBe(agentId);
    expect(byId["t-b1"].agentId).toBe(otherAgentId);
  });

  it("computes nextTriggerAt for enabled time triggers and null otherwise", () => {
    triggerManager.create(agentId, timeEntry("t-time"));
    triggerManager.create(otherAgentId, eventEntry("t-event"));

    const result = triggerManager.listProject();
    const byId = Object.fromEntries(result.map((item) => [item.entry.id, item]));

    expect(byId["t-time"].nextTriggerAt).toBeInstanceOf(Date);
    expect(byId["t-time"].nextTriggerAt!.getTime()).toBeGreaterThan(Date.now() - 1000);
    expect(byId["t-event"].nextTriggerAt).toBeNull();
  });

  it("returns null nextTriggerAt for disabled time triggers", () => {
    triggerManager.create(agentId, { ...timeEntry("t-off"), enabled: false });

    const [item] = triggerManager.listProject();

    expect(item.nextTriggerAt).toBeNull();
  });
});
