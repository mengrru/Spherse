import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  appendEntry,
  compactLog,
  createLog,
  dropLast,
  emptyLog,
  messagesOf,
  replaceMessage,
} from "../../kernel/message-log.js";

function msg(role: string, text: string): AgentMessage {
  return { role, content: text, timestamp: 1 } as unknown as AgentMessage;
}

describe("MessageLog", () => {
  it("starts empty and keeps entries ordered on append", () => {
    const log = emptyLog();
    expect(log.entries).toHaveLength(0);

    const grown = appendEntry(appendEntry(log, msg("user", "hi"), 1), msg("assistant", "hello"), 2);
    expect(messagesOf(grown).map((m) => (m as { role: string }).role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(grown.entries.map((e) => e.dbId)).toEqual([1, 2]);
  });

  it("keeps dbId paired with its message across dropLast and replaceMessage", () => {
    const log = createLog([
      { dbId: 1, message: msg("user", "a") },
      { dbId: 2, message: msg("assistant", "b") },
      { dbId: 3, message: msg("user", "c") },
    ]);

    const dropped = dropLast(log);
    expect(dropped.entries.map((e) => e.dbId)).toEqual([1, 2]);

    const target = log.entries[1].message;
    const replaced = replaceMessage(log, target, msg("assistant", "stripped"));
    expect(replaced.entries[1].dbId).toBe(2);
    expect(replaced.entries[1].message).not.toBe(target);
    expect(replaced.entries).toHaveLength(3);
  });

  it("does not mutate the source log", () => {
    const log = appendEntry(emptyLog(), msg("user", "a"), 1);
    dropLast(log);
    replaceMessage(log, log.entries[0].message, msg("user", "x"));
    expect(log.entries).toHaveLength(1);
    expect((log.entries[0].message as { content: string }).content).toBe("a");
  });

  it("compacts by anchoring the digest dbId and carrying sanitized tail messages with their dbIds", () => {
    const log = createLog([
      { dbId: 1, message: msg("user", "a") },
      { dbId: 2, message: msg("assistant", "b") },
      { dbId: 3, message: msg("user", "c") },
      { dbId: 4, message: msg("assistant", "d") },
      { dbId: 5, message: msg("user", "e") },
    ]);

    const digest = msg("user", "<compaction-digest>…</compaction-digest>");
    const compacted = compactLog(log, {
      anchorIndex: 1,
      digestMessage: digest,
      tail: [
        { index: 0, message: msg("user", "sanitized c") },
        { index: 2, message: msg("user", "sanitized e") },
      ],
    });

    expect(compacted.entries.map((e) => e.dbId)).toEqual([2, 3, 5]);
    expect(compacted.entries[0].message).toBe(digest);
    expect(messagesOf(compacted).map((m) => (m as { content: string }).content)).toEqual([
      "<compaction-digest>…</compaction-digest>",
      "sanitized c",
      "sanitized e",
    ]);
  });

  it("returns null dbId for the digest when the anchor is out of range", () => {
    const log = createLog([{ dbId: 1, message: msg("user", "a") }]);
    const compacted = compactLog(log, {
      anchorIndex: 9,
      digestMessage: msg("user", "d"),
      tail: [],
    });
    expect(compacted.entries).toHaveLength(1);
    expect(compacted.entries[0].dbId).toBeNull();
  });

});
