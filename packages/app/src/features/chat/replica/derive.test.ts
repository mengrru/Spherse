import { describe, expect, it } from "vitest";
import type { AgentMessage, ToolResultMessage } from "@spherse/core";
import { deriveReplica } from "./derive";
import { initialReplica, reduceReplica, type ReplicaFrame } from "./session-replica";

const NOW = 1000;

function userMessage(content: string): AgentMessage {
  return { role: "user", content, timestamp: 1 };
}

function assistantToolCallMessage(text: string, toolCalls: Array<{ id: string; name: string; arguments?: Record<string, unknown> }>) {
  return {
    role: "assistant",
    content: [
      { type: "text", text },
      ...toolCalls.map((toolCall) => ({ type: "toolCall", id: toolCall.id, name: toolCall.name, arguments: toolCall.arguments ?? {} })),
    ],
    timestamp: 2,
  } as unknown as AgentMessage;
}

function assistantText(text: string): AgentMessage {
  return { role: "assistant", content: [{ type: "text", text }], timestamp: 2 } as unknown as AgentMessage;
}

function run(frames: ReplicaFrame[], from = initialReplica()) {
  let state = from;
  for (const frame of frames) {
    state = reduceReplica(state, frame, NOW);
  }
  return state;
}

function commandToolResult(toolCallId: string): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName: "run_command",
    content: [{ type: "text" as const, text: "done" }],
    isError: false,
    timestamp: 3,
    details: {
      cardType: "command",
      status: "completed",
      command: "npm test",
      cwd: "/repo",
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      durationMs: 120,
    },
  };
}

describe("derive: settle-crossing golden (run zone ≡ durable derivation)", () => {
  const liveFrames: ReplicaFrame[] = [
    { type: "message_settled", seq: 0, message: userMessage("run it"), intentId: "i1" },
    { type: "agent_start" },
    { type: "message_start", message: assistantToolCallMessage("working", [{ id: "t1", name: "run_command", arguments: { command: "npm test", cwd: "/repo" } }]) },
    { type: "message_update", message: assistantToolCallMessage("working…", [{ id: "t1", name: "run_command", arguments: { command: "npm test", cwd: "/repo" } }]) },
    { type: "message_end", message: assistantToolCallMessage("working", [{ id: "t1", name: "run_command", arguments: { command: "npm test", cwd: "/repo" } }]), seq: 1 },
    { type: "message_settled", seq: 1, message: assistantToolCallMessage("working", [{ id: "t1", name: "run_command", arguments: { command: "npm test", cwd: "/repo" } }]) },
    { type: "tool_execution_start", toolCallId: "t1", toolName: "run_command", args: { command: "npm test", cwd: "/repo" } },
    { type: "tool_execution_update", toolCallId: "t1", toolName: "run_command", args: {}, partialResult: { details: { cardType: "command", status: "running", command: "npm test", cwd: "/repo", stdout: "", stderr: "" } } },
    { type: "tool_execution_end", toolCallId: "t1", toolName: "run_command", result: { details: commandToolResult("t1").details }, isError: false },
    { type: "message_end", message: commandToolResult("t1"), seq: 2 },
    { type: "message_settled", seq: 2, message: commandToolResult("t1") },
    { type: "message_start", message: assistantText("all done") },
    { type: "message_update", message: assistantText("all done") },
    { type: "message_end", message: assistantText("all done"), seq: 3 },
    { type: "message_settled", seq: 3, message: assistantText("all done") },
    { type: "agent_end", messages: [] },
    { type: "run_status", active: false },
    { type: "syncSucceeded" },
  ];

  it("mid-run render shows the overlay state (running command card)", () => {
    const midRun = run(liveFrames.slice(0, 8));
    const view = deriveReplica(midRun);
    const overlayMessage = view.messages.find((message) => message._toolCalls?.length);
    expect(overlayMessage?._toolCalls?.[0]).toMatchObject({ toolCallId: "t1", status: "running" });
    expect(overlayMessage?._toolCalls?.[0]._card).toMatchObject({ type: "command", status: "running" });
    expect(view.streaming).toBe(true);
  });

  it("final live render equals the pure durable derivation field by field", () => {
    const live = deriveReplica(run(liveFrames));

    const cold = run([
      {
        type: "snapshotApplied",
        snapshot: {
          entries: [
            { id: 0, message: userMessage("run it") },
            { id: 1, message: assistantToolCallMessage("working", [{ id: "t1", name: "run_command", arguments: { command: "npm test", cwd: "/repo" } }]) },
            { id: 2, message: commandToolResult("t1") },
            { id: 3, message: assistantText("all done") },
          ],
          hasMore: false,
          oldestId: 0,
        },
        full: true,
      },
      { type: "syncSucceeded" },
    ]);
    const snapshotView = deriveReplica(cold);

    expect(live.messages).toEqual(snapshotView.messages);
    expect(live.keyed.map((entry) => entry.key)).toEqual(snapshotView.keyed.map((entry) => entry.key));
    expect(live.streaming).toBe(false);
  });

  it("aggregates file changes per completed run on both paths", () => {
    const writeFileCall = { id: "w1", name: "write_file", arguments: { path: "/repo/a.ts" } };
    const frames: ReplicaFrame[] = [
      { type: "message_settled", seq: 0, message: userMessage("edit") },
      { type: "agent_start" },
      { type: "message_end", message: assistantToolCallMessage("", [writeFileCall]), seq: 1 },
      { type: "message_settled", seq: 1, message: assistantToolCallMessage("", [writeFileCall]) },
      { type: "tool_execution_start", toolCallId: "w1", toolName: "write_file", args: { path: "/repo/a.ts" } },
      {
        type: "message_end",
        seq: 2,
        message: commandToolResult("w1"),
      },
      {
        type: "message_settled",
        seq: 2,
        message: commandToolResult("w1"),
      },
      { type: "agent_end", messages: [] },
      { type: "run_status", active: false },
      { type: "syncSucceeded" },
    ];
    const live = deriveReplica(run(frames)).messages;
    const withChanges = live.find((message) => message._runChanges?.length);
    expect(withChanges?._runChanges).toEqual([
      { path: "/repo/a.ts", ops: [{ toolCallId: "w1", toolName: "write_file", args: { path: "/repo/a.ts" } }] },
    ]);

    const cold = run([
      {
        type: "snapshotApplied",
        snapshot: {
          entries: [
            { id: 0, message: userMessage("edit") },
            { id: 1, message: assistantToolCallMessage("", [writeFileCall]) },
            { id: 2, message: commandToolResult("w1") },
          ],
          hasMore: false,
          oldestId: 0,
        },
        full: true,
      },
      { type: "syncSucceeded" },
    ]);
    expect(deriveReplica(cold).messages).toEqual(live);
  });

  it("renders approval/question control cards identically across the settle crossing", () => {
    const runCommand = { id: "c1", name: "run_command", arguments: { command: "npm test", cwd: "/repo" } };
    const frames: ReplicaFrame[] = [
      { type: "message_settled", seq: 0, message: userMessage("run tests") },
      { type: "agent_start" },
      { type: "message_end", message: assistantToolCallMessage("working", [runCommand]), seq: 1 },
      { type: "message_settled", seq: 1, message: assistantToolCallMessage("working", [runCommand]) },
      { type: "tool_execution_start", toolCallId: "c1", toolName: "run_command", args: { command: "npm test", cwd: "/repo" } },
      { type: "control_request", requestId: "req-1", kind: "approval", toolCallId: "c1", toolName: "run_command", args: { command: "npm test" } },
      { type: "control_resolved", requestId: "req-1", kind: "approval", approved: true },
      {
        type: "message_end",
        seq: 2,
        message: {
          ...commandToolResult("c1"),
          toolCallId: "c1",
        },
      },
      {
        type: "message_settled",
        seq: 2,
        message: {
          ...commandToolResult("c1"),
          toolCallId: "c1",
        },
      },
      { type: "agent_end", messages: [] },
      { type: "run_status", active: false },
      { type: "syncSucceeded" },
    ];
    const live = deriveReplica(run(frames)).messages;

    const cold = run([
      {
        type: "snapshotApplied",
        snapshot: {
          entries: [
            { id: 0, message: userMessage("run tests") },
            { id: 1, message: assistantToolCallMessage("working", [runCommand]) },
            {
              id: 2,
              message: {
                ...commandToolResult("c1"),
                toolCallId: "c1",
              },
            },
          ],
          hasMore: false,
          oldestId: 0,
        },
        full: true,
      },
      { type: "syncSucceeded" },
    ]);
    expect(deriveReplica(cold).messages).toEqual(live);

    const commandCards = live
      .flatMap((message) => message._toolCalls ?? [])
      .map((toolCall) => toolCall._card)
      .filter((card): card is NonNullable<typeof card> => card?.type === "command");
    expect(commandCards).toHaveLength(1);
    expect(commandCards[0]).toMatchObject({ status: "completed", command: "npm test", stdout: "ok" });
  });
});

describe("derive: keys and zones", () => {
  it("uses seq keys for durable entries and keeps them stable when older pages prepend", () => {
    let state = run([
      {
        type: "snapshotApplied",
        snapshot: {
          entries: [
            { id: 4, message: userMessage("newer") },
            { id: 5, message: assistantText("reply") },
          ],
          hasMore: true,
          oldestId: 4,
        },
        full: false,
      },
    ]);
    expect(deriveReplica(state).keyed.map((entry) => entry.key)).toEqual(["seq:4", "seq:5"]);

    state = run([
      {
        type: "loadMoreApplied",
        page: {
          entries: [{ id: 1, message: userMessage("older") }],
          hasMore: false,
          oldestId: 1,
        },
      },
    ], state);
    expect(deriveReplica(state).keyed.map((entry) => entry.key)).toEqual(["seq:1", "seq:4", "seq:5"]);
    expect(state.durable.highSeq).toBe(5);
  });

  it("renders pending intents after durable and uses intent keys", () => {
    const state = run([
      { type: "message_settled", seq: 0, message: userMessage("done") },
      { type: "syncSucceeded" },
    ]);
    const withPending = {
      ...state,
      pending: {
        ...state.pending,
        intents: [
          { intentId: "i2", content: "next", state: "sending" as const, createdAt: 9 },
        ],
        lastSendingId: "i2",
      },
    };
    const view = deriveReplica(withPending);
    expect(view.keyed.map((entry) => entry.key)).toEqual(["seq:0", "intent:i2"]);
    expect(view.streaming).toBe(true);
  });

  it("projects the retrying state onto the last durable error entry", () => {
    const state = run([
      { type: "message_settled", seq: 0, message: userMessage("q") },
      { type: "message_settled", seq: 1, message: { role: "assistant", content: [], stopReason: "error", errorMessage: "boom", timestamp: 2 } as unknown as AgentMessage },
    ]);
    const idle = deriveReplica(state);
    expect(idle.messages.at(-1)).toMatchObject({ _error: "boom", _turnError: true });

    const retrying = deriveReplica({ ...state, run: { ...state.run, retrying: true } });
    expect(retrying.messages.at(-1)?._error).toBeUndefined();
    expect(retrying.messages.at(-1)).toMatchObject({ _streaming: true });
    expect(retrying.streaming).toBe(true);
  });

  it("keeps trigger metadata from durable entries for turn grouping", () => {
    const state = run([
      {
        type: "snapshotApplied",
        snapshot: {
          entries: [{ id: 0, message: userMessage("report"), source: "triggered", triggerName: "daily" }],
          hasMore: false,
          oldestId: 0,
        },
        full: false,
      },
    ]);
    expect(deriveReplica(state).messages[0]).toMatchObject({ _triggered: true, _triggerName: "daily" });
  });
});
