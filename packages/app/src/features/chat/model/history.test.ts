import { describe, expect, it } from "vitest";
import { ErrorEventCode } from "@spherse/contracts";
import { consumeOutbox, mergeHistoryPage, parseHistoryMessages } from "./history";
import type { ChatMessage, OutboxEntry } from "../types";

describe("parseHistoryMessages", () => {
  it("parses user messages with ids, timestamps and extracted text", () => {
    const result = parseHistoryMessages([
      { id: 1, message: { role: "user", content: "hello", timestamp: 1000 } },
      { id: 2, message: { role: "user", content: [{ type: "text", text: "arranged" }], timestamp: 2000 } },
    ]);

    expect(result[0]).toMatchObject({ _messageId: 1, role: "user", content: "hello", timestamp: 1000 });
    expect(result[1]).toMatchObject({ _messageId: 2, role: "user", content: "arranged", timestamp: 2000 });
  });

  it("parses assistant text content", () => {
    const result = parseHistoryMessages([
      { id: 1, message: { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop", timestamp: 2 } },
    ]);

    expect(result[0]).toMatchObject({ _messageId: 1, role: "assistant", content: "done", timestamp: 2 });
    expect(result[0]._error).toBeUndefined();
  });

  it("maps source/triggerName onto user view fields", () => {
    const result = parseHistoryMessages([
      { id: 1, message: { role: "user", content: "report", timestamp: 1 }, source: "triggered", triggerName: "每日汇报" },
      { id: 2, message: { role: "assistant", content: [{ type: "text", text: "done" }], timestamp: 2 } },
      { id: 3, message: { role: "user", content: "manual", timestamp: 3 } },
    ]);

    expect(result[0]).toMatchObject({
      _messageId: 1,
      role: "user",
      content: "report",
      _triggered: true,
      _triggerName: "每日汇报",
    });
    expect(result[2]).toMatchObject({ _messageId: 3, role: "user", content: "manual" });
    expect(result[2]._triggered).toBeUndefined();
    expect(result[2]._triggerName).toBeUndefined();
  });

  it("sets _triggered even when triggerName is missing", () => {
    const result = parseHistoryMessages([
      { id: 1, message: { role: "user", content: "x", timestamp: 1 }, source: "triggered" },
    ]);

    expect(result[0]._triggered).toBe(true);
    expect(result[0]._triggerName).toBeUndefined();
  });

  it("keeps plain arrays of messages working", () => {
    const result = parseHistoryMessages([{ role: "user", content: "x" }]);

    expect(result[0]).toMatchObject({ role: "user", content: "x" });
    expect(result[0]._messageId).toBeUndefined();
    expect(result[0]._triggered).toBeUndefined();
  });

  it("keeps non-empty user attachments and omits empty arrays", () => {
    const attachments = [{ type: "image", path: "/tmp/a.png", mimeType: "image/png" }];
    const result = parseHistoryMessages([
      { id: 1, message: { role: "user", content: "see", _attachments: attachments } },
      { id: 2, message: { role: "user", content: "nothing", _attachments: [] } },
    ]);

    expect(result[0]._attachments).toEqual(attachments);
    expect(result[1]._attachments).toBeUndefined();
  });

  it("enriches toolCalls with result, status and resultDetails from toolResult messages", () => {
    const result = parseHistoryMessages([
      { id: 1, message: { role: "user", content: "write", timestamp: 1 } },
      {
        id: 2,
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "ok" },
            { type: "toolCall", id: "tc1", name: "write_file", arguments: { path: "a.txt", content: "a" } },
          ],
          stopReason: "stop",
          timestamp: 2,
        },
      },
      {
        id: 3,
        message: {
          role: "toolResult",
          toolCallId: "tc1",
          content: [{ type: "text", text: "done" }],
          details: { ok: true },
          isError: false,
          timestamp: 3,
        },
      },
    ]);

    expect(result).toHaveLength(2);
    expect(result[1]._toolCalls?.[0]).toMatchObject({
      toolCallId: "tc1",
      toolName: "write_file",
      args: { path: "a.txt", content: "a" },
      status: "completed",
      result: "done",
      isError: false,
      resultDetails: { ok: true },
    });
    expect(result[1]._toolCalls?.[0]?._card).toBeUndefined();
    expect(result[1]._runChanges).toBeUndefined();
  });

  it("marks toolCalls as error when the toolResult reports isError", () => {
    const result = parseHistoryMessages([
      {
        id: 1,
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "tc1", name: "run_command", arguments: { command: "ls" } }],
          stopReason: "stop",
        },
      },
      {
        id: 2,
        message: { role: "toolResult", toolCallId: "tc1", content: "boom", isError: true },
      },
    ]);

    const toolCall = result[0]._toolCalls?.[0];
    expect(toolCall?.status).toBe("error");
    expect(toolCall?.isError).toBe(true);
    expect(toolCall?.result).toBe("boom");
  });

  it("defaults unmatched toolCalls to completed without result fields", () => {
    const result = parseHistoryMessages([
      {
        id: 1,
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "tc1", name: "write_file", arguments: { path: "a.txt" } }],
          stopReason: "stop",
        },
      },
    ]);

    const toolCall = result[0]._toolCalls?.[0];
    expect(toolCall).toMatchObject({ toolCallId: "tc1", toolName: "write_file", status: "completed" });
    expect(toolCall?.result).toBeUndefined();
    expect(toolCall?.resultDetails).toBeUndefined();
    expect(toolCall?.isError).toBeUndefined();
    expect(toolCall?._card).toBeUndefined();
    expect(result[0]._runChanges).toBeUndefined();
  });

  it("stores render_card result details on the toolCall instead of projecting a card", () => {
    const result = parseHistoryMessages([
      { id: 1, message: { role: "user", content: "show card" } },
      {
        id: 2,
        message: {
          role: "assistant",
          content: [
            { type: "toolCall", id: "tc1", name: "render_card", arguments: { type: "html", content: "<h1>Hi</h1>" } },
          ],
          stopReason: "stop",
        },
      },
      {
        id: 3,
        message: {
          role: "toolResult",
          toolCallId: "tc1",
          content: [{ type: "text", text: "HTML card rendered successfully" }],
          details: { cardType: "html", title: "Test", height: 400, max_width: 800, max_height: 600 },
        },
      },
    ]);

    const toolCall = result[1]._toolCalls?.[0];
    expect(toolCall?.resultDetails).toEqual({
      cardType: "html",
      title: "Test",
      height: 400,
      max_width: 800,
      max_height: 600,
    });
    expect(toolCall?.result).toBe("HTML card rendered successfully");
    expect(toolCall?.status).toBe("completed");
    expect(toolCall?._card).toBeUndefined();
  });

  it("maps stopReason error onto _error fields", () => {
    const result = parseHistoryMessages([
      { id: 1, message: { role: "assistant", content: [], stopReason: "error", errorMessage: "Rate limit exceeded" } },
    ]);

    expect(result[0]._error).toBe("Rate limit exceeded");
    expect(result[0]._errorCode).toBe(ErrorEventCode.Transient);
    expect(result[0]._turnError).toBe(true);
  });
});

describe("mergeHistoryPage", () => {
  it("merges pages by message id ascending and preserves parsed trigger fields", () => {
    const older = parseHistoryMessages([
      { id: 1, message: { role: "user", content: "report", timestamp: 1 }, source: "triggered", triggerName: "t" },
      { id: 2, message: { role: "assistant", content: [{ type: "text", text: "done" }], timestamp: 2 } },
    ]);
    const newer = parseHistoryMessages([
      { id: 3, message: { role: "user", content: "hi", timestamp: 3 } },
    ]);

    const merged = mergeHistoryPage(older, newer);

    expect(merged.map((message) => message._messageId)).toEqual([1, 2, 3]);
    expect(merged.find((message) => message._messageId === 1)).toMatchObject({
      _triggered: true,
      _triggerName: "t",
    });
  });

  it("lets incoming messages win on duplicate ids", () => {
    const existing: ChatMessage[] = [{ _messageId: 1, role: "user", content: "old" }];
    const incoming: ChatMessage[] = [{ _messageId: 1, role: "user", content: "updated" }];

    const merged = mergeHistoryPage(existing, incoming);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toBe(incoming[0]);
  });

  it("sorts the merged output ascending regardless of input order", () => {
    const existing: ChatMessage[] = [
      { _messageId: 3, role: "user", content: "3" },
      { _messageId: 1, role: "user", content: "1" },
    ];
    const incoming: ChatMessage[] = [{ _messageId: 2, role: "user", content: "2" }];

    expect(mergeHistoryPage(existing, incoming).map((message) => message._messageId)).toEqual([1, 2, 3]);
  });

  it("drops messages without a message id", () => {
    const parsed = parseHistoryMessages([{ role: "user", content: "x" }]);
    const incoming: ChatMessage[] = [{ role: "user", content: "y" }];

    expect(mergeHistoryPage(parsed, incoming)).toEqual([]);
  });
});

function outboxEntry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    id: "o1",
    seq: 1,
    content: "hello",
    timestamp: 1000,
    status: "pending",
    sentAfterMessageId: null,
    ...overrides,
  };
}

function historyUser(id: number, content: string): ChatMessage {
  return { _messageId: id, role: "user", content };
}

describe("consumeOutbox", () => {
  it("consumes entries matching content and id and keeps unmatched ones", () => {
    const outbox = [
      outboxEntry({ id: "o1", content: "hello" }),
      outboxEntry({ id: "o2", content: "world" }),
    ];
    const history: ChatMessage[] = [
      historyUser(1, "hello"),
      { role: "user", content: "world" },
      historyUser(2, "other"),
    ];

    const kept = consumeOutbox(outbox, history);

    expect(kept.map((entry) => entry.id)).toEqual(["o2"]);
  });

  it("consumes one history message per entry when duplicate texts are sent twice", () => {
    const outbox = [
      outboxEntry({ id: "o1", content: "same" }),
      outboxEntry({ id: "o2", content: "same" }),
    ];
    const history = [historyUser(1, "same"), historyUser(2, "same")];

    expect(consumeOutbox(outbox, history)).toEqual([]);
  });

  it("matches any history id when sentAfterMessageId is null", () => {
    const outbox = [outboxEntry({ sentAfterMessageId: null })];
    const history = [historyUser(5, "hello")];

    expect(consumeOutbox(outbox, history)).toEqual([]);
  });

  it("does not consume history messages with id <= sentAfterMessageId", () => {
    const outbox = [outboxEntry({ sentAfterMessageId: 3 })];

    expect(consumeOutbox(outbox, [historyUser(3, "hello")]).map((entry) => entry.id)).toEqual(["o1"]);
    expect(consumeOutbox(outbox, [historyUser(4, "hello")])).toEqual([]);
  });

  it("consumes failed entries as well", () => {
    const outbox = [outboxEntry({ status: "failed" })];
    const history = [historyUser(1, "hello")];

    expect(consumeOutbox(outbox, history)).toEqual([]);
  });

  it("consumes each history message at most once", () => {
    const outbox = [
      outboxEntry({ id: "o1", content: "hello" }),
      outboxEntry({ id: "o2", content: "hello" }),
    ];
    const history = [historyUser(1, "hello")];

    expect(consumeOutbox(outbox, history).map((entry) => entry.id)).toEqual(["o2"]);
  });

  it("returns the input array unchanged when nothing is consumed", () => {
    const outbox = [outboxEntry({ content: "nope" })];

    expect(consumeOutbox(outbox, [historyUser(1, "hello")])).toBe(outbox);
  });

  it("returns the input array for an empty outbox", () => {
    const outbox: OutboxEntry[] = [];

    expect(consumeOutbox(outbox, [historyUser(1, "x")])).toBe(outbox);
  });
});
