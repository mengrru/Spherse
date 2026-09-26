import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sendNotificationMock = vi.hoisted(() => vi.fn(async () => ({})));

vi.mock("web-push", async (importOriginal) => {
  const actual = await importOriginal<typeof import("web-push")>();
  return {
    ...actual,
    default: {
      ...actual.default,
      setVapidDetails: vi.fn(),
      sendNotification: sendNotificationMock,
    },
  };
});

import { createProject, type ProjectRuntime } from "@spherse/core";
import { PushNotifier } from "../push/push-notifier.js";
import { PushStore } from "../push/push-store.js";
import type { ProjectContextCompat } from "../registry.js";

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => silentLogger,
} as never;

const TEST_AGENT_PROFILE = `---
name: Test Agent
tools:
  - read_file
---

Test agent for push.`;

describe("PushNotifier ↔ real runtime contract", () => {
  let tmpDir: string;
  let storePath: string;
  let runtime: ProjectRuntime & {
    projectManager: { projectStore: any };
    sessionRuntime: any;
  };
  let ctx: ProjectContextCompat;
  let notifier: PushNotifier;
  let store: PushStore;
  let agentId: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spherse-push-notifier-"));
    storePath = path.join(tmpDir, "push-storage.json");
    runtime = (await createProject(tmpDir, {
      projectName: "Contract",
      logger: silentLogger,
    })) as never;
    runtime.timerService.stop();
    const projectStore = runtime.projectManager.projectStore;
    const agent = await projectStore.createAgent("test-agent", TEST_AGENT_PROFILE);
    agentId = agent.getProfile().id;
    ctx = {
      runtime,
      projectId: runtime.projectId,
      get projectManager() {
        return runtime.projectManager;
      },
      get sessionRuntime() {
        return runtime.sessionRuntime;
      },
      get triggerManager() {
        return runtime.triggerManager;
      },
    } as ProjectContextCompat;
    store = new PushStore(storePath);
    notifier = new PushNotifier({ store, logger: silentLogger });
    notifier.attachProject(ctx);
  });

  afterAll(async () => {
    notifier.close();
    await store.flush();
    await runtime.shutdown();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function subscribeDevice(endpoint: string, locale = "zh-CN"): void {
    store.upsert({
      endpoint,
      keys: { p256dh: `dh-${endpoint}`, auth: `auth-${endpoint}` },
      locale,
    });
  }

  function sentPayloads(): Array<{ endpoint: string; payload: any }> {
    return sendNotificationMock.mock.calls.map(([sub, body]: [any, string]) => ({
      endpoint: sub.endpoint,
      payload: JSON.parse(body),
    }));
  }

  it("pushes an approval notification driven by a real control request", async () => {
    subscribeDevice("https://push.example/approval");
    sendNotificationMock.mockClear();

    const sessionId = await runtime.sessionRuntime.createSession(agentId);
    const runner = runtime.sessionRuntime.sessions.get(sessionId);
    // Approval events only flow through the control bus while a run is active;
    // mirror that wiring with the runner's own persisting sink.
    const bus = (runner as any).controlBus;
    const previousSink = bus.swapEventSink((runner as any).persistingControlSink(() => {}));
    const pending = bus.request(
      { requestId: "req-1", kind: "approval", toolCallId: "tc-1", toolName: "run_command", args: {} },
      60_000,
      { approved: false },
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    bus.resolve("req-1", { approved: true });
    bus.swapEventSink(previousSink);
    await pending;

    const payloads = sentPayloads();
    expect(payloads).toHaveLength(1);
    expect(payloads[0].payload.title).toContain("Test Agent");
    expect(payloads[0].payload.body).toContain("run_command");
    expect(payloads[0].payload.tag).toBe("approval:req-1");
    expect(payloads[0].payload.data).toMatchObject({ kind: "approval", sessionId });
  });

  it("pushes trigger_completed only when entry.notify is set", async () => {
    subscribeDevice("https://push.example/trigger");
    sendNotificationMock.mockClear();

    runtime.triggerManager.create(agentId, {
      id: "t-quiet",
      type: "time",
      cron: "0 9 * * *",
      enabled: true,
      mode: "new_session",
      message: "hi",
      notify: false,
      createdAt: 1,
      updatedAt: 1,
    } as never);
    runtime.triggerManager.emit("trigger_completed", { agentId, triggerId: "t-quiet", sessionId: "s1", status: "success" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(sentPayloads()).toHaveLength(0);

    runtime.triggerManager.create(agentId, {
      id: "t-loud",
      type: "time",
      cron: "0 9 * * *",
      enabled: true,
      mode: "new_session",
      message: "hi",
      notify: true,
      name: "Morning digest",
      notificationMessage: "Digest ready",
      createdAt: 1,
      updatedAt: 1,
    } as never);
    runtime.triggerManager.emit("trigger_completed", { agentId, triggerId: "t-loud", sessionId: "s2", status: "success" });
    await new Promise((resolve) => setTimeout(resolve, 30));

    const payloads = sentPayloads().filter((p) => p.endpoint === "https://push.example/trigger");
    expect(payloads).toHaveLength(1);
    expect(payloads[0].payload.title).toContain("Morning digest");
    expect(payloads[0].payload.body).toBe("Digest ready");
    expect(payloads[0].payload.data).toMatchObject({ kind: "trigger_completed", sessionId: "s2" });
  });

  it("pushes trigger_failed and skips deleted triggers", async () => {
    subscribeDevice("https://push.example/failed");
    sendNotificationMock.mockClear();

    runtime.triggerManager.create(agentId, {
      id: "t-fail",
      type: "time",
      cron: "0 9 * * *",
      enabled: true,
      mode: "new_session",
      message: "hi",
      notify: true,
      name: "Failing job",
      createdAt: 1,
      updatedAt: 1,
    } as never);
    runtime.triggerManager.emit("trigger_failed", { agentId, triggerId: "t-fail", sessionId: "s3", error: "boom" });
    await new Promise((resolve) => setTimeout(resolve, 30));

    const failed = sentPayloads().filter((p) => p.endpoint === "https://push.example/failed");
    expect(failed).toHaveLength(1);
    expect(failed[0].payload.data.kind).toBe("trigger_failed");

    sendNotificationMock.mockClear();
    runtime.triggerManager.delete(agentId, "t-fail");
    runtime.triggerManager.emit("trigger_failed", { agentId, triggerId: "t-fail", error: "boom" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(sentPayloads()).toHaveLength(0);
  });

  it("removes subscriptions on 404/410 delivery failures", async () => {
    for (const sub of store.list()) {
      store.remove(sub.endpoint);
    }
    store.upsert({
      endpoint: "https://push.example/gone",
      keys: { p256dh: "k", auth: "k" },
      locale: "zh-CN",
    });
    sendNotificationMock.mockImplementationOnce(async () => {
      const err = new Error("Subscription gone") as Error & { statusCode: number };
      err.statusCode = 410;
      throw err;
    });
    sendNotificationMock.mockClear();

    runtime.triggerManager.emit("trigger_completed", { agentId, triggerId: "t-loud", sessionId: "s4", status: "success" });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(store.list().find((s) => s.endpoint === "https://push.example/gone")).toBeUndefined();
    sendNotificationMock.mockReset();
    sendNotificationMock.mockImplementation(async () => ({}));
  });

  it("stops delivering after detachProject", async () => {
    subscribeDevice("https://push.example/detached");
    sendNotificationMock.mockClear();
    notifier.detachProject(runtime.sessionRuntime);
    runtime.triggerManager.emit("trigger_completed", { agentId, triggerId: "t-loud", sessionId: "s5", status: "success" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(sentPayloads()).toHaveLength(0);
  });
});
