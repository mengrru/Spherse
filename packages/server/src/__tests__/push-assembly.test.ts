import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net, { type AddressInfo } from "node:net";

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

import { createMultiProjectServer, type MultiProjectServer } from "../index.js";

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
name: Assembly Agent
tools:
  - read_file
---

Test agent for push assembly.`;

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

describe("server assembly ↔ PushNotifier wiring", () => {
  let tmpDir: string;
  let projectRoot: string;
  let server: MultiProjectServer;
  let projectId: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spherse-push-assembly-"));
    projectRoot = path.join(tmpDir, "project");
    fs.mkdirSync(projectRoot, { recursive: true });
    const port = await getFreePort();
    server = await createMultiProjectServer({
      port,
      pushStoragePath: path.join(tmpDir, "push-storage.json"),
    });
    const ctx = await server.registry.register(projectRoot);
    projectId = ctx.projectId;

    const res = await server.fastify.inject({
      method: "POST",
      url: "/api/push/subscribe",
      payload: {
        endpoint: "https://push.example/assembly",
        keys: { p256dh: "dh", auth: "auth" },
        locale: "zh-CN",
      },
    });
    expect(res.statusCode).toBe(200);
  });

  afterAll(async () => {
    await server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("delivers push for a registered project, then stops after registry removal", async () => {
    const ctx = server.registry.get(projectId)!;
    const agent = await (ctx.projectManager as unknown as {
      projectStore: { createAgent(slug: string, profile: string): Promise<{ getProfile(): { id: string } }> };
    }).projectStore.createAgent("agent", TEST_AGENT_PROFILE);
    const agentId = agent.getProfile().id;
    ctx.triggerManager.create(agentId, {
      id: "t-assembly",
      type: "time",
      cron: "0 9 * * *",
      enabled: true,
      mode: "new_session",
      message: "m",
      notify: true,
      name: "Assembly",
      createdAt: 1,
      updatedAt: 1,
    } as never);

    sendNotificationMock.mockClear();
    ctx.triggerManager.emit("trigger_completed", { agentId, triggerId: "t-assembly", sessionId: "s1", status: "success" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    const [, body] = sendNotificationMock.mock.calls[0] as [unknown, string];
    expect(JSON.parse(body).title).toContain("Assembly");

    sendNotificationMock.mockClear();
    await server.registry.remove(projectId);
    ctx.triggerManager.emit("trigger_completed", { agentId, triggerId: "t-assembly", sessionId: "s2", status: "success" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sendNotificationMock).toHaveBeenCalledTimes(0);
  });
});
