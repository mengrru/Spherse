import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../lib/api";
import type { TriggerInfo } from "../../lib/types";
import { useTriggerStore } from "./store";
import { useProjectDataStore } from "../../stores/project-data-store";

function makeTrigger(overrides: Partial<TriggerInfo>): TriggerInfo {
  return {
    id: "trig-1",
    enabled: false,
    type: "time",
    cron: "0 9 * * *",
    mode: "new_session",
    message: "hi",
    notify: false,
    createdAt: 1,
    updatedAt: 1,
    nextTriggerAt: null,
    ...overrides,
  } as TriggerInfo;
}

function createClient(listTriggersReturn: TriggerInfo[]): ApiClient {
  return {
    listTriggers: vi.fn().mockResolvedValue(listTriggersReturn),
    createTrigger: vi.fn().mockResolvedValue(undefined),
    updateTrigger: vi.fn().mockResolvedValue(undefined),
    deleteTrigger: vi.fn().mockResolvedValue(undefined),
    runTrigger: vi.fn().mockResolvedValue(undefined),
  } as unknown as ApiClient;
}

describe("useTriggerStore", () => {
  beforeEach(() => {
    useTriggerStore.setState({ byProject: {} });
    useProjectDataStore.setState({ projects: {} });
  });

  it("writes hasEnabledTriggers=true to project-data-store when refreshTriggers finds an enabled trigger", async () => {
    const client = createClient([makeTrigger({ enabled: true })]);

    await useTriggerStore.getState().refreshTriggers("project-1", client, "agent-1");

    expect(useProjectDataStore.getState().projects["project-1"]?.hasEnabledTriggersByAgent?.["agent-1"]).toBe(true);
  });

  it("writes hasEnabledTriggers=false when all triggers are disabled", async () => {
    const client = createClient([makeTrigger({ enabled: false }), makeTrigger({ id: "trig-2", enabled: false })]);

    await useTriggerStore.getState().refreshTriggers("project-1", client, "agent-1");

    expect(useProjectDataStore.getState().projects["project-1"]?.hasEnabledTriggersByAgent?.["agent-1"]).toBe(false);
  });

  it("writes hasEnabledTriggers=false when there are no triggers", async () => {
    const client = createClient([]);

    await useTriggerStore.getState().refreshTriggers("project-1", client, "agent-1");

    expect(useProjectDataStore.getState().projects["project-1"]?.hasEnabledTriggersByAgent?.["agent-1"]).toBe(false);
  });

  it("does not write to project-data-store when listTriggers rejects", async () => {
    const client = createClient([]);
    (client.listTriggers as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network"));

    await useTriggerStore.getState().refreshTriggers("project-1", client, "agent-1");

    const project = useProjectDataStore.getState().projects["project-1"];
    expect(project?.hasEnabledTriggersByAgent?.["agent-1"]).toBeUndefined();
  });

  it("propagates hasEnabled through createTrigger (CRUD chokepoint)", async () => {
    const client = createClient([makeTrigger({ enabled: true })]);

    await useTriggerStore.getState().createTrigger("project-1", client, "agent-1", {} as never);

    expect(useProjectDataStore.getState().projects["project-1"]?.hasEnabledTriggersByAgent?.["agent-1"]).toBe(true);
  });

  it("propagates hasEnabled through updateTrigger (CRUD chokepoint)", async () => {
    const client = createClient([makeTrigger({ enabled: false })]);

    await useTriggerStore.getState().updateTrigger("project-1", client, "agent-1", "trig-1", {} as never);

    expect(useProjectDataStore.getState().projects["project-1"]?.hasEnabledTriggersByAgent?.["agent-1"]).toBe(false);
  });

  it("propagates hasEnabled through deleteTrigger (CRUD chokepoint)", async () => {
    const client = createClient([]);

    await useTriggerStore.getState().deleteTrigger("project-1", client, "agent-1", "trig-1");

    expect(useProjectDataStore.getState().projects["project-1"]?.hasEnabledTriggersByAgent?.["agent-1"]).toBe(false);
  });
});
