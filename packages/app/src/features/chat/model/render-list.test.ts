import { describe, expect, it } from "vitest";
import type { AgentEvent } from "./agent-event-parse";
import { buildRenderList } from "./render-list";
import {
  createInitialSessionData,
  createOutboxEntry,
  reduceSessionEvents,
} from "./session-events";
import type { ChatMessage, ChatSessionData } from "../types";

function messageEvent(
  type: "message_start" | "message_update" | "message_end",
  message: unknown,
): AgentEvent {
  return { type, message } as AgentEvent;
}

function assistantEmpty(): unknown {
  return { role: "assistant", content: [] };
}

function assistantText(text: string): unknown {
  return { role: "assistant", content: [{ type: "text", text }] };
}

function withHistory(
  session: ChatSessionData,
  messages: ChatMessage[],
): ChatSessionData {
  return { ...session, history: { ...session.history, messages } };
}

describe("buildRenderList", () => {
  it("renders history first and interleaves outbox and run nodes by seq", () => {
    let session = withHistory(createInitialSessionData(), [
      { _messageId: 1, role: "user", content: "q1" },
      { _messageId: 2, role: "assistant", content: "a1" },
    ]);

    const first = createOutboxEntry(session, "first", undefined, false, "first");
    session = first.session;
    session = reduceSessionEvents(session, [{ type: "agent_start" }], 10);
    session = reduceSessionEvents(session, [
      messageEvent("message_start", assistantEmpty()),
      messageEvent("message_end", assistantText("r1")),
    ], 11);

    const second = createOutboxEntry(session, "second", undefined, false, "second");
    session = second.session;

    const items = buildRenderList(session);

    expect(items.map((item) => item.key)).toEqual([
      "h-1",
      "h-2",
      "o-first",
      "r-2-0",
      "o-second",
    ]);
    expect(items.map((item) => item.message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
    ]);
    expect(items.map((item) => item.message.content)).toEqual([
      "q1",
      "a1",
      "first",
      "r1",
      "second",
    ]);
  });

  it("assigns stable keys h-/o-/r- to items", () => {
    let session = withHistory(createInitialSessionData(), [
      { _messageId: 7, role: "user", content: "q" },
    ]);
    const created = createOutboxEntry(session, "hello", undefined, false, "1");
    session = created.session;
    session = reduceSessionEvents(session, [{ type: "agent_start" }], 1);
    session = reduceSessionEvents(session, [
      messageEvent("message_start", assistantEmpty()),
      messageEvent("message_end", assistantText("s0")),
      messageEvent("message_start", assistantEmpty()),
      messageEvent("message_update", assistantText("s1")),
    ], 2);

    expect(buildRenderList(session).map((item) => item.key)).toEqual([
      "h-7",
      "o-1",
      "r-2-0",
      "r-2-1",
    ]);
  });

  it("marks only the unfinished tail segment of an active run as streaming", () => {
    let session = createInitialSessionData();
    session = reduceSessionEvents(session, [{ type: "agent_start" }], 1);
    session = reduceSessionEvents(session, [
      messageEvent("message_start", assistantEmpty()),
      messageEvent("message_end", assistantText("done seg")),
      messageEvent("message_start", assistantEmpty()),
      messageEvent("message_update", assistantText("streaming")),
    ], 2);

    const items = buildRenderList(session);

    expect(items.map((item) => item.key)).toEqual(["r-1-0", "r-1-1"]);
    expect(items[0].streaming).toBeUndefined();
    expect(items[1].streaming).toBe(true);
  });

  it("clears streaming when the tail segment finishes or the run goes inactive", () => {
    let session = createInitialSessionData();
    session = reduceSessionEvents(session, [{ type: "agent_start" }], 1);
    session = reduceSessionEvents(
      session,
      [messageEvent("message_update", assistantText("partial"))],
      2,
    );
    expect(buildRenderList(session)[0].streaming).toBe(true);

    const finished = reduceSessionEvents(
      session,
      [messageEvent("message_end", assistantText("partial"))],
      3,
    );
    expect(buildRenderList(finished)[0].streaming).toBeUndefined();

    const inactive = reduceSessionEvents(finished, [{ type: "run_status", active: false }], 4);
    expect(buildRenderList(inactive)[0].streaming).toBeUndefined();
  });

  it("flags failed outbox entries with sendFailed", () => {
    let session = createInitialSessionData();
    const failed = createOutboxEntry(session, "boom", undefined, true, "failed");
    session = failed.session;
    const pending = createOutboxEntry(session, "hello", undefined, false, "pending");
    session = pending.session;

    const items = buildRenderList(session);

    expect(items.map((item) => item.key)).toEqual(["o-failed", "o-pending"]);
    expect(items[0].sendFailed).toBe(true);
    expect(items[1].sendFailed).toBeUndefined();
  });

  it("aggregates run changes onto the last assistant item within each run boundary", () => {
    let session = withHistory(createInitialSessionData(), [
      { _messageId: 1, role: "user", content: "q0" },
      {
        _messageId: 2,
        role: "assistant",
        content: "old answer",
        _toolCalls: [
          {
            toolCallId: "old1",
            toolName: "write_file",
            args: { path: "old.txt", content: "old" },
            status: "completed",
          },
        ],
      },
      { _messageId: 3, role: "user", content: "write files" },
    ]);
    session = reduceSessionEvents(session, [{ type: "agent_start" }], 1);
    session = reduceSessionEvents(session, [
      { type: "tool_execution_start", toolCallId: "tc1", toolName: "write_file", args: { path: "a.txt", content: "a" } },
      { type: "tool_execution_end", toolCallId: "tc1", toolName: "write_file", result: "ok", isError: false },
      messageEvent("message_end", assistantText("writing")),
      { type: "tool_execution_start", toolCallId: "tc2", toolName: "edit_file", args: { path: "b.txt", oldText: "x", newText: "y" } },
      { type: "tool_execution_end", toolCallId: "tc2", toolName: "edit_file", result: "ok", isError: false },
      messageEvent("message_start", assistantEmpty()),
      messageEvent("message_end", assistantText("done")),
    ], 2);

    const items = buildRenderList(session);

    expect(items.map((item) => item.key)).toEqual([
      "h-1",
      "h-2",
      "h-3",
      "r-1-0",
      "r-1-1",
    ]);
    expect(items[1].message._runChanges?.map((change) => change.path)).toEqual(["old.txt"]);
    expect(items[3].message._runChanges).toBeUndefined();
    expect(items[4].message._runChanges).toEqual([
      {
        path: "a.txt",
        ops: [
          { toolCallId: "tc1", toolName: "write_file", args: { path: "a.txt", content: "a" } },
        ],
      },
      {
        path: "b.txt",
        ops: [
          { toolCallId: "tc2", toolName: "edit_file", args: { path: "b.txt", oldText: "x", newText: "y" } },
        ],
      },
    ]);
  });

  it("projects withdrawError onto the trailing error item", () => {
    let session = withHistory(createInitialSessionData(), [
      { _messageId: 1, role: "user", content: "q" },
    ]);
    session = reduceSessionEvents(session, [{ type: "agent_start" }], 1);
    session = reduceSessionEvents(session, [
      messageEvent("message_update", assistantText("partial")),
      { type: "error", message: "withdraw failed" },
    ], 2);

    expect(buildRenderList(session)[1].withdrawError).toBeUndefined();

    session = { ...session, withdrawError: true };
    const items = buildRenderList(session);
    const last = items[items.length - 1];

    expect(last.message._error).toBe("withdraw failed");
    expect(last.withdrawError).toBe(true);
  });

  it("projects an html card from render_card result details", () => {
    let session = createInitialSessionData();
    session = reduceSessionEvents(session, [
      { type: "agent_start" },
      { type: "tool_execution_start", toolCallId: "tc1", toolName: "render_card", args: { content: "<h1>Hi</h1>" } },
      {
        type: "tool_execution_end",
        toolCallId: "tc1",
        toolName: "render_card",
        result: { details: { cardType: "html", html: "<h1>Hi</h1>", title: "Test" } },
        isError: false,
      },
    ], 1);

    const items = buildRenderList(session);
    const toolCall = items[0].message._toolCalls?.[0];

    expect(toolCall?.resultDetails).toEqual({ cardType: "html", html: "<h1>Hi</h1>", title: "Test" });
    expect(toolCall?._card?.type).toBe("html");
    expect(toolCall?._card).toMatchObject({ html: "<h1>Hi</h1>", title: "Test" });
  });

  it("projects a pending question card from a pending interaction", () => {
    let session = createInitialSessionData();
    const args = { question: "Deploy?", options: ["yes", "no"] };
    session = reduceSessionEvents(session, [
      { type: "agent_start" },
      { type: "tool_execution_start", toolCallId: "tq1", toolName: "ask_user", args },
      {
        type: "control_request",
        requestId: "q1",
        kind: "question",
        toolCallId: "tq1",
        toolName: "ask_user",
        args,
      },
    ], 1);

    const items = buildRenderList(session);
    const card = items[0].message._toolCalls?.[0]?._card;

    expect(card).toMatchObject({
      type: "question",
      status: "pending",
      question: "Deploy?",
      options: ["yes", "no"],
      requestId: "q1",
    });
  });

  it("returns an empty list for an empty session", () => {
    expect(buildRenderList(createInitialSessionData())).toEqual([]);
  });
});
