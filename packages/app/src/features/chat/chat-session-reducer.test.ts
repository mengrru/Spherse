import { describe, expect, it } from "vitest";
import {
  appendErrorMessage,
  mergeHistoryMessages,
  parseHistoryMessages,
  reduceSessionEvents,
  type StreamingSessionData,
} from "./chat-session-reducer";

function session(overrides: Partial<StreamingSessionData> = {}): StreamingSessionData {
  return {
    messages: [],
    streaming: false,
    lastActivityAt: 1,
    scrollPosition: 0,
    ...overrides,
  };
}

describe("chat session reducer", () => {
  it("keeps the same session object for ignored events", () => {
    const current = session({
      messages: [{ role: "assistant", content: "hello" }],
      lastActivityAt: 100,
    });

    const next = reduceSessionEvents(current, [{ type: "turn_start" }], 200);

    expect(next).toBe(current);
  });

  it("appends stream errors to the current streaming assistant message", () => {
    const messages = appendErrorMessage([
      { role: "user", content: "start" },
      { role: "assistant", content: "partial", _streaming: true },
    ], "broken");

    expect(messages).toHaveLength(2);
    expect(messages[1]).toEqual({
      role: "assistant",
      content: "partial\n\n[Error] broken",
      _streaming: true,
    });
  });

  it("only agent_end ends streaming state", () => {
    const current = session({
      messages: [{ role: "assistant", content: "partial", _streaming: true }],
      streaming: true,
    });

    const afterError = reduceSessionEvents(current, [{ type: "error", message: "broken" }], 200);
    expect(afterError.streaming).toBe(true);

    const afterDone = reduceSessionEvents(afterError, [{ type: "agent_end", messages: [] }], 300);
    expect(afterDone.streaming).toBe(false);
    expect(afterDone.messages[0]._streaming).toBe(false);
  });

  it("creates an assistant placeholder on assistant message_start", () => {
    const current = session({
      messages: [{ role: "user", content: "Hello" }],
      streaming: true,
    });

    const next = reduceSessionEvents(current, [
      { type: "message_start", message: { role: "assistant", content: [] } },
    ], 200);

    expect(next.messages).toEqual([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "", _streaming: true },
    ]);
  });

  it("agent_end ends normal streaming without waiting for server sentinel", () => {
    const current = session({
      messages: [{ role: "assistant", content: "done", _streaming: false }],
      streaming: true,
    });

    const next = reduceSessionEvents(current, [{ type: "agent_end", messages: [] }], 200);

    expect(next.streaming).toBe(false);
  });

  it("preserves pending messages when history resolves after user input", () => {
    const history = [
      { role: "user" as const, content: "old question" },
      { role: "assistant" as const, content: "old answer" },
    ];
    const pending = [{ role: "user" as const, content: "new question" }];

    expect(mergeHistoryMessages(pending, history)).toEqual([
      { role: "user", content: "old question" },
      { role: "assistant", content: "old answer" },
      { role: "user", content: "new question" },
    ]);
  });

  it("handles the complete pi-agent lifecycle without duplicating user messages", () => {
    const current = session({
      messages: [{ role: "user", content: "Hello" }],
      streaming: true,
    });

    const afterAgentEnd = reduceSessionEvents(current, [
      { type: "agent_start" },
      { type: "turn_start" },
      { type: "message_start", message: { role: "user", content: [{ type: "text", text: "Hello" }] } },
      { type: "message_end", message: { role: "user", content: [{ type: "text", text: "Hello" }] } },
      { type: "message_start", message: { role: "assistant", content: [] } },
      { type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "Hi" }] } },
      { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Hi there" }] } },
      { type: "turn_end", message: {}, toolResults: [] },
      { type: "agent_end", messages: [] },
    ], 200);

    expect(afterAgentEnd.streaming).toBe(false);
    expect(afterAgentEnd.messages).toEqual([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there", _streaming: false },
    ]);
  });

  it("sets _error when message_end has stopReason error", () => {
    const current = session({
      messages: [{ role: "user", content: "Hello" }],
      streaming: true,
    });

    const next = reduceSessionEvents(current, [
      { type: "message_start", message: { role: "assistant", content: [] } },
      { type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "Rate limit exceeded" } },
    ], 200);

    expect(next.messages).toEqual([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "", _streaming: false, _error: "Rate limit exceeded" },
    ]);
  });

  it("sets _error with fallback when errorMessage is missing", () => {
    const current = session({
      messages: [{ role: "user", content: "Hello" }],
      streaming: true,
    });

    const next = reduceSessionEvents(current, [
      { type: "message_start", message: { role: "assistant", content: [] } },
      { type: "message_end", message: { role: "assistant", content: [], stopReason: "error" } },
    ], 200);

    expect(next.messages[1]._error).toBe("Unknown error");
  });

  it("does not set _error for non-error stopReason", () => {
    const current = session({
      messages: [{ role: "user", content: "Hello" }],
      streaming: true,
    });

    const next = reduceSessionEvents(current, [
      { type: "message_start", message: { role: "assistant", content: [] } },
      { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Hi" }], stopReason: "stop" } },
    ], 200);

    expect(next.messages[1]._error).toBeUndefined();
  });

  it("does not set _error for aborted stopReason", () => {
    const current = session({
      messages: [{ role: "user", content: "Hello" }],
      streaming: true,
    });

    const next = reduceSessionEvents(current, [
      { type: "message_start", message: { role: "assistant", content: [] } },
      { type: "message_end", message: { role: "assistant", content: [], stopReason: "aborted" } },
    ], 200);

    expect(next.messages[1]._error).toBeUndefined();
  });

  it("parseHistoryMessages preserves _error from history", () => {
    const history = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: [], stopReason: "error", errorMessage: "Rate limit exceeded" },
    ];

    const parsed = parseHistoryMessages(history);

    expect(parsed).toEqual([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "", _error: "Rate limit exceeded" },
    ]);
  });

  it("parseHistoryMessages does not set _error for normal messages", () => {
    const history = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: [{ type: "text", text: "Hi" }], stopReason: "stop" },
    ];

    const parsed = parseHistoryMessages(history);

    expect(parsed[1]._error).toBeUndefined();
  });
});
