import { describe, it, expect, vi, beforeEach } from "vitest";
import { createManageTriggerTool, isManageTriggerWriteAction } from "../../tools/manage-trigger.js";
import type { TriggerManager } from "../../trigger/trigger-manager.js";
import type { ProjectStore } from "../../store/project.js";
import type { TriggerEntry } from "../../types.js";

const AGENT_ID = "agent-1";

function makeEntry(overrides: Partial<TriggerEntry> = {}): TriggerEntry {
  return {
    id: "trg-1",
    name: "Daily",
    enabled: true,
    type: "time",
    cron: "0 9 * * *",
    mode: "new_session",
    message: "Write the daily digest",
    notify: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("createManageTriggerTool", () => {
  let manager: {
    list: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    getNextTrigger: ReturnType<typeof vi.fn>;
  };
  let projectStore: ProjectStore;

  beforeEach(() => {
    manager = {
      list: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue(null),
      create: vi.fn(),
      update: vi.fn((_a: string, _t: string, patch: Partial<TriggerEntry>) => ({ ...makeEntry(), ...patch })),
      delete: vi.fn(),
      getNextTrigger: vi.fn().mockReturnValue(null),
    };
    projectStore = { getAgent: vi.fn().mockReturnValue({}) } as unknown as ProjectStore;
  });

  function makeTool(currentAgentId: string = AGENT_ID) {
    return createManageTriggerTool(manager as unknown as TriggerManager, projectStore, currentAgentId);
  }

  it("lists triggers of the current agent", async () => {
    manager.list.mockReturnValue([makeEntry()]);
    const result = await makeTool().execute("tc", { action: "list" }, undefined as any);
    expect(manager.list).toHaveBeenCalledWith(AGENT_ID);
    expect(result.content[0].text).toContain("trg-1");
  });

  it("rejects an unknown agent", async () => {
    (projectStore.getAgent as any).mockReturnValue(undefined);
    const result = await makeTool().execute("tc", { action: "list" }, undefined as any);
    expect(result.details.error).toBe(true);
    expect(result.content[0].text).toContain("not found");
  });

  it("rejects when no agent id is available", async () => {
    const tool = createManageTriggerTool(manager as unknown as TriggerManager, projectStore);
    const result = await tool.execute("tc", { action: "list" }, undefined as any);
    expect(result.details.error).toBe(true);
  });

  it("creates a time trigger with a generated id", async () => {
    const result = await makeTool().execute(
      "tc",
      {
        action: "create",
        type: "time",
        cron: "*/5 * * * *",
        mode: "new_session",
        message: "check inbox",
      },
      undefined as any,
    );
    expect(result.details.error).toBeUndefined();
    const [, entry] = manager.create.mock.calls[0];
    expect(entry.id).toBeTruthy();
    expect(entry.enabled).toBe(true);
    expect(entry.cron).toBe("*/5 * * * *");
    expect(entry.eventName).toBeUndefined();
    expect(entry.notify).toBe(false);
  });

  it("rejects an invalid cron expression", async () => {
    const result = await makeTool().execute(
      "tc",
      { action: "create", type: "time", cron: "not a cron", mode: "new_session", message: "m" },
      undefined as any,
    );
    expect(result.details.error).toBe(true);
    expect(manager.create).not.toHaveBeenCalled();
  });

  it("rejects reserved event names", async () => {
    const result = await makeTool().execute(
      "tc",
      { action: "create", type: "event", event_name: "sp:internal", mode: "new_session", message: "m" },
      undefined as any,
    );
    expect(result.details.error).toBe(true);
    expect(manager.create).not.toHaveBeenCalled();
  });

  it("requires target_session_id for existing_session mode", async () => {
    const result = await makeTool().execute(
      "tc",
      { action: "create", type: "event", event_name: "done", mode: "existing_session", message: "m" },
      undefined as any,
    );
    expect(result.details.error).toBe(true);
    expect(manager.create).not.toHaveBeenCalled();
  });

  it("rejects an over-long notification message", async () => {
    const result = await makeTool().execute(
      "tc",
      {
        action: "create",
        type: "time",
        cron: "0 9 * * *",
        mode: "new_session",
        message: "m",
        notify: true,
        notification_message: "x".repeat(31),
      },
      undefined as any,
    );
    expect(result.details.error).toBe(true);
  });

  it("patches only the supplied fields on update", async () => {
    manager.get.mockReturnValue(makeEntry());
    const result = await makeTool().execute(
      "tc",
      { action: "update", trigger_id: "trg-1", enabled: false },
      undefined as any,
    );
    expect(result.details.error).toBeUndefined();
    const [, , patch] = manager.update.mock.calls[0];
    expect(patch.enabled).toBe(false);
    expect(patch.message).toBe("Write the daily digest");
    expect(patch.cron).toBe("0 9 * * *");
  });

  it("clears cron when switching a trigger to event type", async () => {
    manager.get.mockReturnValue(makeEntry());
    await makeTool().execute(
      "tc",
      { action: "update", trigger_id: "trg-1", type: "event", event_name: "chapter-done" },
      undefined as any,
    );
    const [, , patch] = manager.update.mock.calls[0];
    expect(patch.cron).toBeUndefined();
    expect(patch.eventName).toBe("chapter-done");
  });

  it("rejects update of a missing trigger", async () => {
    manager.get.mockReturnValue(null);
    const result = await makeTool().execute(
      "tc",
      { action: "update", trigger_id: "nope", enabled: false },
      undefined as any,
    );
    expect(result.details.error).toBe(true);
    expect(manager.update).not.toHaveBeenCalled();
  });

  it("deletes an existing trigger", async () => {
    manager.get.mockReturnValue(makeEntry());
    const result = await makeTool().execute(
      "tc",
      { action: "delete", trigger_id: "trg-1" },
      undefined as any,
    );
    expect(manager.delete).toHaveBeenCalledWith(AGENT_ID, "trg-1");
    expect(result.details).toMatchObject({ triggerId: "trg-1" });
  });

  it("rejects delete without trigger_id", async () => {
    const result = await makeTool().execute("tc", { action: "delete" }, undefined as any);
    expect(result.details.error).toBe(true);
    expect(manager.delete).not.toHaveBeenCalled();
  });
});

describe("isManageTriggerWriteAction", () => {
  it("treats create/update/delete as write actions", () => {
    expect(isManageTriggerWriteAction({ action: "create" })).toBe(true);
    expect(isManageTriggerWriteAction({ action: "update" })).toBe(true);
    expect(isManageTriggerWriteAction({ action: "delete" })).toBe(true);
    expect(isManageTriggerWriteAction({ action: "list" })).toBe(false);
    expect(isManageTriggerWriteAction(undefined)).toBe(false);
  });
});
