import { describe, expect, it } from "vitest";
import { connectionMethods } from "@spherse/rpc/methods";
import { callMethod, createRpcHarness, type RpcHarness } from "@spherse/rpc/testing";

interface ResultFrame {
  type: string;
  id: number;
  ok: boolean;
  data?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface RegistryEntry {
  id: string;
  rootPath: string;
  lastOpened?: string;
}

function createHarness(options: {
  entries?: RegistryEntry[];
  authRequired?: boolean;
  appVersion?: string;
}): RpcHarness {
  const infos = (options.entries ?? []).map((e) => ({
    id: e.id,
    rootPath: e.rootPath,
    name: e.rootPath.split("/").pop() ?? e.rootPath,
    lastOpened: e.lastOpened,
  }));
  return createRpcHarness({
    methods: connectionMethods,
    authRequired: options.authRequired,
    appVersion: options.appVersion,
    registry: {
      listInfo: () => infos,
      getInfo: (id: string) => infos.find((i) => i.id === id),
    },
  });
}

describe("connection.info", () => {
  it("returns server version, api version, and the authRequired flag", async () => {
    const harness = createHarness({ authRequired: true });
    const frame = (await callMethod(harness, "connection.info", {})) as ResultFrame;
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect(frame.data).toMatchObject({ authRequired: true });
    expect(typeof (frame.data as { serverVersion: string }).serverVersion).toBe("string");
    expect(typeof (frame.data as { apiVersion: string }).apiVersion).toBe("string");
  });

  it("reports authRequired false when auth is disabled", async () => {
    const harness = createHarness({ authRequired: false });
    const frame = (await callMethod(harness, "connection.info", {})) as ResultFrame;
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect((frame.data as { authRequired: boolean }).authRequired).toBe(false);
  });

  it("exposes the host app version", async () => {
    const harness = createHarness({ appVersion: "1.2.3" });
    const frame = (await callMethod(harness, "connection.info", {})) as ResultFrame;
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect((frame.data as { appVersion: string | null }).appVersion).toBe("1.2.3");
  });
});

describe("connection.projects", () => {
  it("returns the project list with id and name", async () => {
    const harness = createHarness({
      entries: [
        { id: "p1", rootPath: "/home/user/project-a" },
        { id: "p2", rootPath: "/home/user/project-b" },
      ],
    });
    const frame = (await callMethod(harness, "connection.projects", {})) as ResultFrame;
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect(frame.data).toEqual([
      { id: "p1", name: "project-a" },
      { id: "p2", name: "project-b" },
    ]);
  });

  it("includes lastOpened when present", async () => {
    const harness = createHarness({
      entries: [
        { id: "p1", rootPath: "/home/user/project-a", lastOpened: "2026-01-01T00:00:00.000Z" },
        { id: "p2", rootPath: "/home/user/project-b", lastOpened: "2026-02-01T00:00:00.000Z" },
      ],
    });
    const frame = (await callMethod(harness, "connection.projects", {})) as ResultFrame;
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect(frame.data).toEqual([
      { id: "p1", name: "project-a", lastOpened: "2026-01-01T00:00:00.000Z" },
      { id: "p2", name: "project-b", lastOpened: "2026-02-01T00:00:00.000Z" },
    ]);
  });
});

describe("connection.projectInfo", () => {
  it("returns full info for a known project", async () => {
    const harness = createHarness({
      entries: [{ id: "p1", rootPath: "/home/user/project-a" }],
    });
    const frame = (await callMethod(harness, "connection.projectInfo", { projectId: "p1" })) as ResultFrame;
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect(frame.data).toEqual({
      id: "p1",
      name: "project-a",
      rootPath: "/home/user/project-a",
    });
  });

  it("maps unknown projects to app error 100", async () => {
    const harness = createHarness({
      entries: [{ id: "p1", rootPath: "/home/user/project-a" }],
    });
    const frame = (await callMethod(harness, "connection.projectInfo", {
      projectId: "unknown",
    })) as ResultFrame;
    expect(frame).toMatchObject({
      type: "result",
      ok: false,
      error: { code: 100, message: "Unknown project" },
    });
  });

  it("includes lastOpened when present", async () => {
    const harness = createHarness({
      entries: [
        { id: "p1", rootPath: "/home/user/project-a", lastOpened: "2026-01-01T00:00:00.000Z" },
      ],
    });
    const frame = (await callMethod(harness, "connection.projectInfo", { projectId: "p1" })) as ResultFrame;
    expect(frame).toMatchObject({ type: "result", ok: true });
    expect(frame.data).toEqual({
      id: "p1",
      name: "project-a",
      rootPath: "/home/user/project-a",
      lastOpened: "2026-01-01T00:00:00.000Z",
    });
  });
});
