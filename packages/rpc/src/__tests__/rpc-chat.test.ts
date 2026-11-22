import { describe, expect, it } from "vitest";
import { chatMethods } from "../methods/chat.js";
import { createRpcHarness, flush } from "../testing.js";

const SESSION = { projectId: "p1", agentId: "a1", sessionId: "s1" };

function createChatHarness() {
  const harness = createRpcHarness({ methods: chatMethods });
  harness.receive({ type: "sub", id: 90, scope: "chat:p1:a1:s1" });
  return harness;
}

describe("rpc chat send plane", () => {
  it("sends a message through the subscribed attachment", async () => {
    const { receive, sent, hubMock } = createChatHarness();
    receive({ type: "call", id: 1, method: "chat.send", params: { ...SESSION, content: "hello" } });
    await flush();
    expect(hubMock.attachments[0].sendMessage).toHaveBeenCalledWith("hello", [], undefined);
    expect(sent().at(-1)).toMatchObject({ type: "result", id: 1, ok: true, data: { ok: true } });
  });

  it("passes attachments and clientId through", async () => {
    const { receive, hubMock } = createChatHarness();
    const attachments = [{ type: "image", path: "a.png", mimeType: "image/png" }];
    receive({
      type: "call",
      id: 2,
      method: "chat.send",
      params: { ...SESSION, content: "hi", clientId: "c1", attachments },
    });
    await flush();
    expect(hubMock.attachments[0].sendMessage).toHaveBeenCalledWith("hi", attachments, "c1");
  });

  it("rejects send without an active subscription", async () => {
    const { receive, sent } = createRpcHarness({ methods: chatMethods });
    receive({ type: "call", id: 3, method: "chat.send", params: { ...SESSION, content: "hello" } });
    await flush();
    expect(sent()[0]).toMatchObject({
      type: "result",
      id: 3,
      ok: false,
      error: { code: 102, message: "Not subscribed to session" },
    });
  });

  it("rejects empty content at the schema layer", async () => {
    const { receive, sent } = createChatHarness();
    receive({ type: "call", id: 4, method: "chat.send", params: { ...SESSION, content: "" } });
    await flush();
    expect(sent().at(-1)).toMatchObject({
      type: "result",
      id: 4,
      ok: false,
      error: { code: -32602 },
    });
  });

  it("retries and withdraws the last turn", async () => {
    const { receive, hubMock } = createChatHarness();
    receive({ type: "call", id: 5, method: "chat.retry", params: { ...SESSION } });
    receive({ type: "call", id: 6, method: "chat.withdraw", params: { ...SESSION } });
    await flush();
    expect(hubMock.attachments[0].retryLastTurn).toHaveBeenCalledTimes(1);
    expect(hubMock.attachments[0].withdrawLastTurn).toHaveBeenCalledTimes(1);
  });

  it("aborts after a successful ready", async () => {
    const { receive, hubMock, sent } = createChatHarness();
    receive({ type: "call", id: 7, method: "chat.abort", params: { ...SESSION } });
    await flush();
    expect(hubMock.attachments[0].abort).toHaveBeenCalledTimes(1);
    expect(sent().at(-1)).toMatchObject({ type: "result", id: 7, ok: true });
  });

  it("abort surfaces a failed ready as invalid state", async () => {
    const { receive, hubMock, sent } = createChatHarness();
    const rejected = Promise.reject(new Error("restore failed"));
    hubMock.attachments[0].ready = rejected;
    receive({ type: "call", id: 8, method: "chat.abort", params: { ...SESSION } });
    await flush();
    rejected.catch(() => {});
    expect(hubMock.attachments[0].abort).not.toHaveBeenCalled();
    expect(sent().at(-1)).toMatchObject({
      type: "result",
      id: 8,
      ok: false,
      error: { code: 102, message: "Session not ready" },
    });
  });

  it("resolves approval and question control requests", async () => {
    const { receive, hubMock } = createChatHarness();
    receive({
      type: "call",
      id: 9,
      method: "chat.resolveControlRequest",
      params: { ...SESSION, requestId: "r1", kind: "approval", approved: false, reason: "no" },
    });
    receive({
      type: "call",
      id: 10,
      method: "chat.resolveControlRequest",
      params: { ...SESSION, requestId: "r2", kind: "question", answer: "yes" },
    });
    await flush();
    expect(hubMock.attachments[0].resolveControlRequest).toHaveBeenNthCalledWith(1, "r1", {
      approved: false,
      reason: "no",
    });
    expect(hubMock.attachments[0].resolveControlRequest).toHaveBeenNthCalledWith(2, "r2", {
      answer: "yes",
      timedOut: false,
    });
  });

  it("rejects an empty question answer at the schema layer", async () => {
    const { receive, sent } = createChatHarness();
    receive({
      type: "call",
      id: 11,
      method: "chat.resolveControlRequest",
      params: { ...SESSION, requestId: "r1", kind: "question", answer: "" },
    });
    await flush();
    expect(sent().at(-1)).toMatchObject({
      type: "result",
      id: 11,
      ok: false,
      error: { code: -32602 },
    });
  });

  it("unsubscribing invalidates subsequent sends", async () => {
    const { receive, sent } = createChatHarness();
    receive({ type: "unsub", id: 91, scope: "chat:p1:a1:s1" });
    receive({ type: "call", id: 12, method: "chat.send", params: { ...SESSION, content: "hello" } });
    await flush();
    expect(sent().at(-1)).toMatchObject({
      type: "result",
      id: 12,
      ok: false,
      error: { code: 102 },
    });
  });
});
