import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@spherse/core";
import { initialRunTail, reduceRunTail } from "./run-tail";
import type { AgentEvent } from "../model/agent-event-parse";

function assistantEvent(content: string | unknown[] = []): AgentMessage {
  return {
    role: "assistant",
    content: content === "" ? [] : Array.isArray(content) ? content : [{ type: "text", text: content }],
    timestamp: 1000,
  } as unknown as AgentMessage;
}

const NOW = 1000;

function reduce(events: AgentEvent[], mutate?: (run: ReturnType<typeof initialRunTail>) => ReturnType<typeof initialRunTail>) {
  let run = initialRunTail();
  if (mutate) run = mutate(run);
  for (const event of events) {
    run = reduceRunTail(run, event, { highSeq: null, now: NOW });
  }
  return run;
}

function messageUpdate(text: string): AgentEvent {
  return { type: "message_update", message: assistantEvent(text) };
}

function toolStart(toolCallId: string, toolName = "write_file", args: Record<string, unknown> = {}): AgentEvent {
  return { type: "tool_execution_start", toolCallId, toolName, args };
}

describe("run tail: draft lifecycle", () => {
  it("creates a streaming assistant draft on message_start and updates it on message_update", () => {
    const run = reduce([
      { type: "message_start", message: assistantEvent() },
      messageUpdate("hello "),
      messageUpdate("hello world"),
    ]);
    expect(run.draft).toMatchObject({ role: "assistant", content: "hello world", _streaming: true });
  });

  it("keeps only one draft when message_start repeats", () => {
    const run = reduce([
      { type: "message_start", message: assistantEvent() },
      messageUpdate("a"),
      { type: "message_start", message: assistantEvent() },
    ]);
    expect(run.draft?.content).toBe("a");
  });

  it("closes the draft on message_end carrying a seq (settle hands ownership to durable)", () => {
    const run = reduce([
      { type: "message_start", message: assistantEvent() },
      messageUpdate("final"),
      { type: "message_end", message: assistantEvent("final"), seq: 4 },
    ]);
    expect(run.draft).toBeNull();
  });

  it("finalizes the draft in place on a seq-less message_end (v1 fallback)", () => {
    const run = reduce([
      { type: "message_start", message: assistantEvent() },
      messageUpdate("partial"),
      { type: "message_end", message: { ...assistantEvent("partial"), stopReason: "aborted" } as unknown as AgentMessage },
    ]);
    expect(run.draft).toMatchObject({ content: "partial", _streaming: false });
  });

  it("starts a new draft from a message_update after the previous message ended", () => {
    const run = reduce([
      { type: "message_start", message: assistantEvent() },
      { type: "message_end", message: assistantEvent(), seq: 1 },
      messageUpdate("second"),
    ]);
    expect(run.draft).toMatchObject({ content: "second", _streaming: true });
  });
});

describe("run tail: run lifecycle", () => {
  it("activates on agent_start and records the watermark as the run scope start", () => {
    let run = initialRunTail();
    run = reduceRunTail(run, { type: "agent_start" }, { highSeq: 6, now: NOW });
    expect(run.active).toBe(true);
    expect(run.startedAfterSeq).toBe(6);
  });

  it("ends the run on run_status inactive, freezing the draft and clearing pending question cards", () => {
    const run = reduce(
      [
        { type: "agent_start" },
        toolStart("t1", "ask_user", { question: "q?", options: ["a", "b"] }),
        { type: "control_request", requestId: "r1", kind: "question", toolCallId: "t1", toolName: "ask_user", args: { question: "q?" } },
        { type: "message_start", message: assistantEvent() },
        messageUpdate("streaming"),
        { type: "run_status", active: false },
      ],
    );
    expect(run.active).toBe(false);
    expect(run.draft).toMatchObject({ content: "streaming", _streaming: false });
    expect(run.tools[0]._card).toBeUndefined();
  });

  it("keeps pending approval cards when the run ends", () => {
    const run = reduce([
      { type: "agent_start" },
      toolStart("t1", "run_command", { command: "ls" }),
      { type: "control_request", requestId: "r1", kind: "approval", toolCallId: "t1", toolName: "run_command", args: { command: "ls" } },
      { type: "agent_end", messages: [] },
    ]);
    expect(run.tools[0]._card).toMatchObject({ type: "command", status: "pending_approval", requestId: "r1" });
  });
});

describe("run tail: tool overlay", () => {
  it("tracks tool execution status and terminal results", () => {
    const run = reduce([
      { type: "agent_start" },
      toolStart("t1"),
      { type: "tool_execution_update", toolCallId: "t1", toolName: "write_file", args: {}, partialResult: { details: { cardType: "html", html: "<b/>" } } },
      { type: "tool_execution_end", toolCallId: "t1", toolName: "write_file", result: { details: {} }, isError: false },
    ]);
    expect(run.tools[0]).toMatchObject({ toolCallId: "t1", status: "completed", result: JSON.stringify({ details: {} }) });
  });

  it("marks error results", () => {
    const run = reduce([
      toolStart("t1"),
      { type: "tool_execution_end", toolCallId: "t1", toolName: "write_file", result: "boom", isError: true },
    ]);
    expect(run.tools[0]).toMatchObject({ status: "error", result: "boom" });
  });

  it("flows an approval card through pending → approved → running", () => {
    const run = reduce([
      toolStart("t1", "run_command", { command: "npm test" }),
      { type: "control_request", requestId: "r1", kind: "approval", toolCallId: "t1", toolName: "run_command", args: { command: "npm test" } },
      { type: "control_resolved", requestId: "r1", kind: "approval", approved: true },
    ]);
    expect(run.tools[0]._card).toMatchObject({ type: "command", status: "running" });
  });

  it("marks a denied approval as a rejected command card", () => {
    const run = reduce([
      toolStart("t1", "run_command", { command: "rm -rf /" }),
      { type: "control_request", requestId: "r1", kind: "approval", toolCallId: "t1", toolName: "run_command", args: { command: "rm" } },
      { type: "control_resolved", requestId: "r1", kind: "approval", approved: false },
    ]);
    expect(run.tools[0]._card).toMatchObject({ type: "command", status: "error", rejected: true });
  });

  it("attaches a generic approval card for non-run_command tools", () => {
    const run = reduce([
      toolStart("t1", "write_file", { path: "/a" }),
      { type: "control_request", requestId: "r1", kind: "approval", toolCallId: "t1", toolName: "write_file", args: {} },
    ]);
    expect(run.tools[0]._card).toMatchObject({ type: "approval", status: "pending", toolName: "write_file", requestId: "r1" });
    const resolved = reduceRunTail(run, { type: "control_resolved", requestId: "r1", kind: "approval", approved: true }, { highSeq: null, now: NOW });
    expect(resolved.tools[0]._card).toMatchObject({ type: "approval", status: "approved" });
    expect((resolved.tools[0]._card as { requestId?: string }).requestId).toBeUndefined();
  });

  it("answers and times out question cards", () => {
    const answered = reduce([
      toolStart("t1", "ask_user", { question: "q?" }),
      { type: "control_request", requestId: "r1", kind: "question", toolCallId: "t1", toolName: "ask_user", args: { question: "q?" } },
      { type: "control_resolved", requestId: "r1", kind: "question", answer: "yes", timedOut: false },
    ]);
    expect(answered.tools[0]._card).toMatchObject({ type: "question", status: "answered", answer: "yes" });

    const timedOut = reduce([
      toolStart("t1", "ask_user", { question: "q?" }),
      { type: "control_request", requestId: "r2", kind: "question", toolCallId: "t1", toolName: "ask_user", args: { question: "q?" } },
      { type: "control_resolved", requestId: "r2", kind: "question", timedOut: true },
    ]);
    expect(timedOut.tools[0]._card).toMatchObject({ type: "question", status: "timeout" });
  });

  it("ignores resolutions for unrelated request ids", () => {
    const run = reduce([
      toolStart("t1", "ask_user", { question: "q?" }),
      { type: "control_request", requestId: "r1", kind: "question", toolCallId: "t1", toolName: "ask_user", args: { question: "q?" } },
      { type: "control_resolved", requestId: "other", kind: "question", answer: "x", timedOut: false },
    ]);
    expect(run.tools[0]._card).toMatchObject({ type: "question", status: "pending" });
  });
});
