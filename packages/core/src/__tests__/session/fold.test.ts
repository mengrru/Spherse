import { describe, it, expect } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { deriveHistoryEntries, deriveMessageEntries, deriveMessages, repairLog } from "../../session/fold.js";
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
      ev("turn/start", {}, 0),
      user("hello", 1),
      assistant("hi", 2),
      ev("turn/end", { reason: "completed" }, 3),
      ev("turn/start", {}, 4),
      user("again", 5),
      ev("turn/end", { reason: "completed" }, 6),
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

  it("turn/withdrawn abandons the anchored range through the withdraw event", () => {
    const events = [
      user("q1", 0),
      assistant("a1", 1),
      user("q2", 2),
      assistant("a2", 3),
      ev("turn/withdrawn", { seq: 2 }, 4),
    ];
    const messages = deriveMessages(events);
    expect(messages.map((m) => (m as { content: unknown }).content)).toEqual([
      "q1",
      [{ type: "text", text: "a1" }],
    ]);
  });

  it("turn/withdrawn of the only turn projects to empty", () => {
    const events = [
      user("q1", 0),
      assistant("a1", 1),
      ev("turn/withdrawn", { seq: 0 }, 2),
    ];
    expect(deriveMessages(events)).toEqual([]);
    expect(deriveHistoryEntries(events)).toEqual([]);
  });

  it("turn/withdrawn combines with turn/retried abandoned seqs", () => {
    const events = [
      user("q1", 0),
      ev("assistant/message", { message: { role: "assistant", content: [{ type: "text", text: "bad" }], stopReason: "error", timestamp: 1 } as never }, 1),
      ev("turn/retried", { abandonedSeqs: [1] }, 2),
      ev("assistant/message", { message: { role: "assistant", content: [{ type: "text", text: "good" }], timestamp: 3 } as never }, 3),
      ev("turn/withdrawn", { seq: 0 }, 4),
    ];
    expect(deriveMessages(events)).toEqual([]);
  });

  it("history projection hides withdrawn range", () => {
    const events = [
      user("q1", 0),
      assistant("a1", 1),
      user("q2", 2),
      assistant("a2", 3),
      ev("turn/withdrawn", { seq: 2 }, 4),
    ];
    const history = deriveHistoryEntries(events);
    expect(history.map((entry) => entry.seq)).toEqual([0, 1]);
  });

  it("turn/withdrawn after compaction keeps the digest when the digest only covers earlier turns", () => {
    const events = [
      user("q1", 0),
      assistant("a1", 1),
      ev("compaction/applied", { anchorSeq: 1, digestContent: "digest of q1/a1", excludedSeqs: [] }, 2),
      user("q2", 3),
      assistant("a2", 4),
      ev("turn/withdrawn", { seq: 3 }, 5),
    ];
    const messages = deriveMessages(events);
    expect(messages.length).toBe(1);
    expect((messages[0] as { content: string }).content).toContain("digest of q1/a1");
  });

  it("fold retains the digest when a withdraw anchors inside the compacted range (runner rejects this case)", () => {
    const events = [
      user("q1", 0),
      assistant("a1", 1),
      user("q2", 2),
      assistant("a2", 3),
      ev("compaction/applied", { anchorSeq: 3, digestContent: "digest covering q2", excludedSeqs: [] }, 4),
      ev("turn/withdrawn", { seq: 2 }, 5),
    ];
    const messages = deriveMessages(events);
    expect(messages.length).toBe(1);
    expect((messages[0] as { content: string }).content).toContain("digest covering q2");
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
    expect(deriveMessages([ev("turn/start", {}, 0), ev("turn/end", { reason: "completed" }, 1)])).toEqual([]);
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

describe("user/message source metadata", () => {
  const triggerUser = (text: string, seq: number, triggerName: string) =>
    ev(
      "user/message",
      {
        message: { role: "user", content: text, timestamp: seq } as AgentMessage,
        source: "triggered",
        triggerName,
      },
      seq,
    );

  it("history projection carries source and triggerName", () => {
    const events = [
      triggerUser("report", 0, "每日汇报"),
      assistant("done", 1),
      user("manual", 2),
      assistant("reply", 3),
    ];
    const history = deriveHistoryEntries(events);
    expect(history[0]).toMatchObject({ seq: 0, source: "triggered", triggerName: "每日汇报" });
    expect(history[2].source).toBeUndefined();
    expect(history[2].triggerName).toBeUndefined();
  });

  it("message projection carries source and triggerName", () => {
    const events = [triggerUser("report", 0, "t1"), assistant("done", 1)];
    const entries = deriveMessageEntries(events);
    expect(entries[0]).toMatchObject({ seq: 0, source: "triggered", triggerName: "t1" });
    expect(entries[1].source).toBeUndefined();
  });

  it("withdrawn trigger turn drops the marker together with the message", () => {
    const events = [
      user("q1", 0),
      triggerUser("report", 1, "t1"),
      assistant("done", 2),
      ev("turn/withdrawn", { seq: 1 }, 3),
    ];
    const history = deriveHistoryEntries(events);
    expect(history.map((entry) => entry.seq)).toEqual([0]);
    expect(history[0].source).toBeUndefined();
  });

  it("legacy events without the fields project cleanly", () => {
    const events = [user("q1", 0), assistant("a1", 1)];
    const history = deriveHistoryEntries(events);
    expect(history.every((entry) => entry.source === undefined && entry.triggerName === undefined)).toBe(true);
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
      ev("turn/start", {}, 0),
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
      ev("turn/start", {}, 0),
      user("go", 1),
      toolCallAssistant(["tc-1"], 2),
      toolResult("tc-1", 3),
      ev("turn/end", { reason: "completed" }, 4),
    ];
    expect(repairLog(events)).toEqual([]);
  });

  it("returns nothing when no turn events exist (migration artifact)", () => {
    const events = [user("q", 0), toolCallAssistant(["tc-1"], 1)];
    expect(repairLog(events)).toEqual([]);
  });

  it("still closes turn when open turn has no tool calls", () => {
    const events = [ev("turn/start", {}, 0), user("q", 1), assistant("a", 2)];
    const repairs = repairLog(events);
    expect(repairs.map((r) => r.type)).toEqual(["turn/end"]);
    expect((repairs[0].data as { reason: string }).reason).toBe("aborted");
  });

  it("does not repair tool calls from an earlier closed turn", () => {
    const events = [
      ev("turn/start", {}, 0),
      toolCallAssistant(["old-call"], 1),
      ev("turn/end", { reason: "aborted" }, 2),
      ev("turn/start", {}, 3),
    ];

    const repairs = repairLog(events);
    expect(repairs.map((event) => event.type)).toEqual(["turn/end"]);
    expect(repairs[0].data).toEqual({ reason: "aborted" });
  });
});

describe("derivePendingControls", () => {
  it("returns unresolved requested controls with their metadata", async () => {
    const { derivePendingControls } = await import("../../session/fold.js");
    const pending = derivePendingControls([
      user("hi", 0),
      ev("turn/start", {}, 1),
      ev("control/requested", { requestId: "r1", kind: "approval", toolCallId: "tc1", toolName: "run_command", args: {} }, 2),
    ]);
    expect(pending).toEqual([
      { seq: 2, requestId: "r1", kind: "approval", toolCallId: "tc1", toolName: "run_command" },
    ]);
  });

  it("drops requests paired with a resolved event", async () => {
    const { derivePendingControls } = await import("../../session/fold.js");
    const pending = derivePendingControls([
      ev("control/requested", { requestId: "r1", kind: "approval", toolCallId: "tc1", toolName: "run_command", args: {} }, 0),
      ev("control/resolved", { requestId: "r1", kind: "approval", approved: true }, 1),
      ev("control/requested", { requestId: "r2", kind: "question", toolCallId: "tc2", toolName: "ask_user", args: {} }, 2),
      ev("control/resolved", { requestId: "r2", kind: "question", timedOut: true }, 3),
    ]);
    expect(pending).toEqual([]);
  });

  it("excludes requests separated from the log tail by a turn/end (crash danglings via repair)", async () => {
    const { derivePendingControls } = await import("../../session/fold.js");
    const pending = derivePendingControls([
      ev("control/requested", { requestId: "r1", kind: "approval", toolCallId: "tc1", toolName: "run_command", args: {} }, 0),
      ev("turn/end", { reason: "aborted" }, 1),
    ]);
    expect(pending).toEqual([]);
  });

  it("keeps a request from the latest turn even when earlier turns ended", async () => {
    const { derivePendingControls } = await import("../../session/fold.js");
    const pending = derivePendingControls([
      ev("control/requested", { requestId: "r1", kind: "approval", toolCallId: "tc1", toolName: "run_command", args: {} }, 0),
      ev("control/resolved", { requestId: "r1", kind: "approval", approved: true }, 1),
      ev("turn/end", { reason: "completed" }, 2),
      ev("control/requested", { requestId: "r2", kind: "question", toolCallId: "tc2", toolName: "ask_user", args: {} }, 3),
    ]);
    expect(pending).toEqual([
      { seq: 3, requestId: "r2", kind: "question", toolCallId: "tc2", toolName: "ask_user" },
    ]);
  });
});
