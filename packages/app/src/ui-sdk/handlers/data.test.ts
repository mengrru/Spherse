import { describe, expect, it, vi } from "vitest";

const { dispatchAction } = await import("../registry");
await import("./data");

function makeClient(fileContent: string | null) {
  return {
    getContent: vi.fn(async () =>
      fileContent === null ? null : { path: "game.data.json", content: fileContent },
    ),
    saveContent: vi.fn(async () => ({ ok: true })),
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
    const ctx = makeCtx(
      makeClient(JSON.stringify({ score: 100, name: "Alice", items: [1, 2] })),
    );
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

  it("returns empty array for invalid JSON", async () => {
    const ctx = makeCtx(makeClient("not json"));
    await dispatchAction("data.keys", { file: "world/game.data.json" }, ctx);
    expect(lastResponse(ctx)).toMatchObject({ ok: true, data: [] });
  });

  it("is ignored for non .data.json files", async () => {
    const ctx = makeCtx(makeClient("{}"));
    await dispatchAction("data.keys", { file: "world/game.json" }, ctx);
    expect(ctx.source.postMessage).not.toHaveBeenCalled();
  });

  it("is ignored when file param is missing", async () => {
    const ctx = makeCtx(makeClient("{}"));
    await dispatchAction("data.keys", {}, ctx);
    expect(ctx.source.postMessage).not.toHaveBeenCalled();
  });
});

describe("data.entries action", () => {
  it("returns the full key-value object", async () => {
    const data = { score: 100, name: "Alice" };
    const ctx = makeCtx(makeClient(JSON.stringify(data)));
    await dispatchAction("data.entries", { file: "world/game.data.json" }, ctx);
    expect(lastResponse(ctx)).toMatchObject({ ok: true });
    expect(lastResponse(ctx).data).toEqual(data);
  });

  it("returns empty object when file does not exist", async () => {
    const ctx = makeCtx(makeClient(null));
    await dispatchAction("data.entries", { file: "world/game.data.json" }, ctx);
    expect(lastResponse(ctx)).toMatchObject({ ok: true, data: {} });
  });

  it("returns empty object for invalid JSON", async () => {
    const ctx = makeCtx(makeClient("not json"));
    await dispatchAction("data.entries", { file: "world/game.data.json" }, ctx);
    expect(lastResponse(ctx)).toMatchObject({ ok: true, data: {} });
  });

  it("is ignored for non .data.json files", async () => {
    const ctx = makeCtx(makeClient("{}"));
    await dispatchAction("data.entries", { file: "world/game.json" }, ctx);
    expect(ctx.source.postMessage).not.toHaveBeenCalled();
  });

  it("is ignored when file param is missing", async () => {
    const ctx = makeCtx(makeClient("{}"));
    await dispatchAction("data.entries", {}, ctx);
    expect(ctx.source.postMessage).not.toHaveBeenCalled();
  });
});
