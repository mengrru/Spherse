import { describe, expect, it } from "vitest";
import type { SessionMessagesPageResponse } from "@spherse/contracts";
import type { AgentEvent } from "./agent-event-parse";
import { applyHistoryPage, parseHistoryEntries } from "./history-entries";
import { createEntryState, reduceLiveEvents } from "./entry-reducer";
import type { AssistantEntry, ErrorEntry, UserEntry } from "./entry";

function event(payload: object): AgentEvent {
  return payload as unknown as AgentEvent;
}

function page(
  entries: SessionMessagesPageResponse["entries"],
  hasMore = false,
): SessionMessagesPageResponse {
  return { entries, hasMore, oldestId: entries[0]?.id ?? null };
}

function assistantMessage(text: string, extra: Record<string, unknown> = {}) {
  return { role: "assistant", content: [{ type: "text", text }], ...extra };
}

describe("history entries", () => {
  it("parses user, assistant and tool result entries with identity", () => {
    const parsed = parseHistoryEntries([
      {
        id: 1,
        message: { role: "user", content: "hi", timestamp: 10 },
        source: "triggered",
        triggerName: "cron",
      },
      {
        id: 2,
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "hello" },
            { type: "toolCall", id: "tc1", name: "read_file", arguments: { path: "a" } },
          ],
          timestamp: 11,
        },
      },
      {
        id: 3,
        message: {
          role: "toolResult",
          toolCallId: "tc1",
          content: [{ type: "text", text: "data" }],
          isError: false,
          details: { kind: "file" },
          timestamp: 12,
        },
      },
    ]);

    expect(parsed[0]).toMatchObject({
      kind: "user",
      id: "e1",
      seq: 1,
      text: "hi",
      triggered: true,
      triggerName: "cron",
      time: 10,
    });
    expect(parsed[1]).toMatchObject({
      kind: "assistant",
      id: "e2",
      seq: 2,
      text: "hello",
      toolCalls: [{ toolCallId: "tc1", toolName: "read_file", args: { path: "a" } }],
    });
    expect(parsed[2]).toMatchObject({
      kind: "tool-result",
      id: "e3",
      seq: 3,
      toolCallId: "tc1",
      ownerId: "e2",
      result: "data",
      isError: false,
      details: { kind: "file" },
    });
  });

  it("drops the local in-flight window on a latest page merge", () => {
    let state = createEntryState();
    state = reduceLiveEvents(state, [event({ type: "message_start", message: assistantMessage("") })], 1);
    state = reduceLiveEvents(state, [event({ type: "message_update", message: assistantMessage("partial") })], 2);
    expect(state.entries).toHaveLength(1);

    const next = applyHistoryPage(state, page([
      { id: 1, message: { role: "user", content: "hi", timestamp: 10 } },
      { id: 2, message: assistantMessage("done", { timestamp: 20 }) },
    ]), "latest");

    expect(next.entries.map((entry) => entry.kind)).toEqual(["user", "assistant"]);
    expect((next.entries[1] as AssistantEntry).text).toBe("done");
    expect(next.openStreamId).toBeNull();
    expect(next.cursor).toBe(2);
  });

  it("settles optimistic user entries by content and keeps unmatched ones", () => {
    const optimistic: UserEntry = { kind: "user", id: "c1", text: "hi", optimistic: true, clientId: "c1" };
    const pending: UserEntry = { kind: "user", id: "c2", text: "later", optimistic: true, clientId: "c2" };
    const state = { ...createEntryState(), entries: [optimistic, pending] };

    const next = applyHistoryPage(state, page([
      { id: 1, message: { role: "user", content: "hi" } },
    ]), "latest");

    expect(next.entries).toHaveLength(2);
    expect(next.entries.find((entry) => entry.kind === "user" && entry.text === "hi")?.seq).toBe(1);
    const remaining = next.entries.filter((entry) => entry.kind === "user" && entry.optimistic);
    expect(remaining).toHaveLength(1);
    expect((remaining[0] as UserEntry).text).toBe("later");
  });

  it("keeps error entries and local tail on a latest merge", () => {
    const error: ErrorEntry = { kind: "error", id: "x1", message: "boom" };
    const state = { ...createEntryState(), entries: [error] };
    const next = applyHistoryPage(state, page([
      { id: 1, message: { role: "user", content: "hi" } },
    ]), "latest");
    expect(next.entries.map((entry) => entry.kind)).toEqual(["user", "error"]);
  });

  it("prepends older pages without dropping the local in-flight window on loadMore", () => {
    const user: UserEntry = { kind: "user", id: "e5", seq: 5, text: "newer" };
    const streaming: AssistantEntry = { kind: "assistant", id: "s1", streamId: "s1", text: "partial", toolCalls: [], streaming: true };
    const state = { ...createEntryState(), entries: [user, streaming], openStreamId: "s1", ownerAssistantId: "s1" };

    const next = applyHistoryPage(state, page([
      { id: 1, message: { role: "user", content: "older" } },
      { id: 2, message: assistantMessage("older answer") },
    ]), "loadMore");

    expect(next.entries.map((entry) => entry.seq ?? "tail")).toEqual([1, 2, 5, "tail"]);
    expect(next.openStreamId).toBe("s1");
    expect(next.cursor).toBe(-1);
  });

  it("preserves the existing entry id when upserting a persisted seq", () => {
    const existing: UserEntry = { kind: "user", id: "custom", seq: 1, text: "old" };
    const state = { ...createEntryState(), entries: [existing] };
    const next = applyHistoryPage(state, page([
      { id: 1, message: { role: "user", content: "new" } },
    ]), "latest");
    expect(next.entries[0]).toMatchObject({ id: "custom", text: "new" });
  });

  it("prunes dangling window references after a latest merge", () => {
    let state = createEntryState();
    state = reduceLiveEvents(state, [event({ type: "message_start", message: assistantMessage("") })], 1);
    const next = applyHistoryPage(state, page([
      { id: 1, message: assistantMessage("done") },
    ]), "latest");
    expect(next.openStreamId).toBeNull();
    expect(next.ownerAssistantId).toBeNull();
  });

  it("parses an assistant error from stopReason", () => {
    const parsed = parseHistoryEntries([
      {
        id: 1,
        message: assistantMessage("", { stopReason: "error", errorMessage: "rate limit exceeded" }),
      },
    ]);
    const assistant = parsed[0] as AssistantEntry;
    expect(assistant.error?.message).toBe("rate limit exceeded");
    expect(assistant.error?.code).toBe("TRANSIENT");
  });
});
