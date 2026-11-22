import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api";
import { RpcCallError } from "./client";
import { createRpcApiClient, createRpcGlobalApiClient } from "./api-adapter";

class FakeRpc {
  calls: Array<{ method: string; params: Record<string, unknown> | undefined }> = [];
  queues = new Map<string, unknown[]>();

  respond(method: string, ...values: unknown[]): void {
    const queue = this.queues.get(method) ?? [];
    queue.push(...values);
    this.queues.set(method, queue);
  }

  call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    this.calls.push({ method, params });
    const queue = this.queues.get(method);
    const value = queue?.length ? queue.shift() : { ok: true };
    return Promise.resolve(value as T);
  }

  lastOf(method: string) {
    return this.calls.filter((c) => c.method === method).at(-1);
  }
}

function ok(payload: Record<string, unknown> = {}) {
  return { ok: true, ...payload };
}

const SESSION_INFO = {
  id: "s1",
  agentId: "a1",
  createdAt: 1,
  updatedAt: 1,
  status: "active",
};

describe("rpc api adapter mapping", () => {
  it("maps sessions methods with correct params", async () => {
    const rpc = new FakeRpc();
    rpc.respond("agents.list", []);
    rpc.respond("sessions.create", { sessionId: "s1" }, { sessionId: "s2" });
    rpc.respond("sessions.listByAgent", { items: [SESSION_INFO], hasMore: false }, [SESSION_INFO]);
    rpc.respond("sessions.sendMessage", ok());
    rpc.respond("sessions.delete", ok());
    const client = createRpcApiClient("http://x", "p1", null, rpc as never);

    await client.listAgents();
    expect(rpc.lastOf("agents.list")?.params).toEqual({ projectId: "p1" });

    await client.createSession("a1", "t");
    expect(rpc.lastOf("sessions.create")?.params).toEqual({ projectId: "p1", agentId: "a1", title: "t" });
    await client.createSession("a1");
    expect(rpc.lastOf("sessions.create")?.params).toEqual({ projectId: "p1", agentId: "a1" });

    await client.listSessionsPage("a1", { limit: 5, offset: 10 });
    expect(rpc.lastOf("sessions.listByAgent")?.params).toEqual({
      projectId: "p1",
      agentId: "a1",
      limit: 5,
      offset: 10,
    });
    await client.listSessions("a1");
    expect(rpc.lastOf("sessions.listByAgent")?.params).toEqual({ projectId: "p1", agentId: "a1" });

    await client.sendMessage("a1", "s1", "hi");
    expect(rpc.lastOf("sessions.sendMessage")?.params).toEqual({
      projectId: "p1",
      agentId: "a1",
      sessionId: "s1",
      content: "hi",
    });

    await client.deleteSession("a1", "s1");
    expect(rpc.lastOf("sessions.delete")?.params).toEqual({ projectId: "p1", agentId: "a1", sessionId: "s1" });
  });

  it("maps content and data methods", async () => {
    const rpc = new FakeRpc();
    rpc.respond("content.read", { path: "a.md", content: "x", binary: false });
    rpc.respond("content.list", []);
    rpc.respond("data.read", { version: "1", value: null });
    rpc.respond("data.rawSet", { version: "2" });
    rpc.respond("content.save", ok());
    rpc.respond("content.mkdir", ok());
    rpc.respond("content.rename", ok());
    const client = createRpcApiClient("http://x", "p1", null, rpc as never);

    await client.saveContent("a.md", "x");
    expect(rpc.lastOf("content.save")?.params).toEqual({ projectId: "p1", path: "a.md", content: "x" });

    await client.mkdir("d");
    expect(rpc.lastOf("content.mkdir")?.params).toEqual({ projectId: "p1", path: "d" });

    await client.renameContent("a.md", "b.md");
    expect(rpc.lastOf("content.rename")?.params).toEqual({ projectId: "p1", path: "a.md", to: "b.md" });

    await client.listContent("");
    expect(rpc.lastOf("content.list")?.params).toEqual({ projectId: "p1" });
    await client.listContent("sub");
    expect(rpc.lastOf("content.list")?.params).toEqual({ projectId: "p1", path: "sub" });

    await client.dataRawSet({ file: "f.json", key: "k", value: 1 });
    expect(rpc.lastOf("data.rawSet")?.params).toEqual({
      projectId: "p1",
      file: "f.json",
      key: "k",
      value: 1,
    });
  });

  it("maps agent methods and preserves fallback defaults", async () => {
    const rpc = new FakeRpc();
    rpc.respond("agents.getMcp", { servers: [] });
    rpc.respond("agents.getTheme", "body{}");
    rpc.respond("agents.getRaw", { content: "yaml" });
    rpc.respond("agents.updateMcp", { servers: [] });
    const client = createRpcApiClient("http://x", "p1", null, rpc as never);

    rpc.respond("agents.getMcp", undefined);
    const fallback = await client.getAgentMcp("a1");
    expect(fallback).toEqual({ servers: [] });

    await client.updateAgentMcp("a1", { servers: [] });
    expect(rpc.lastOf("agents.updateMcp")?.params).toEqual({ projectId: "p1", id: "a1", servers: [] });

    rpc.respond("agents.getRaw", { content: "yaml" });
    await expect(client.getAgentRaw("a1")).resolves.toBe("yaml");

    rpc.respond("agents.getTheme", "body{}");
    await expect(client.getAgentTheme("a1")).resolves.toBe("body{}");
  });

  it("maps settings and trigger methods", async () => {
    const rpc = new FakeRpc();
    rpc.respond("settings.getAiAccess", { ok: true, deniedPaths: [] });
    rpc.respond("settings.updateAiAccess", { ok: true, deniedPaths: [] });
    rpc.respond("settings.updateTheme", { ok: true });
    rpc.respond("triggers.create", {
      id: "t1",
      agentId: "a1",
      type: "time",
      mode: "new_session",
      message: "m",
      notify: false,
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    });
    rpc.respond("triggers.logs", []);
    const client = createRpcApiClient("http://x", "p1", null, rpc as never);

    await client.updateAiAccessSettings(["/x"]);
    expect(rpc.lastOf("settings.updateAiAccess")?.params).toEqual({ projectId: "p1", deniedPaths: ["/x"] });

    await client.updateThemeSettings("body{}");
    expect(rpc.lastOf("settings.updateTheme")?.params).toEqual({ projectId: "p1", content: "body{}" });

    await client.createTrigger("a1", {
      type: "time",
      cron: "* * * * *",
      mode: "new_session",
      message: "m",
      notify: false,
    });
    expect(rpc.lastOf("triggers.create")?.params).toEqual({
      projectId: "p1",
      agentId: "a1",
      type: "time",
      cron: "* * * * *",
      mode: "new_session",
      message: "m",
      notify: false,
    });

    await client.getTriggerLogs("a1", 5);
    expect(rpc.lastOf("triggers.logs")?.params).toEqual({ projectId: "p1", agentId: "a1", limit: 5 });
  });

  it("keeps preview and resource plane URLs on HTTP", async () => {
    const rpc = new FakeRpc();
    const client = createRpcApiClient("http://x", "p1", "tok", rpc as never);
    expect(client.getPreviewUrl("a/b.md", 3)).toBe(
      "http://x/api/projects/p1/preview/__auth/tok/a/b.md?v=3",
    );
    const anon = createRpcApiClient("http://x", "p1", null, rpc as never);
    expect(anon.getPreviewUrl("a.md")).toBe("http://x/api/projects/p1/preview/a.md");

    const fetchMock = vi.fn(async () => new Response(JSON.stringify(ok()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await client.deleteAttachment("att.png");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://x/api/projects/p1/attachments",
      expect.objectContaining({ method: "DELETE" }),
    );
    vi.unstubAllGlobals();
  });

  it("maps rpc error codes to http statuses", async () => {
    const rpc = new FakeRpc();
    rpc.call = vi.fn(async () => {
      throw new RpcCallError("Session not found", 100);
    });
    const client = createRpcApiClient("http://x", "p1", null, rpc as never);
    await expect(client.getAgent("a1")).rejects.toMatchObject({
      status: 404,
      message: "Session not found",
    });

    rpc.call = vi.fn(async () => {
      throw new RpcCallError("bad", -32602);
    });
    await expect(client.getAgent("a1")).rejects.toBeInstanceOf(ApiError);
    await expect(client.getAgent("a1")).rejects.toMatchObject({ status: 400 });
  });

  it("maps global methods", async () => {
    const rpc = new FakeRpc();
    rpc.respond("connection.info", {
      serverVersion: "0.1.0",
      authRequired: true,
      apiVersion: "1",
      appVersion: null,
    });
    rpc.respond("marketplace.prompts", {
      schemaVersion: 1,
      generatedAt: "2026-01-01",
      language: "en-us",
      prompts: [],
    });
    rpc.respond("marketplace.installProject", { projectRoot: "/tmp/x" });
    const client = createRpcGlobalApiClient("http://x", null, rpc as never);

    await client.getConnectionInfo();
    expect(rpc.lastOf("connection.info")?.params).toEqual({});

    await client.listMarketplacePrompts("en-us");
    expect(rpc.lastOf("marketplace.prompts")?.params).toEqual({ language: "en-us" });

    await client.installMarketplaceProject({ name: "n", version: "1", destDir: "/tmp/x" });
    expect(rpc.lastOf("marketplace.installProject")?.params).toEqual({
      name: "n",
      version: "1",
      destDir: "/tmp/x",
    });
  });
});
