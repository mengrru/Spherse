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

  it("agent_end aggregates write_file calls into _runChanges", () => {
    const current = session({
      messages: [
        { role: "user", content: "write a file" },
        {
          role: "assistant",
          content: "done",
          _streaming: true,
          _toolCalls: [
            {
              toolCallId: "tc1",
              toolName: "write_file",
              args: { path: "a.txt", content: "hello" },
              status: "completed",
            },
          ],
        },
      ],
      streaming: true,
    });

    const next = reduceSessionEvents(current, [{ type: "agent_end", messages: [] }], 200);

    expect(next.messages[1]._runChanges).toEqual([
      {
        path: "a.txt",
        ops: [
          {
            toolCallId: "tc1",
            toolName: "write_file",
            args: { path: "a.txt", content: "hello" },
          },
        ],
      },
    ]);
    expect(next.messages[1]._streaming).toBe(false);
  });

  it("agent_end aggregates edit_file calls into _runChanges", () => {
    const current = session({
      messages: [
        { role: "user", content: "edit a file" },
        {
          role: "assistant",
          content: "done",
          _streaming: true,
          _toolCalls: [
            {
              toolCallId: "tc1",
              toolName: "edit_file",
              args: { path: "a.txt", oldText: "a", newText: "b" },
              status: "completed",
            },
          ],
        },
      ],
      streaming: true,
    });

    const next = reduceSessionEvents(current, [{ type: "agent_end", messages: [] }], 200);

    expect(next.messages[1]._runChanges).toEqual([
      {
        path: "a.txt",
        ops: [
          {
            toolCallId: "tc1",
            toolName: "edit_file",
            args: { path: "a.txt", oldText: "a", newText: "b" },
          },
        ],
      },
    ]);
  });

  it("agent_end with no write/edit calls does not set _runChanges", () => {
    const current = session({
      messages: [
        { role: "user", content: "read a file" },
        {
          role: "assistant",
          content: "done",
          _streaming: true,
          _toolCalls: [
            {
              toolCallId: "tc1",
              toolName: "read_file",
              args: { path: "a.txt" },
              status: "completed",
            },
          ],
        },
      ],
      streaming: true,
    });

    const next = reduceSessionEvents(current, [{ type: "agent_end", messages: [] }], 200);

    expect(next.messages[1]._runChanges).toBeUndefined();
  });

  it("agent_end aggregates multiple files into multiple cards", () => {
    const current = session({
      messages: [
        { role: "user", content: "write files" },
        {
          role: "assistant",
          content: "done",
          _streaming: true,
          _toolCalls: [
            {
              toolCallId: "tc1",
              toolName: "write_file",
              args: { path: "a.txt", content: "a" },
              status: "completed",
            },
            {
              toolCallId: "tc2",
              toolName: "write_file",
              args: { path: "b.txt", content: "b" },
              status: "completed",
            },
          ],
        },
      ],
      streaming: true,
    });

    const next = reduceSessionEvents(current, [{ type: "agent_end", messages: [] }], 200);

    expect(next.messages[1]._runChanges?.map((c) => c.path)).toEqual(["a.txt", "b.txt"]);
  });

  it("agent_end aggregates same file multiple ops into one card", () => {
    const current = session({
      messages: [
        { role: "user", content: "write and edit" },
        {
          role: "assistant",
          content: "done",
          _streaming: true,
          _toolCalls: [
            {
              toolCallId: "tc1",
              toolName: "write_file",
              args: { path: "a.txt", content: "a" },
              status: "completed",
            },
            {
              toolCallId: "tc2",
              toolName: "edit_file",
              args: { path: "a.txt", oldText: "a", newText: "b" },
              status: "completed",
            },
          ],
        },
      ],
      streaming: true,
    });

    const next = reduceSessionEvents(current, [{ type: "agent_end", messages: [] }], 200);

    expect(next.messages[1]._runChanges).toHaveLength(1);
    expect(next.messages[1]._runChanges?.[0].path).toBe("a.txt");
    expect(next.messages[1]._runChanges?.[0].ops.map((o) => o.toolCallId)).toEqual(["tc1", "tc2"]);
  });

  it("parseHistoryMessages attaches _runChanges for runs with write/edit", () => {
    const history = [
      { role: "user", content: "write a file" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "ok" },
          { type: "toolCall", id: "tc1", name: "write_file", arguments: { path: "a.txt", content: "hello" } },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "tc1",
        content: [{ type: "text", text: "done" }],
        isError: false,
      },
    ];

    const parsed = parseHistoryMessages(history);

    expect(parsed[1]._runChanges).toEqual([
      {
        path: "a.txt",
        ops: [
          {
            toolCallId: "tc1",
            toolName: "write_file",
            args: { path: "a.txt", content: "hello" },
          },
        ],
      },
    ]);
  });

  it("parseHistoryMessages handles multiple runs independently", () => {
    const history = [
      { role: "user", content: "first" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "ok1" },
          { type: "toolCall", id: "tc1", name: "write_file", arguments: { path: "a.txt", content: "a" } },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "tc1",
        content: [{ type: "text", text: "done" }],
        isError: false,
      },
      { role: "user", content: "second" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "ok2" },
          { type: "toolCall", id: "tc2", name: "write_file", arguments: { path: "b.txt", content: "b" } },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "tc2",
        content: [{ type: "text", text: "done" }],
        isError: false,
      },
    ];

    const parsed = parseHistoryMessages(history);

    expect(parsed[1]._runChanges?.map((c) => c.path)).toEqual(["a.txt"]);
    expect(parsed[3]._runChanges?.map((c) => c.path)).toEqual(["b.txt"]);
  });

  it("parseHistoryMessages does not set _runChanges for runs without write/edit", () => {
    const history = [
      { role: "user", content: "hello" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "hi" },
          { type: "toolCall", id: "tc1", name: "read_file", arguments: { path: "a.txt" } },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "tc1",
        content: [{ type: "text", text: "content" }],
        isError: false,
      },
    ];

    const parsed = parseHistoryMessages(history);

    expect(parsed[1]._runChanges).toBeUndefined();
  });
});
