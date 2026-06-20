import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../lib/api";
import type { ScheduleInfo } from "../../lib/types";
import { useScheduleStore } from "./store";
import { useProjectDataStore } from "../../stores/project-data-store";

function makeSchedule(overrides: Partial<ScheduleInfo>): ScheduleInfo {
  return {
    id: "sch-1",
    enabled: false,
    cron: "0 9 * * *",
    mode: "new_session",
    message: "hi",
    notify: false,
    createdAt: 1,
    updatedAt: 1,
    nextTriggerAt: null,
    ...overrides,
  } as ScheduleInfo;
}

function createClient(listSchedulesReturn: ScheduleInfo[]): ApiClient {
  return {
    listSchedules: vi.fn().mockResolvedValue(listSchedulesReturn),
    createSchedule: vi.fn().mockResolvedValue(undefined),
    updateSchedule: vi.fn().mockResolvedValue(undefined),
    deleteSchedule: vi.fn().mockResolvedValue(undefined),
    triggerSchedule: vi.fn().mockResolvedValue(undefined),
    createScheduleWebSocket: vi.fn(),
  } as unknown as ApiClient;
}

describe("useScheduleStore", () => {
  beforeEach(() => {
    useScheduleStore.setState({ byProject: {} });
    useProjectDataStore.setState({ projects: {} });
  });

  it("writes hasEnabledSchedules=true to project-data-store when refreshSchedules finds an enabled schedule", async () => {
    const client = createClient([makeSchedule({ enabled: true })]);

    await useScheduleStore.getState().refreshSchedules("project-1", client, "agent-1");

    expect(useProjectDataStore.getState().projects["project-1"]?.hasEnabledSchedulesByAgent?.["agent-1"]).toBe(true);
  });

  it("writes hasEnabledSchedules=false when all schedules are disabled", async () => {
    const client = createClient([makeSchedule({ enabled: false }), makeSchedule({ id: "sch-2", enabled: false })]);

    await useScheduleStore.getState().refreshSchedules("project-1", client, "agent-1");

    expect(useProjectDataStore.getState().projects["project-1"]?.hasEnabledSchedulesByAgent?.["agent-1"]).toBe(false);
  });

  it("writes hasEnabledSchedules=false when there are no schedules", async () => {
    const client = createClient([]);

    await useScheduleStore.getState().refreshSchedules("project-1", client, "agent-1");

    expect(useProjectDataStore.getState().projects["project-1"]?.hasEnabledSchedulesByAgent?.["agent-1"]).toBe(false);
  });

  it("does not write to project-data-store when listSchedules rejects", async () => {
    const client = createClient([]);
    (client.listSchedules as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network"));

    await useScheduleStore.getState().refreshSchedules("project-1", client, "agent-1");

    const project = useProjectDataStore.getState().projects["project-1"];
    expect(project?.hasEnabledSchedulesByAgent?.["agent-1"]).toBeUndefined();
  });

  it("propagates hasEnabled through createSchedule (CRUD chokepoint)", async () => {
    const client = createClient([makeSchedule({ enabled: true })]);

    await useScheduleStore.getState().createSchedule("project-1", client, "agent-1", {} as never);

    expect(useProjectDataStore.getState().projects["project-1"]?.hasEnabledSchedulesByAgent?.["agent-1"]).toBe(true);
  });

  it("propagates hasEnabled through updateSchedule (CRUD chokepoint)", async () => {
    const client = createClient([makeSchedule({ enabled: false })]);

    await useScheduleStore.getState().updateSchedule("project-1", client, "agent-1", "sch-1", {} as never);

    expect(useProjectDataStore.getState().projects["project-1"]?.hasEnabledSchedulesByAgent?.["agent-1"]).toBe(false);
  });

  it("propagates hasEnabled through deleteSchedule (CRUD chokepoint)", async () => {
    const client = createClient([]);

    await useScheduleStore.getState().deleteSchedule("project-1", client, "agent-1", "sch-1");

    expect(useProjectDataStore.getState().projects["project-1"]?.hasEnabledSchedulesByAgent?.["agent-1"]).toBe(false);
  });
});
