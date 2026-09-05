import { describe, expect, it } from "vitest";
import {
  CHAT_CLOSE_CODES,
  parseChatClientMessage,
  parseChatReplayEvent,
  parseChatServerEvent,
} from "@spherse/contracts";

const userMessage = { role: "user", content: "hi", timestamp: 1 };
const assistantMessage = {
  role: "assistant",
  content: [{ type: "text", text: "hello" }],
  timestamp: 2,
};

const replaySamples = [
  { type: "turn/start", seq: 0, time: 1, data: {} },
  { type: "turn/end", seq: 1, time: 1, data: { reason: "completed" } },
  { type: "turn/end", seq: 1, time: 1, data: { reason: "aborted" } },
  { type: "turn/end", seq: 1, time: 1, data: { reason: "error" } },
  { type: "user/message", seq: 2, time: 1, data: { message: userMessage } },
  {
    type: "user/message",
    seq: 2,
    time: 1,
    data: { message: userMessage, source: "triggered", triggerName: "t1" },
  },
  { type: "assistant/message", seq: 3, time: 1, data: { message: assistantMessage } },
  {
    type: "tool/result",
    seq: 4,
    time: 1,
    data: { message: { role: "toolResult", toolCallId: "tc1", content: [], timestamp: 3 } },
  },
  {
    type: "compaction/applied",
    seq: 5,
    time: 1,
    data: { anchorSeq: 1, digestContent: "digest", excludedSeqs: [2, 3] },
  },
  {
    type: "compaction/applied",
    seq: 5,
    time: 1,
    data: {
      anchorSeq: 1,
      digestContent: "digest",
      excludedSeqs: [],
      digestSource: "llm",
    },
  },
  { type: "turn/retried", seq: 6, time: 1, data: { abandonedSeqs: [3, 4] } },
  { type: "turn/withdrawn", seq: 7, time: 1, data: { seq: 2 } },
];

const serverEventSamples = [
  { type: "agent_start" },
  { type: "agent_end", messages: [assistantMessage] },
  { type: "agent_end", messages: [], seq: 7 },
  { type: "run_status", active: true },
  { type: "run_status", active: false },
  { type: "turn_start" },
  { type: "turn_end", message: assistantMessage, toolResults: [] },
  { type: "message_start", message: assistantMessage },
  { type: "message_start", message: assistantMessage, messageId: "m1" },
  { type: "message_update", message: assistantMessage },
  { type: "message_update", message: assistantMessage, messageId: "m1" },
  { type: "message_update", message: assistantMessage, assistantMessageEvent: { delta: "x" } },
  { type: "message_end", message: assistantMessage },
  { type: "message_end", message: assistantMessage, seq: 9 },
  { type: "message_end", message: assistantMessage, messageId: "m1", seq: 9 },
  { type: "tool_execution_start", toolCallId: "tc1", toolName: "read_file", args: { path: "a" } },
  {
    type: "tool_execution_update",
    toolCallId: "tc1",
    toolName: "read_file",
    args: { path: "a" },
    partialResult: { text: "..." },
  },
  {
    type: "tool_execution_end",
    toolCallId: "tc1",
    toolName: "read_file",
    result: { text: "done" },
    isError: false,
  },
  {
    type: "control_request",
    requestId: "r1",
    kind: "approval",
    toolCallId: "tc1",
    toolName: "write_file",
    args: { path: "a" },
  },
  {
    type: "control_request",
    requestId: "r2",
    kind: "question",
    toolCallId: "tc2",
    toolName: "ask_user",
    args: { question: "q" },
  },
  { type: "control_resolved", requestId: "r1", kind: "approval", approved: true },
  {
    type: "control_resolved",
    requestId: "r2",
    kind: "question",
    answer: "a",
    timedOut: false,
  },
  { type: "turn_withdrawn", seq: 4 },
  { type: "user_message", seq: 5, message: userMessage },
  { type: "user_message", seq: 5, message: userMessage, clientId: "c1" },
  {
    type: "user_message",
    seq: 5,
    message: userMessage,
    clientId: "c1",
    source: "triggered",
    triggerName: "t1",
  },
  { type: "turn_retried", seq: 6, abandonedSeqs: [1, 2] },
  { type: "session_ready", lastSeq: 9, replay: true },
  { type: "replay_events", events: replaySamples },
  { type: "replay_done" },
  { type: "error", message: "boom" },
  { type: "error", message: "boom", code: "TRANSIENT" },
  { type: "pong" },
];

describe("chat wire schema", () => {
  it("accepts every replay envelope variant", () => {
    for (const sample of replaySamples) {
      expect(() => parseChatReplayEvent(sample)).not.toThrow();
    }
  });

  it("accepts every server event variant the hub can emit", () => {
    for (const sample of serverEventSamples) {
      expect(() => parseChatServerEvent(sample)).not.toThrow();
    }
  });

  it("rejects malformed replay envelopes", () => {
    expect(() => parseChatReplayEvent({ type: "turn/retried", seq: 1, time: 1 })).toThrow();
    expect(() =>
      parseChatReplayEvent({ type: "turn/end", seq: 1, time: 1, data: { reason: "nope" } }),
    ).toThrow();
    expect(() => parseChatReplayEvent({ type: "unknown", seq: 1, time: 1, data: {} })).toThrow();
  });

  it("rejects malformed server events", () => {
    expect(() => parseChatServerEvent({ type: "user_message", message: userMessage })).toThrow();
    expect(() =>
      parseChatServerEvent({ type: "session_ready", lastSeq: "x", replay: true }),
    ).toThrow();
    expect(() => parseChatServerEvent({ type: "definitely_not_an_event" })).toThrow();
  });

  it("accepts client messages with and without clientId", () => {
    expect(parseChatClientMessage({ type: "message", content: "hi" })).toEqual({
      type: "message",
      content: "hi",
    });
    expect(
      parseChatClientMessage({ type: "message", content: "hi", clientId: "c1" }),
    ).toEqual({ type: "message", content: "hi", clientId: "c1" });
  });

  it("keeps close codes stable on the wire contract", () => {
    expect(CHAT_CLOSE_CODES).toEqual({
      PROTOCOL_ERROR: 4400,
      SESSION_UNRECOVERABLE: 4401,
      MIGRATION_REQUIRED: 4402,
    });
  });
});
