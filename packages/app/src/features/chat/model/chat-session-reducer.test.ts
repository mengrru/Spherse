import { describe, expect, it } from "vitest";
import { ErrorEventCode } from "@spherse/server/contracts";
import {
  appendErrorMessage,
  reduceSessionEvents,
  type StreamingSessionData,
} from "./chat-session-reducer";
import {
  mergeHistoryMessages,
  parseHistoryMessages,
} from "./chat-history";
import type { AgentEvent } from "./agent-event-parse";

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

  it("attaches stream errors to the current streaming assistant message via _error", () => {
    const messages = appendErrorMessage([
      { role: "user", content: "start" },
      { role: "assistant", content: "partial", _streaming: true },
    ], "broken");

    expect(messages).toHaveLength(2);
    expect(messages[1]).toEqual({
      role: "assistant",
      content: "partial",
      _streaming: false,
      _error: "broken",
    });
  });

  it("attaches _errorCode when appendErrorMessage receives a code", () => {
    const messages = appendErrorMessage(
      [{ role: "user", content: "start" }],
      "no model",
      ErrorEventCode.ModelNotConfigured,
    );

    expect(messages[messages.length - 1]).toEqual({
      role: "assistant",
      content: "",
      _error: "no model",
      _errorCode: ErrorEventCode.ModelNotConfigured,
    });
  });

  it("leaves _errorCode undefined when appendErrorMessage has no code", () => {
    const messages = appendErrorMessage([{ role: "user", content: "start" }], "broken");

    expect(messages[messages.length - 1]._errorCode).toBeUndefined();
  });

  it("threads _errorCode through reduceSessionEvents for error events", () => {
    const current = session({
      messages: [{ role: "user", content: "hi" }],
      streaming: true,
    });

    const next = reduceSessionEvents(current, [
      { type: "error", message: "no model", code: ErrorEventCode.ModelNotConfigured },
    ] as unknown as AgentEvent[], 200);

    const last = next.messages[next.messages.length - 1];
    expect(last._errorCode).toBe(ErrorEventCode.ModelNotConfigured);
    expect(last._error).toBe("no model");
  });

  it("omits _errorCode when error event has no code", () => {
    const current = session({
      messages: [{ role: "user", content: "hi" }],
      streaming: true,
    });

    const next = reduceSessionEvents(current, [{ type: "error", message: "broken" }], 200);

    const last = next.messages[next.messages.length - 1];
    expect(last._errorCode).toBeUndefined();
    expect(last._error).toBe("broken");
  });

  it("error events clear streaming state (no agent_end needed)", () => {
    const current = session({
      messages: [{ role: "assistant", content: "partial", _streaming: true }],
      streaming: true,
    });

    const afterError = reduceSessionEvents(current, [{ type: "error", message: "broken" }], 200);
    expect(afterError.streaming).toBe(false);
    expect(afterError.messages[0]._streaming).toBe(false);
    expect(afterError.messages[0]._error).toBe("broken");
  });

  it("agent_end clears streaming state for normal runs", () => {
    const current = session({
      messages: [{ role: "assistant", content: "partial", _streaming: true }],
      streaming: true,
    });

    const afterDone = reduceSessionEvents(current, [{ type: "agent_end", messages: [] }], 300);
    expect(afterDone.streaming).toBe(false);
    expect(afterDone.messages[0]._streaming).toBe(false);
  });

  it("run_status reconciles a run that ended while disconnected", () => {
    const current = session({
      messages: [{ role: "assistant", content: "partial", _streaming: true }],
      streaming: true,
    });

    const next = reduceSessionEvents(
      current,
      [{ type: "run_status", active: false }],
      300,
    );

    expect(next.streaming).toBe(false);
    expect(next.messages[0]._streaming).toBe(false);
  });

  it("creates an assistant placeholder on assistant message_start", () => {
    const current = session({
      messages: [{ role: "user", content: "Hello" }],
      streaming: true,
    });

    const next = reduceSessionEvents(current, [
      { type: "message_start", message: { role: "assistant", content: [] } },
    ] as unknown as AgentEvent[], 200);

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
    ] as unknown as AgentEvent[], 200);

    expect(afterAgentEnd.streaming).toBe(false);
    expect(afterAgentEnd.messages).toEqual([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there", _streaming: false, timestamp: 200 },
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
    ] as unknown as AgentEvent[], 200);

    expect(next.messages).toEqual([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "", _streaming: false, _error: "Rate limit exceeded", timestamp: 200 },
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
    ] as unknown as AgentEvent[], 200);

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
    ] as unknown as AgentEvent[], 200);

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

  it("parseHistoryMessages carries timestamp onto returned messages", () => {
    const history = [
      { role: "user", content: "Hello", timestamp: 1000 },
      { role: "assistant", content: [{ type: "text", text: "Hi" }], stopReason: "stop", timestamp: 2000 },
    ];

    const parsed = parseHistoryMessages(history);

    expect(parsed[0].timestamp).toBe(1000);
    expect(parsed[1].timestamp).toBe(2000);
  });

  it("parseHistoryMessages reconstructs render_card html from arguments for inline content", () => {
    const history = [
      { role: "user", content: "show card" },
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "tc1", name: "render_card", arguments: { type: "html", content: "<h1>Hi</h1>" } }],
        stopReason: "stop",
      },
      {
        role: "toolResult",
        toolCallId: "tc1",
        content: [{ type: "text", text: "HTML card rendered successfully" }],
        details: { cardType: "html", title: "Test", width: 500, height: 400, max_width: 800, max_height: 600 },
      },
    ];

    const parsed = parseHistoryMessages(history);

    expect(parsed[1]._toolCalls?.[0]._card).toEqual({
      type: "html",
      html: "<h1>Hi</h1>",
      file_path: undefined,
      title: "Test",
      width: 500,
      height: 400,
      max_width: 800,
      max_height: 600,
    });
  });

  it("parseHistoryMessages recovers render_card file_path card without html in details", () => {
    const history = [
      { role: "user", content: "show card" },
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "tc1", name: "render_card", arguments: { type: "html", file_path: "card.html" } }],
        stopReason: "stop",
      },
      {
        role: "toolResult",
        toolCallId: "tc1",
        content: [{ type: "text", text: "HTML card rendered successfully" }],
        details: { cardType: "html", file_path: "card.html", height: 400, max_width: 800, max_height: 600 },
      },
    ];

    const parsed = parseHistoryMessages(history);

    expect(parsed[1]._toolCalls?.[0]._card).toEqual({
      type: "html",
      html: undefined,
      file_path: "card.html",
      title: undefined,
      width: undefined,
      height: 400,
      max_width: 800,
      max_height: 600,
    });
  });

  it("parseHistoryMessages prefers legacy details.html when present (backward compat)", () => {
    const history = [
      { role: "user", content: "show card" },
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "tc1", name: "render_card", arguments: { type: "html", content: "<h1>New</h1>" } }],
        stopReason: "stop",
      },
      {
        role: "toolResult",
        toolCallId: "tc1",
        content: [{ type: "text", text: "HTML card rendered successfully" }],
        details: { cardType: "html", html: "<h1>Legacy</h1>", height: 400, max_width: 800, max_height: 600 },
      },
    ];

    const parsed = parseHistoryMessages(history);

    const card = parsed[1]._toolCalls?.[0]._card;
    expect(card?.type === "html" ? card.html : undefined).toBe("<h1>Legacy</h1>");
  });

  it("parseHistoryMessages ignores arguments.content when file_path present (both-args edge case)", () => {
    const history = [
      { role: "user", content: "show card" },
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "tc1", name: "render_card", arguments: { type: "html", content: "<h1>Inline</h1>", file_path: "card.html" } }],
        stopReason: "stop",
      },
      {
        role: "toolResult",
        toolCallId: "tc1",
        content: [{ type: "text", text: "HTML card rendered successfully" }],
        details: { cardType: "html", file_path: "card.html", height: 400, max_width: 800, max_height: 600 },
      },
    ];

    const parsed = parseHistoryMessages(history);

    const card = parsed[1]._toolCalls?.[0]._card;
    expect(card?.type === "html" ? card.html : undefined).toBeUndefined();
    expect(card?.type === "html" ? card.file_path : undefined).toBe("card.html");
  });

  it("message_end writes timestamp from event.message.timestamp", () => {
    const current = session({
      messages: [{ role: "user", content: "Hello" }],
      streaming: true,
    });

    const next = reduceSessionEvents(current, [
      { type: "message_start", message: { role: "assistant", content: [] } },
      { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Hi" }], timestamp: 9999 } },
    ] as unknown as AgentEvent[], 200);

    expect(next.messages[1].timestamp).toBe(9999);
  });

  it("message_end falls back to now when event lacks timestamp", () => {
    const current = session({
      messages: [{ role: "user", content: "Hello" }],
      streaming: true,
    });

    const next = reduceSessionEvents(current, [
      { type: "message_start", message: { role: "assistant", content: [] } },
      { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Hi" }] } },
    ] as unknown as AgentEvent[], 4242);

    expect(next.messages[1].timestamp).toBe(4242);
  });
});

describe("run_command approval + command card lifecycle", () => {
  it("flows pending_approval -> running -> completed with streamed output", () => {
    const start = reduceSessionEvents(session(), [
      { type: "tool_execution_start", toolCallId: "tc1", toolName: "run_command", args: { command: "echo hi", cwd: "." } },
    ] as unknown as AgentEvent[], 1);
    const tc = start.messages[0]._toolCalls![0];
    expect(tc.status).toBe("running");
    expect(tc._card).toBeUndefined();

    const pending = reduceSessionEvents(start, [
      { type: "control_request", requestId: "r1", kind: "approval", toolCallId: "tc1", toolName: "run_command", args: { command: "echo hi" } },
    ] as unknown as AgentEvent[], 2);
    expect(pending.messages[0]._toolCalls![0]._card).toMatchObject({
      type: "command",
      status: "pending_approval",
      command: "echo hi",
      requestId: "r1",
    });

    const running = reduceSessionEvents(pending, [
      { type: "control_resolved", requestId: "r1", kind: "approval", approved: true },
    ] as unknown as AgentEvent[], 3);
    expect(running.messages[0]._toolCalls![0]._card).toMatchObject({ type: "command", status: "running" });

    const streamed = reduceSessionEvents(running, [
      {
        type: "tool_execution_update",
        toolCallId: "tc1",
        toolName: "run_command",
        args: {},
        partialResult: { details: { cardType: "command", status: "running", command: "echo hi", stdout: "hi\n", stderr: "" } },
      },
    ] as unknown as AgentEvent[], 4);
    expect(streamed.messages[0]._toolCalls![0]._card).toMatchObject({ stdout: "hi\n" });

    const done = reduceSessionEvents(streamed, [
      {
        type: "tool_execution_end",
        toolCallId: "tc1",
        toolName: "run_command",
        isError: false,
        result: { details: { cardType: "command", status: "completed", command: "echo hi", stdout: "hi\n", stderr: "", exitCode: 0, durationMs: 12 } },
      },
    ] as unknown as AgentEvent[], 5);
    const finalCard = done.messages[0]._toolCalls![0]._card;
    expect(finalCard).toMatchObject({ type: "command", status: "completed", exitCode: 0, durationMs: 12 });
    expect(done.messages[0]._toolCalls![0].status).toBe("completed");
  });

  it("marks the command card as rejected when approval is denied", () => {
    const seeded = reduceSessionEvents(session(), [
      { type: "tool_execution_start", toolCallId: "tc2", toolName: "run_command", args: { command: "rm -rf x" } },
      { type: "control_request", requestId: "r2", kind: "approval", toolCallId: "tc2", toolName: "run_command", args: { command: "rm -rf x" } },
    ] as unknown as AgentEvent[], 1);

    const denied = reduceSessionEvents(seeded, [
      { type: "control_resolved", requestId: "r2", kind: "approval", approved: false },
    ] as unknown as AgentEvent[], 2);

    expect(denied.messages[0]._toolCalls![0]._card).toMatchObject({ type: "command", status: "error", rejected: true });
  });

  it("reconstructs a command card from history on rejected tool results", () => {
    const history = [
      { role: "assistant", content: [{ type: "toolCall", id: "tc3", name: "run_command", arguments: { command: "ls" } }], timestamp: 1 },
      { role: "toolResult", toolCallId: "tc3", content: [{ type: "text", text: "Execution rejected by user." }], details: { rejected: true, reason: undefined }, isError: false },
    ] as unknown[];

    const parsed = parseHistoryMessages(history);
    const card = parsed[0]._toolCalls![0]._card;
    expect(card).toMatchObject({ type: "command", status: "error", rejected: true, command: "ls" });
  });
});

describe("generic approval card lifecycle", () => {
  function pendingManageAgent() {
    const start = reduceSessionEvents(session(), [
      {
        type: "tool_execution_start",
        toolCallId: "tc1",
        toolName: "manage_agent",
        args: { action: "create", name: "Reviewer" },
      },
    ] as unknown as AgentEvent[], 1);
    return reduceSessionEvents(start, [
      {
        type: "control_request",
        requestId: "r1",
        kind: "approval",
        toolCallId: "tc1",
        toolName: "manage_agent",
        args: { action: "create", name: "Reviewer" },
      },
    ] as unknown as AgentEvent[], 2);
  }

  it("renders an approval card for non-run_command tools", () => {
    const pending = pendingManageAgent();
    expect(pending.messages[0]._toolCalls![0]._card).toMatchObject({
      type: "approval",
      status: "pending",
      toolName: "manage_agent",
      args: { action: "create", name: "Reviewer" },
      requestId: "r1",
    });
  });

  it("marks the card approved and drops the request id", () => {
    const approved = reduceSessionEvents(pendingManageAgent(), [
      { type: "control_resolved", requestId: "r1", kind: "approval", approved: true },
    ] as unknown as AgentEvent[], 3);
    expect(approved.messages[0]._toolCalls![0]._card).toMatchObject({
      type: "approval",
      status: "approved",
    });
    expect((approved.messages[0]._toolCalls![0]._card as { requestId?: string }).requestId).toBeUndefined();
  });

  it("marks the card rejected when denied", () => {
    const rejected = reduceSessionEvents(pendingManageAgent(), [
      { type: "control_resolved", requestId: "r1", kind: "approval", approved: false },
    ] as unknown as AgentEvent[], 3);
    expect(rejected.messages[0]._toolCalls![0]._card).toMatchObject({
      type: "approval",
      status: "rejected",
    });
  });
});
