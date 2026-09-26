import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { SessionStore } from "../../store/session.js";
import type { SessionEvent } from "../../session/events.js";

function userMsg(text: string, timestamp: number): AgentMessage {
  return { role: "user", content: text, timestamp } as AgentMessage;
}

function assistantMsg(text: string, timestamp: number): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: "stop",
    timestamp,
  } as unknown as AgentMessage;
}

function toolResultMsg(timestamp: number): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: "t1",
    toolName: "search",
    content: [{ type: "text", text: "the needle is in the tool result" }],
    timestamp,
  } as unknown as AgentMessage;
}

describe("SessionStore.searchMessages", () => {
  let store: SessionStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-session-search-"));
    store = new SessionStore(path.join(tmpDir, "sessions.db"), "agent-1");
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function append(sessionId: string, events: Array<Omit<SessionEvent, "seq"> & { seq?: number }>): void {
    store.appendEvents(
      sessionId,
      events.map((event, index) => ({ seq: event.seq ?? index, ...event }) as SessionEvent),
      1,
    );
  }

  it("matches user and assistant text but not tool results", () => {
    const id = store.createSession("titled");
    append(id, [
      { type: "turn/start", time: 1, data: {} },
      { type: "user/message", time: 2, data: { message: userMsg("find the needle please", 2) } },
      { type: "assistant/message", time: 3, data: { message: assistantMsg("needle found", 3) } },
      { type: "tool/result", time: 4, data: { message: toolResultMsg(4) } },
      { type: "turn/end", time: 5, data: { reason: "completed" } },
    ]);

    const hits = store.searchMessages("needle", 100);
    expect(hits.map((hit) => hit.role)).toEqual(["assistant", "user"]);
    expect(hits[0]).toMatchObject({
      sessionId: id,
      sessionTitle: "titled",
      seq: 2,
      snippet: "needle found",
    });
    expect(hits[1]).toMatchObject({ seq: 1, snippet: "find the needle please" });
  });

  it("returns empty for blank query", () => {
    const id = store.createSession();
    append(id, [{ type: "user/message", time: 1, data: { message: userMsg("needle", 1) } }]);
    expect(store.searchMessages("   ", 100)).toEqual([]);
  });

  it("excludes archived sessions", () => {
    const id = store.createSession();
    append(id, [{ type: "user/message", time: 1, data: { message: userMsg("needle", 1) } }]);
    store.archiveSession(id);
    expect(store.searchMessages("needle", 100)).toEqual([]);
  });

  it("drops hits abandoned by withdraw or retry", () => {
    const id = store.createSession();
    append(id, [
      { type: "turn/start", time: 1, data: {} },
      { type: "user/message", time: 2, data: { message: userMsg("needle v1", 2) } },
      { type: "assistant/message", time: 3, data: { message: assistantMsg("needle v1 answer", 3) } },
      { type: "turn/withdrawn", time: 4, data: { seq: 1 } },
      { type: "user/message", time: 5, data: { message: userMsg("fresh question", 5) } },
      { type: "assistant/message", time: 6, data: { message: assistantMsg("needle bad answer", 6) } },
      { type: "turn/retried", time: 7, data: { abandonedSeqs: [5] } },
      { type: "assistant/message", time: 8, data: { message: assistantMsg("needle retry answer", 8) } },
    ]);

    const hits = store.searchMessages("needle", 100);
    expect(hits.map((hit) => hit.seq)).toEqual([7]);
  });

  it("filters LIKE structural false positives via the JS pass", () => {
    const id = store.createSession();
    append(id, [
      { type: "user/message", time: 1, data: { message: userMsg("totally unrelated", 1) } },
    ]);
    expect(store.searchMessages("message", 100)).toEqual([]);
  });

  it("escapes LIKE wildcards so they match literally", () => {
    const id = store.createSession();
    append(id, [
      { type: "user/message", time: 1, data: { message: userMsg("100% sure", 1) } },
      { type: "user/message", time: 2, data: { message: userMsg("nothing here", 2) } },
    ]);
    const hits = store.searchMessages("100%", 100);
    expect(hits.map((hit) => hit.seq)).toEqual([0]);
  });

  it("sorts by time descending across sessions and respects prefetch limit", () => {
    const older = store.createSession("older");
    append(older, [{ type: "user/message", time: 10, data: { message: userMsg("needle old", 10) } }]);
    const newer = store.createSession("newer");
    append(newer, [{ type: "user/message", time: 20, data: { message: userMsg("needle new", 20) } }]);

    expect(store.searchMessages("needle", 100).map((hit) => hit.sessionTitle)).toEqual([
      "newer",
      "older",
    ]);
    expect(store.searchMessages("needle", 1)).toHaveLength(1);
  });

  it("omits sessionTitle for untitled sessions instead of null", () => {
    const id = store.createSession();
    append(id, [{ type: "user/message", time: 1, data: { message: userMsg("needle", 1) } }]);
    const hit = store.searchMessages("needle", 100)[0];
    expect(hit.sessionTitle).toBeUndefined();
    expect("sessionTitle" in hit).toBe(false);
  });
});
