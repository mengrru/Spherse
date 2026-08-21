import { describe, it, expect } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { deriveHistoryEntries, deriveMessages, repairLog } from "../../session/fold.js";
import type { SessionEvent, SessionEventType, SessionEventMap } from "../../session/events.js";

function ev<T extends SessionEventType>(type: T, data: SessionEventMap[T], seq: number): SessionEvent {
  return { type, seq, time: seq, data };
}

const user = (text: string, seq: number) =>
  ev("user/message", { message: { role: "user", content: text, timestamp: seq } as AgentMessage }, seq);
const assistant = (text: string, seq: number) =>
  ev(
    "assistant/message",
    { message: { role: "assistant", content: [{ type: "text", text }], timestamp: seq } as never },
    seq,
  );
const toolResult = (toolCallId: string, seq: number) =>
  ev(
    "tool/result",
    {
      message: {
        role: "toolResult",
        toolCallId,
        toolName: "read_file",
        content: [{ type: "text", text: "ok" }],
        timestamp: seq,
      } as never,
    },
    seq,
  );

describe("deriveMessages", () => {
  it("projects message events in order and skips non-message events", () => {
    const events = [
      ev("turn/start", { turn: 0 }, 0),
      user("hello", 1),
      assistant("hi", 2),
      ev("turn/end", { turn: 0, reason: "completed" }, 3),
      ev("turn/start", { turn: 1 }, 4),
      user("again", 5),
      ev("turn/end", { turn: 1, reason: "completed" }, 6),
    ];
    const messages = deriveMessages(events);
    expect(messages.map((m) => (m as { content: unknown }).content)).toEqual([
      "hello",
      [{ type: "text", text: "hi" }],
      "again",
    ]);
  });

  it("compaction restart projects digest + tail after anchor", () => {
    const events = [
      user("q1", 0),
      assistant("a1", 1),
      user("q2", 2),
      ev("compaction/applied", { anchorSeq: 1, digestContent: "[user]: q1", excludedSeqs: [] }, 3),
      assistant("a2", 4),
    ];
    const messages = deriveMessages(events);
    expect(messages.length).toBe(3);
    expect((messages[0] as { content: string }).content).toContain("<compaction-digest");
    expect((messages[0] as { content: string }).content).toContain("[user]: q1");
    expect((messages[1] as { content: string }).content).toBe("q2");
    expect((messages[2] as { content: Array<{ text: string }> }).content[0].text).toBe("a2");
  });

  it("compaction restart excludes sanitized tail messages", () => {
    const events = [
      user("q1", 0),
      assistant("a1", 1),
      ev(
        "assistant/message",
        {
          message: {
            role: "assistant",
            content: [{ type: "text", text: "failed" }],
            stopReason: "error",
            timestamp: 2,
          } as never,
        },
        2,
      ),
      ev("compaction/applied", {
        anchorSeq: 1,
        digestContent: "digest",
        excludedSeqs: [2],
      }, 3),
      assistant("kept", 4),
    ];

    const messages = deriveMessages(events);
    expect(messages).toHaveLength(2);
    expect((messages[1] as { content: Array<{ text: string }> }).content[0].text).toBe("kept");
  });

  it("turn/retried skips abandoned message events only", () => {
    const events = [
      user("q1", 0),
      ev("assistant/message", { message: { role: "assistant", content: [{ type: "text", text: "bad" }], stopReason: "error", timestamp: 1 } as never }, 1),
      ev("turn/retried", { abandonedSeqs: [1] }, 2),
      ev("assistant/message", { message: { role: "assistant", content: [{ type: "text", text: "good" }], timestamp: 3 } as never }, 3),
    ];
    const messages = deriveMessages(events);
    expect(messages.length).toBe(2);
    expect((messages[1] as { content: Array<{ text: string }> }).content[0].text).toBe("good");
  });

  it("last restart wins when multiple compactions exist", () => {
    const events = [
      user("q1", 0),
      ev("compaction/applied", { anchorSeq: 0, digestContent: "digest-1", excludedSeqs: [] }, 1),
      user("q2", 2),
      ev("compaction/applied", { anchorSeq: 2, digestContent: "digest-2", excludedSeqs: [] }, 3),
      assistant("a", 4),
    ];
    const messages = deriveMessages(events);
    expect((messages[0] as { content: string }).content).toContain("digest-2");
    expect(messages.length).toBe(2);
  });

  it("compaction after retry does not resurrect abandoned messages", () => {
    const events = [
      user("q", 0),
      ev("assistant/message", { message: { role: "assistant", content: [{ type: "text", text: "x" }], timestamp: 1 } as never }, 1),
      ev("turn/retried", { abandonedSeqs: [1] }, 2),
      ev("compaction/applied", { anchorSeq: 0, digestContent: "d", excludedSeqs: [] }, 3),
      ev("assistant/message", { message: { role: "assistant", content: [{ type: "text", text: "y" }], timestamp: 4 } as never }, 4),
    ];
    const messages = deriveMessages(events);
    expect(messages.length).toBe(2);
    expect((messages[1] as { content: Array<{ text: string }> }).content[0].text).toBe("y");
  });

  it("empty and non-message-only logs project to empty", () => {
    expect(deriveMessages([])).toEqual([]);
    expect(deriveMessages([ev("turn/start", { turn: 0 }, 0), ev("turn/end", { turn: 0, reason: "completed" }, 1)])).toEqual([]);
  });

  it("history projection preserves compacted history but hides retried messages", () => {
    const events = [
      user("q1", 0),
      assistant("a1", 1),
      ev("compaction/applied", { anchorSeq: 1, digestContent: "digest", excludedSeqs: [] }, 2),
      ev(
        "assistant/message",
        {
          message: {
            role: "assistant",
            content: [{ type: "text", text: "failed" }],
            stopReason: "error",
            timestamp: 3,
          } as never,
        },
        3,
      ),
      ev("turn/retried", { abandonedSeqs: [3] }, 4),
      assistant("a2", 5),
    ];

    const history = deriveHistoryEntries(events);
    expect(history.map((entry) => entry.seq)).toEqual([0, 1, 5]);
  });

  it("fold matches a live mirror for deterministic random legal logs", () => {
    let seed = 137;
    const random = (): number => {
      seed = (seed * 48271) % 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const events: SessionEvent[] = [];
    const mirror: AgentMessage[] = [];
    for (let turn = 0; turn < 30; turn++) {
      const userEvent = user(`q-${turn}`, events.length);
      events.push(userEvent);
      mirror.push((userEvent.data as { message: AgentMessage }).message);

      const failed = random() < 0.25;
      const firstAnswer = {
        role: "assistant",
        content: [{ type: "text", text: failed ? `failed-${turn}` : `a-${turn}` }],
        stopReason: failed ? "error" : "stop",
        timestamp: turn * 2 + 1,
      } as never;
      const firstSeq = events.length;
      events.push(ev("assistant/message", { message: firstAnswer }, firstSeq));
      if (failed) {
        events.push(ev("turn/retried", { abandonedSeqs: [firstSeq] }, events.length));
        const replacement = {
          role: "assistant",
          content: [{ type: "text", text: `a-${turn}` }],
          stopReason: "stop",
          timestamp: turn * 2 + 1,
        } as never;
        events.push(ev("assistant/message", { message: replacement }, events.length));
        mirror.push(replacement);
      } else {
        mirror.push(firstAnswer);
      }
    }

    expect(deriveMessages(events)).toEqual(mirror);
  });
});

describe("repairLog", () => {
  const toolCallAssistant = (ids: string[], seq: number) =>
    ev(
      "assistant/message",
      {
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "calling" },
            ...ids.map((id) => ({ type: "toolCall", id, name: "read_file", arguments: {} })),
          ],
          stopReason: "toolUse",
          timestamp: seq,
        } as never,
      },
      seq,
    );

  it("synthesizes results for unanswered tool calls in open turn", () => {
    const events = [
      ev("turn/start", { turn: 0 }, 0),
      user("go", 1),
      toolCallAssistant(["tc-1", "tc-2"], 2),
      toolResult("tc-1", 3),
    ];
    const repairs = repairLog(events);
    expect(repairs.map((r) => r.type)).toEqual(["tool/result", "turn/end"]);
    const synthetic = repairs[0].data as { message: { toolCallId: string; isError: boolean } };
    expect(synthetic.message.toolCallId).toBe("tc-2");
    expect((synthetic.message as { toolName: string }).toolName).toBe("read_file");
    expect(synthetic.message.isError).toBe(true);
    expect(repairs[0].seq).toBe(4);
    expect(repairs[1].seq).toBe(5);
  });

  it("returns nothing for closed turns", () => {
    const events = [
      ev("turn/start", { turn: 0 }, 0),
      user("go", 1),
      toolCallAssistant(["tc-1"], 2),
      toolResult("tc-1", 3),
      ev("turn/end", { turn: 0, reason: "completed" }, 4),
    ];
    expect(repairLog(events)).toEqual([]);
  });

  it("returns nothing when no turn events exist (migration artifact)", () => {
    const events = [user("q", 0), toolCallAssistant(["tc-1"], 1)];
    expect(repairLog(events)).toEqual([]);
  });

  it("still closes turn when open turn has no tool calls", () => {
    const events = [ev("turn/start", { turn: 0 }, 0), user("q", 1), assistant("a", 2)];
    const repairs = repairLog(events);
    expect(repairs.map((r) => r.type)).toEqual(["turn/end"]);
    expect((repairs[0].data as { reason: string }).reason).toBe("aborted");
  });

  it("does not repair tool calls from an earlier closed turn", () => {
    const events = [
      ev("turn/start", { turn: 0 }, 0),
      toolCallAssistant(["old-call"], 1),
      ev("turn/end", { turn: 0, reason: "aborted" }, 2),
      ev("turn/start", { turn: 1 }, 3),
    ];

    const repairs = repairLog(events);
    expect(repairs.map((event) => event.type)).toEqual(["turn/end"]);
    expect((repairs[0].data as { turn: number }).turn).toBe(1);
  });
});
