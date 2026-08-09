import { describe, expect, it, vi } from "vitest";

const { dispatchAction } = await import("../registry");
await import("./api");

/** Minimal ApiClient stub — only the methods the whitelist can reach. */
function makeClient() {
  return {
    listAgents: vi.fn(async () => [{ id: "a1", slug: "writer-abc" }]),
    getAgent: vi.fn(async (id: string) => ({ id, slug: "writer-abc" })),
    listSessions: vi.fn(async () => [{ id: "s1" }]),
    getSessionMessages: vi.fn(async () => ({ sessionId: "s1", messages: [] })),
    getSessionStatus: vi.fn(async () => ({ sessionId: "s1", status: "idle" })),
    getContent: vi.fn(async () => ({ path: "notes.md", content: "hi" })),
    listContent: vi.fn(async () => [{ name: "notes.md", type: "file" as const }]),
    stat: vi.fn(async () => ({ size: 42, mtime: 1700000000, isDirectory: false })),
    getFileTree: vi.fn(async () => ["notes.md"]),
  } as any;
}

function makeCtx(client: any) {
  const postMessage = vi.fn();
  return {
    client,
    projectId: "proj-1",
    navigate: vi.fn(),
    hostKind: "electron" as const,
    requestId: "req-1",
    source: { postMessage } as any,
  } as any;
}

function lastResponse(ctx: any) {
  const calls = ctx.source.postMessage.mock.calls;
  return calls[calls.length - 1]?.[0];
}

describe("api.call action", () => {
  it("dispatches a whitelisted op and forwards the result", async () => {
    const ctx = makeCtx(makeClient());
    await dispatchAction("api.call", { op: "agents.list", args: {} }, ctx);
    const res = lastResponse(ctx);
    expect(res).toMatchObject({ type: "spherse:response", requestId: "req-1", ok: true });
    expect(res.data).toEqual([{ id: "a1", slug: "writer-abc" }]);
    expect(ctx.client.listAgents).toHaveBeenCalledTimes(1);
  });

  it("forwards args to the underlying client method", async () => {
    const ctx = makeCtx(makeClient());
    await dispatchAction(
      "api.call",
      { op: "sessions.messages", args: { agentId: "agt-1", id: "s1" } },
      ctx,
    );
    expect(ctx.client.getSessionMessages).toHaveBeenCalledWith("agt-1", "s1");
    expect(lastResponse(ctx).ok).toBe(true);
  });

  it("rejects an unknown op with ok:false and unknown_op", async () => {
    const ctx = makeCtx(makeClient());
    await dispatchAction("api.call", { op: "agents.delete", args: {} }, ctx);
    const res = lastResponse(ctx);
    expect(res.ok).toBe(false);
    expect(res.data).toEqual({ error: "unknown_op" });
    expect(ctx.client.deleteAgent).toBeUndefined();
  });

  it("returns bad_request when client is missing", async () => {
    const ctx = makeCtx(undefined);
    await dispatchAction("api.call", { op: "agents.list", args: {} }, ctx);
    expect(lastResponse(ctx)).toMatchObject({ ok: false, data: { error: "bad_request" } });
  });

  it("returns bad_request when op is not a string", async () => {
    const ctx = makeCtx(makeClient());
    await dispatchAction("api.call", { op: 42, args: {} }, ctx);
    expect(lastResponse(ctx).data).toEqual({ error: "bad_request" });
  });

  it("returns request_failed when the client method throws", async () => {
    const client = makeClient();
    client.listAgents.mockRejectedValueOnce(new Error("network"));
    const ctx = makeCtx(client);
    await dispatchAction("api.call", { op: "agents.list", args: {} }, ctx);
    expect(lastResponse(ctx)).toMatchObject({ ok: false, data: { error: "request_failed" } });
  });

  it("treats a missing args object as empty", async () => {
    const ctx = makeCtx(makeClient());
    await dispatchAction("api.call", { op: "fileTree" }, ctx);
    expect(ctx.client.getFileTree).toHaveBeenCalledTimes(1);
    expect(lastResponse(ctx).ok).toBe(true);
  });

  it("coerces non-string arg values to empty string rather than throwing", async () => {
    const ctx = makeCtx(makeClient());
    await dispatchAction(
      "api.call",
      { op: "agents.get", args: { id: 123 } },
      ctx,
    );
    expect(ctx.client.getAgent).toHaveBeenCalledWith("");
  });

  it("dispatches content.listDir and returns directory entries", async () => {
    const ctx = makeCtx(makeClient());
    await dispatchAction("api.call", { op: "content.listDir", args: { path: "world" } }, ctx);
    expect(ctx.client.listContent).toHaveBeenCalledWith("world");
    expect(lastResponse(ctx)).toMatchObject({
      ok: true,
      data: [{ name: "notes.md", type: "file" }],
    });
  });

  it("dispatches content.stat and returns file metadata", async () => {
    const ctx = makeCtx(makeClient());
    await dispatchAction("api.call", { op: "content.stat", args: { path: "notes.md" } }, ctx);
    expect(ctx.client.stat).toHaveBeenCalledWith("notes.md");
    expect(lastResponse(ctx)).toMatchObject({
      ok: true,
      data: { size: 42, mtime: 1700000000, isDirectory: false },
    });
  });
});
