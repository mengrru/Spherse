import { describe, expect, it } from "vitest";
import { RunSnapshot } from "../chat/chat-run-snapshot.js";

const start = { type: "message_start", message: { role: "assistant" }, messageId: "m1" };
const update = (text: string) => ({
  type: "message_update",
  message: { content: text },
  messageId: "m1",
});
const end = { type: "message_end", message: { role: "assistant" }, messageId: "m1", seq: 5 };

const toolStart = (toolCallId: string) => ({
  type: "tool_execution_start",
  toolCallId,
  toolName: "read_file",
  args: {},
});
const toolUpdate = (toolCallId: string, partial: string) => ({
  type: "tool_execution_update",
  toolCallId,
  toolName: "read_file",
  args: {},
  partialResult: partial,
});
const toolResultEnd = (toolCallId: string) => ({
  type: "message_end",
  message: { role: "toolResult", toolCallId },
});

describe("RunSnapshot", () => {
  it("coalesces consecutive message_update inside the current message window", () => {
    const snapshot = new RunSnapshot();
    snapshot.record(start);
    snapshot.record(update("a"));
    snapshot.record(update("b"));
    snapshot.record(update("c"));

    expect(snapshot.inFlight).toEqual([start, update("c")]);
  });

  it("drops the whole message window once the persisted message_end arrives", () => {
    const snapshot = new RunSnapshot();
    snapshot.record(start);
    snapshot.record(update("a"));
    snapshot.record(end);

    expect(snapshot.inFlight).toEqual([]);
  });

  it("keeps a message_end without messageId in the snapshot", () => {
    const snapshot = new RunSnapshot();
    const anonymousEnd = { type: "message_end", message: { role: "assistant" } };
    snapshot.record(anonymousEnd);

    expect(snapshot.inFlight).toEqual([anonymousEnd]);
  });

  it("coalesces tool_execution_update per toolCallId and drops on toolResult end", () => {
    const snapshot = new RunSnapshot();
    snapshot.record(toolStart("tc1"));
    snapshot.record(toolUpdate("tc1", "a"));
    snapshot.record(toolUpdate("tc1", "b"));

    expect(snapshot.inFlight).toEqual([toolStart("tc1"), toolUpdate("tc1", "b")]);

    snapshot.record(toolResultEnd("tc1"));

    expect(snapshot.inFlight).toEqual([]);
  });

  it("keeps interleaved tool calls independent", () => {
    const snapshot = new RunSnapshot();
    snapshot.record(toolStart("tc1"));
    snapshot.record(toolUpdate("tc1", "a"));
    snapshot.record(toolStart("tc2"));
    snapshot.record(toolUpdate("tc2", "b"));
    snapshot.record(toolUpdate("tc1", "c"));

    expect(snapshot.inFlight).toEqual([
      toolStart("tc1"),
      toolUpdate("tc1", "c"),
      toolStart("tc2"),
      toolUpdate("tc2", "b"),
    ]);
  });

  it("appends unknown events and reset clears the snapshot", () => {
    const snapshot = new RunSnapshot();
    const agentStart = { type: "agent_start" };
    snapshot.record(agentStart);
    expect(snapshot.inFlight).toEqual([agentStart]);

    snapshot.reset();
    expect(snapshot.inFlight).toEqual([]);
  });
});
