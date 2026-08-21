import { describe, expect, it, vi } from "vitest";

const { dispatchAction } = await import("../registry");
await import("./data");

function makeClient(doc: Record<string, unknown> | null) {
  return {
    dataRead: vi.fn(async (params: { key?: string; path?: string }) => {
      if (doc === null) {
        return { version: "none", value: params.path === "." ? {} : null };
      }
      if (params.path === ".") {
        const stripped = Object.fromEntries(Object.entries(doc).filter(([k]) => !k.startsWith("$")));
        return { version: "v1", value: stripped };
      }
      if (params.key !== undefined) {
        return { version: "v1", value: params.key in doc ? doc[params.key] : null };
      }
      return { version: "v1", value: null };
    }),
    dataRawSet: vi.fn(async () => ({ version: "v2" })),
    dataRawDelete: vi.fn(async () => ({ version: "v3" })),
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

describe("data.keys action", () => {
  it("returns all top-level keys from the data file", async () => {
    const ctx = makeCtx(makeClient({ score: 100, name: "Alice", items: [1, 2] }));
    await dispatchAction("data.keys", { file: "world/game.data.json" }, ctx);
    expect(lastResponse(ctx)).toMatchObject({ ok: true });
    expect(lastResponse(ctx).data).toEqual(
      expect.arrayContaining(["score", "name", "items"]),
    );
    expect(lastResponse(ctx).data).toHaveLength(3);
  });

  it("returns empty array when file does not exist", async () => {
    const ctx = makeCtx(makeClient(null));
    await dispatchAction("data.keys", { file: "world/game.data.json" }, ctx);
    expect(lastResponse(ctx)).toMatchObject({ ok: true, data: [] });
  });

  it("is ignored for non .data.json files", async () => {
    const ctx = makeCtx(makeClient({}));
    await dispatchAction("data.keys", { file: "world/game.json" }, ctx);
    expect(ctx.source.postMessage).not.toHaveBeenCalled();
  });
});

describe("data.entries action", () => {
  it("returns the full document without $-prefixed keys", async () => {
    const ctx = makeCtx(makeClient({ score: 1, $manifest: { version: 1 } }));
    await dispatchAction("data.entries", { file: "world/game.data.json" }, ctx);
    expect(lastResponse(ctx)).toMatchObject({ ok: true });
    expect(lastResponse(ctx).data).toEqual({ score: 1 });
  });
});

describe("data.get action", () => {
  it("returns the value for an existing key", async () => {
    const ctx = makeCtx(makeClient({ score: 42, "user.name": "alice" }));
    await dispatchAction("data.get", { file: "world/game.data.json", key: "score" }, ctx);
    expect(lastResponse(ctx)).toMatchObject({ ok: true, data: 42 });
  });

  it("returns null for a missing key", async () => {
    const ctx = makeCtx(makeClient({ score: 1 }));
    await dispatchAction("data.get", { file: "world/game.data.json", key: "nope" }, ctx);
    expect(lastResponse(ctx)).toMatchObject({ ok: true, data: null });
  });

  it("treats dotted keys as literal keys (no path traversal)", async () => {
    const ctx = makeCtx(makeClient({ "user.name": "alice" }));
    await dispatchAction("data.get", { file: "world/game.data.json", key: "user.name" }, ctx);
    expect(lastResponse(ctx)).toMatchObject({ ok: true, data: "alice" });
  });

  it("rejects $-prefixed keys with ok:false", async () => {
    const ctx = makeCtx(makeClient({ $manifest: {} }));
    await dispatchAction("data.get", { file: "world/game.data.json", key: "$manifest" }, ctx);
    expect(lastResponse(ctx)).toMatchObject({ ok: false });
  });
});

describe("data.set action", () => {
  it("proxies to dataRawSet and responds with the value", async () => {
    const client = makeClient({});
    const ctx = makeCtx(client);
    await dispatchAction("data.set", { file: "world/game.data.json", key: "score", value: 100 }, ctx);
    expect(client.dataRawSet).toHaveBeenCalledWith({ file: "world/game.data.json", key: "score", value: 100 });
    expect(lastResponse(ctx)).toMatchObject({ ok: true, data: 100 });
  });

  it("responds ok:false for $-prefixed keys, stays silent for invalid files", async () => {
    const client = makeClient({});
    const ctx1 = makeCtx(client);
    await dispatchAction("data.set", { file: "world/game.data.json", key: "$manifest", value: 1 }, ctx1);
    expect(lastResponse(ctx1)).toMatchObject({ ok: false });
    const ctx2 = makeCtx(client);
    await dispatchAction("data.set", { file: ".spherse/x.data.json", key: "a", value: 1 }, ctx2);
    expect(ctx2.source.postMessage).not.toHaveBeenCalled();
  });

  it("responds ok:false when the server rejects the write", async () => {
    const client = makeClient({});
    client.dataRawSet = vi.fn(async () => {
      throw new Error("conflict");
    });
    const ctx = makeCtx(client);
    await dispatchAction("data.set", { file: "world/game.data.json", key: "a", value: 1 }, ctx);
    expect(lastResponse(ctx)).toMatchObject({ ok: false });
  });
});

describe("data.delete action", () => {
  it("proxies to dataRawDelete", async () => {
    const client = makeClient({ a: 1 });
    const ctx = makeCtx(client);
    await dispatchAction("data.delete", { file: "world/game.data.json", key: "a" }, ctx);
    expect(client.dataRawDelete).toHaveBeenCalledWith({ file: "world/game.data.json", key: "a" });
    expect(lastResponse(ctx)).toMatchObject({ ok: true, data: true });
  });
});
