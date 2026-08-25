import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../lib/api";
import { queryClient } from "./client";
import { projectQueryKeys } from "./keys";
import {
  createAgentTrigger,
  deleteAgentTrigger,
  invalidateProjectTriggers,
  projectTriggersQueryOptions,
  updateAgentTrigger,
  resetAgentTriggerBinding,
  selectAgentHasEnabledTrigger,
  selectAgentTriggers,
} from "./triggers";
import type { ProjectTriggerListResponse } from "../lib/types";

const TRIGGERS: ProjectTriggerListResponse["triggers"] = [
  {
    agentId: "agent-1",
    id: "t1",
    enabled: true,
    type: "time",
    cron: "0 9 * * *",
    mode: "new_session",
    message: "hello",
    notify: false,
    createdAt: 1,
    updatedAt: 1,
    nextTriggerAt: 100,
  },
  {
    agentId: "agent-2",
    id: "t2",
    enabled: false,
    type: "event",
    eventName: "evt",
    mode: "new_session",
    message: "hi",
    notify: false,
    createdAt: 1,
    updatedAt: 1,
    nextTriggerAt: null,
  },
];

function fakeClient(): ApiClient {
  return {
    listProjectTriggers: vi.fn().mockResolvedValue({ ok: true, triggers: TRIGGERS }),
    createTrigger: vi.fn().mockResolvedValue({ ok: true }),
    updateTrigger: vi.fn().mockResolvedValue({ ok: true }),
    deleteTrigger: vi.fn().mockResolvedValue({ ok: true }),
    runTrigger: vi.fn().mockResolvedValue({ ok: true }),
    resetTriggerBinding: vi.fn().mockResolvedValue({ ok: true }),
  } as unknown as ApiClient;
}

describe("triggers query", () => {
  beforeEach(() => {
    queryClient.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keys the query to the project triggers domain with gcTime for remount reuse", () => {
    const client = fakeClient();
    const options = projectTriggersQueryOptions("p1", client);
    expect(options.queryKey).toEqual(projectQueryKeys.triggers("p1"));
    expect(options.gcTime).toBe(Number.POSITIVE_INFINITY);
  });

  it("serves the cached list without refetching", async () => {
    const client = fakeClient();

    await queryClient.fetchQuery(projectTriggersQueryOptions("p1", client));
    await queryClient.fetchQuery(projectTriggersQueryOptions("p1", client));

    expect(client.listProjectTriggers).toHaveBeenCalledTimes(1);
  });

  it("selects one agent's triggers from the merged list", () => {
    expect(selectAgentTriggers(TRIGGERS, "agent-1").map((item) => item.id)).toEqual(["t1"]);
    expect(selectAgentTriggers(TRIGGERS, "missing")).toEqual([]);
  });

  it("derives hasEnabledTrigger per agent for the indicator", () => {
    expect(selectAgentHasEnabledTrigger(TRIGGERS, "agent-1")).toBe(true);
    expect(selectAgentHasEnabledTrigger(TRIGGERS, "agent-2")).toBe(false);
    expect(selectAgentHasEnabledTrigger(TRIGGERS, "missing")).toBe(false);
  });

  it("refetches after invalidation", async () => {
    const client = fakeClient();

    await queryClient.fetchQuery(projectTriggersQueryOptions("p1", client));
    await invalidateProjectTriggers("p1");
    await queryClient.fetchQuery(projectTriggersQueryOptions("p1", client));

    expect(client.listProjectTriggers).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["createAgentTrigger", (c: ApiClient) => createAgentTrigger("p1", c, "agent-1", {} as never), "createTrigger"],
    ["updateAgentTrigger", (c: ApiClient) => updateAgentTrigger("p1", c, "agent-1", "t1", {}), "updateTrigger"],
    ["deleteAgentTrigger", (c: ApiClient) => deleteAgentTrigger("p1", c, "agent-1", "t1"), "deleteTrigger"],
    ["resetAgentTriggerBinding", (c: ApiClient) => resetAgentTriggerBinding("p1", c, "agent-1", "t1"), "resetTriggerBinding"],
  ] as const)("%s invalidates the cache after writing", async (_name, run, method) => {
    const client = fakeClient();

    await queryClient.fetchQuery(projectTriggersQueryOptions("p1", client));
    await run(client);
    await queryClient.fetchQuery(projectTriggersQueryOptions("p1", client));

    expect(client[method]).toHaveBeenCalledTimes(1);
    expect(client.listProjectTriggers).toHaveBeenCalledTimes(2);
  });

  it("keeps per-project lists isolated", async () => {
    const clientA = fakeClient();
    const clientB = {
      listProjectTriggers: vi.fn().mockResolvedValue({ ok: true, triggers: [] }),
    } as unknown as ApiClient;

    const a = await queryClient.fetchQuery(projectTriggersQueryOptions("p1", clientA));
    const b = await queryClient.fetchQuery(projectTriggersQueryOptions("p2", clientB));

    expect(a.triggers).toHaveLength(2);
    expect(b.triggers).toEqual([]);
  });
});
